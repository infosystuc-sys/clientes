-- ===================================================
-- Rendición parcial y modificación de planillas
-- ===================================================
-- Hasta ahora una planilla se rendía de una sola vez y después no se podía
-- tocar. Ahora:
--   * se puede GUARDAR EL AVANCE (cargar algunos recibos) y seguir más tarde;
--   * se puede MODIFICAR una planilla ya rendida.
--
-- `guardar_rendicion` es idempotente: compara cada recibo contra lo que ya
-- estaba guardado y sólo toca los pagos de los recibos que cambiaron (borra el
-- pago viejo y registra el nuevo; los triggers de payments recalculan la cuota
-- y el estado del préstamo).

alter table public.rendiciones
    add column if not exists recibos_cargados integer not null default 0;

update public.rendiciones r
set recibos_cargados = (
    select count(*) from public.rendicion_items i
    where i.rendicion_id = r.id and i.monto_cobrado is not null
);

-- Una planilla con cobros cargados (parcial o rendida) ya generó pagos: no se
-- puede borrar sin descuadrar la caja.
create or replace function public.prevent_delete_rendida()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.estado = 'rendida' then
        raise exception 'La planilla N° % ya fue rendida y no se puede anular.', old.numero;
    end if;
    if old.recibos_cargados > 0 then
        raise exception 'La planilla N° % tiene cobros cargados. Vaciá los importes y guardá antes de anularla.', old.numero;
    end if;
    return old;
end;
$$;

-- p_montos: { "<id del recibo>": monto | null }
--   monto  -> cobrado (0 = visitado y no pagó)
--   null   -> vuelve a "sin cargar" (borra el cobro guardado)
--   ausente-> sin cambios, salvo al cerrar o en una planilla ya rendida,
--             donde cuenta como no cobrado (0)
-- p_cerrar: true deja la planilla rendida; false sólo guarda el avance.
create or replace function public.guardar_rendicion(
    p_rendicion_id uuid,
    p_montos       jsonb,
    p_fecha        date    default current_date,
    p_cerrar       boolean default false
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_rend     public.rendiciones%rowtype;
    v_item     public.rendicion_items%rowtype;
    v_clave    text;
    v_monto    numeric(12, 2);
    v_pago     uuid;
    v_total    numeric(12, 2);
    v_cargados integer;
    v_cierra   boolean;
begin
    select * into v_rend
    from public.rendiciones
    where id = p_rendicion_id
    for update;

    if not found then
        raise exception 'La planilla no existe.';
    end if;

    p_fecha  := coalesce(p_fecha, current_date);
    v_cierra := p_cerrar or v_rend.estado = 'rendida';

    for v_item in
        select * from public.rendicion_items
        where rendicion_id = p_rendicion_id
        order by numero_recibo
    loop
        v_clave := v_item.id::text;

        if p_montos ? v_clave then
            if jsonb_typeof(p_montos -> v_clave) = 'null' then
                v_monto := null;
            else
                v_monto := (p_montos ->> v_clave)::numeric;
            end if;
        elsif v_cierra then
            v_monto := 0;
        else
            v_monto := v_item.monto_cobrado;
        end if;

        if v_monto < 0 then
            raise exception 'El recibo % tiene un monto negativo.', v_item.numero_recibo;
        end if;

        -- Sin cambios: no se toca el pago existente (conserva su fecha)
        if v_monto is not distinct from v_item.monto_cobrado then
            continue;
        end if;

        if v_item.payment_id is not null then
            delete from public.payments where id = v_item.payment_id;
        end if;

        v_pago := null;
        if v_monto > 0 and v_item.installment_id is not null and v_item.loan_id is not null then
            insert into public.payments (loan_id, installment_id, amount, paid_at, cobrador, method, notes)
            values (
                v_item.loan_id,
                v_item.installment_id,
                v_monto,
                p_fecha,
                coalesce(v_item.cobrador, v_rend.cobrador),
                'cash',
                'Planilla N° ' || v_rend.numero || ' - recibo ' || v_item.numero_recibo
            )
            returning id into v_pago;
        end if;

        update public.rendicion_items
        set monto_cobrado = v_monto,
            payment_id    = v_pago
        where id = v_item.id;
    end loop;

    select count(monto_cobrado), sum(monto_cobrado)
    into v_cargados, v_total
    from public.rendicion_items
    where rendicion_id = p_rendicion_id;

    update public.rendiciones
    set recibos_cargados = v_cargados,
        total_cobrado    = case when v_cierra or v_cargados > 0 then coalesce(v_total, 0) else null end,
        estado           = case when v_cierra then 'rendida' else estado end,
        fecha_rendicion  = case
                               when p_cerrar and v_rend.estado = 'emitida' then p_fecha
                               else fecha_rendicion
                           end
    where id = p_rendicion_id;
end;
$$;
