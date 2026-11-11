-- ===================================================
-- Fecha de cobro de la rendición
-- ===================================================
-- La "Fecha de cobro" que se indica al rendir es la fecha de pago de todo lo
-- cobrado en la planilla (y la que sale como "Últ. pago" en los recibos).
-- Antes, al modificar una rendición, la fecha nueva sólo se aplicaba a los
-- recibos cuyo monto cambiaba y la planilla no la recordaba. Ahora:
--   * se guarda en rendiciones.fecha_cobro en cada guardado (parcial o no);
--   * se aplica a todos los pagos de la planilla;
--   * en una planilla rendida, también actualiza fecha_rendicion.

alter table public.rendiciones add column if not exists fecha_cobro date;

-- Planillas ya rendidas: la fecha de cobro es la que tenían sus pagos
update public.rendiciones r
set fecha_cobro = coalesce(
        (select max(p.paid_at)::date
         from public.rendicion_items ri
         join public.payments p on p.rendicion_item_id = ri.id or p.id = ri.payment_id
         where ri.rendicion_id = r.id),
        r.fecha_rendicion)
where r.fecha_cobro is null;

create or replace function public.guardar_rendicion(
    p_rendicion_id uuid,
    p_montos       jsonb,
    p_fecha        date    default current_date,
    p_cerrar       boolean default false,
    p_movimientos  jsonb   default null
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
    v_mov      jsonb;
    v_orden    integer := 0;
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

        -- Sin cambios: no se tocan los pagos existentes (conservan su fecha)
        if v_monto is not distinct from v_item.monto_cobrado then
            continue;
        end if;

        delete from public.payments
        where rendicion_item_id = v_item.id
           or id = v_item.payment_id;

        v_pago := null;
        if v_monto > 0 and v_item.loan_id is not null then
            v_pago := public.imputar_cobro(
                v_item.loan_id,
                v_monto,
                p_fecha,
                coalesce(v_item.cobrador, v_rend.cobrador),
                'Planilla N° ' || v_rend.numero || ' - recibo ' || v_item.numero_recibo,
                v_item.id
            );
        end if;

        update public.rendicion_items
        set monto_cobrado = v_monto,
            payment_id    = v_pago
        where id = v_item.id;
    end loop;

    if p_movimientos is not null then
        delete from public.rendicion_movimientos where rendicion_id = p_rendicion_id;

        for v_mov in select * from jsonb_array_elements(p_movimientos)
        loop
            v_orden := v_orden + 1;
            if coalesce(trim(v_mov ->> 'concepto'), '') = '' then
                raise exception 'El movimiento % no tiene concepto.', v_orden;
            end if;
            if coalesce((v_mov ->> 'importe')::numeric, 0) <= 0 then
                raise exception 'El movimiento % (%) tiene que tener un importe mayor a cero.',
                    v_orden, v_mov ->> 'concepto';
            end if;

            insert into public.rendicion_movimientos (rendicion_id, concepto, tipo, importe, detalle, orden)
            values (
                p_rendicion_id,
                trim(v_mov ->> 'concepto'),
                v_mov ->> 'tipo',
                (v_mov ->> 'importe')::numeric,
                nullif(trim(v_mov ->> 'detalle'), ''),
                v_orden
            );
        end loop;
    end if;

    select count(monto_cobrado), sum(monto_cobrado)
    into v_cargados, v_total
    from public.rendicion_items
    where rendicion_id = p_rendicion_id;

    update public.rendiciones r
    set recibos_cargados = v_cargados,
        total_cobrado    = case when v_cierra or v_cargados > 0 then coalesce(v_total, 0) else null end,
        total_ingresos   = coalesce((select sum(importe) from public.rendicion_movimientos m
                                     where m.rendicion_id = r.id and m.tipo = 'ingreso'), 0),
        total_egresos    = coalesce((select sum(importe) from public.rendicion_movimientos m
                                     where m.rendicion_id = r.id and m.tipo = 'egreso'), 0),
        estado           = case when v_cierra then 'rendida' else estado end,
        fecha_cobro      = p_fecha,
        fecha_rendicion  = case when v_cierra then p_fecha else fecha_rendicion end
    where r.id = p_rendicion_id;

    -- Todo lo cobrado en la planilla queda con la fecha de cobro indicada,
    -- también los recibos que no cambiaron de monto
    update public.payments p
    set paid_at = p_fecha
    from public.rendicion_items ri
    where ri.rendicion_id = p_rendicion_id
      and (p.rendicion_item_id = ri.id or p.id = ri.payment_id)
      and p.paid_at is distinct from p_fecha;
end;
$$;
