-- ===================================================
-- Imputación de cobros de rendición a cuotas pendientes
-- ===================================================
-- El recibo se emite para una cuota puntual, pero cuando se rinde esa cuota
-- puede estar ya cancelada (por ejemplo, se cargó como saldo inicial después de
-- emitir). Antes el cobro se imputaba igual a esa cuota y la dejaba con más
-- pagado que su importe.
--
-- Ahora el cobro de cada recibo se imputa a las cuotas PENDIENTES del préstamo,
-- de la más vieja a la más nueva: completa la primera y el sobrante pasa a la
-- siguiente. Un recibo puede generar varios pagos; todos quedan ligados al
-- recibo por `payments.rendicion_item_id`.

alter table public.payments
    add column if not exists rendicion_item_id uuid
        references public.rendicion_items (id) on delete set null;

create index if not exists payments_rendicion_item_idx on public.payments (rendicion_item_id);

-- Los pagos de rendición que ya existían quedan ligados a su recibo
update public.payments p
set rendicion_item_id = ri.id
from public.rendicion_items ri
where ri.payment_id = p.id
  and p.rendicion_item_id is null;

-- Imputa un cobro a las cuotas pendientes del préstamo, en orden. Devuelve el
-- primer pago registrado. Falla si el cobro supera lo que le queda al préstamo.
create or replace function public.imputar_cobro(
    p_loan_id           uuid,
    p_monto             numeric,
    p_fecha             date,
    p_cobrador          text,
    p_notes             text,
    p_rendicion_item_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_cuota   record;
    v_resto   numeric(12, 2) := p_monto;
    v_aplica  numeric(12, 2);
    v_id      uuid;
    v_primero uuid;
begin
    for v_cuota in
        select id, amount - paid_amount as saldo
        from public.installments
        where loan_id = p_loan_id and paid_amount < amount
        order by number
        for update
    loop
        exit when v_resto <= 0;
        v_aplica := least(v_resto, v_cuota.saldo);

        insert into public.payments
            (loan_id, installment_id, amount, paid_at, cobrador, method, notes, rendicion_item_id)
        values
            (p_loan_id, v_cuota.id, v_aplica, p_fecha, p_cobrador, 'cash', p_notes, p_rendicion_item_id)
        returning id into v_id;

        v_primero := coalesce(v_primero, v_id);
        v_resto   := v_resto - v_aplica;
    end loop;

    if v_resto > 0 then
        raise exception '%: el cobro supera en % lo que le queda pagar al préstamo.', p_notes, v_resto;
    end if;

    return v_primero;
end;
$$;

-- Igual que en 010, pero imputando con `imputar_cobro` y borrando todos los
-- pagos del recibo al corregirlo.
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

-- Saldo inicial: una cuota que ya quedó con más pagado que su importe (datos
-- previos a esta corrección) no debe bloquear la edición del préstamo.
create or replace function public.cargar_saldos_iniciales(
    p_loan_id uuid,
    p_pagado  jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_loan    public.loans%rowtype;
    v_cuota   public.installments%rowtype;
    v_clave   text;
    v_deseado numeric(12, 2);
    v_reales  numeric(12, 2);
    v_inicial numeric(12, 2);
begin
    select * into v_loan from public.loans where id = p_loan_id for update;
    if not found then
        raise exception 'El préstamo no existe.';
    end if;

    for v_cuota in
        select * from public.installments where loan_id = p_loan_id order by number
    loop
        v_clave := v_cuota.number::text;
        continue when not (p_pagado ? v_clave);

        v_deseado := coalesce((p_pagado ->> v_clave)::numeric, 0);

        select coalesce(sum(amount) filter (where not saldo_inicial), 0),
               coalesce(sum(amount) filter (where saldo_inicial), 0)
        into v_reales, v_inicial
        from public.payments
        where installment_id = v_cuota.id;

        if v_deseado < 0 then
            raise exception 'La cuota % tiene un pagado negativo.', v_cuota.number;
        end if;
        if v_deseado > greatest(v_cuota.amount, v_reales) then
            raise exception 'La cuota % no puede tener pagado más que su importe (%).',
                v_cuota.number, v_cuota.amount;
        end if;
        if v_deseado < v_reales then
            raise exception 'La cuota % ya tiene cobros registrados por %: el pagado no puede ser menor.',
                v_cuota.number, v_reales;
        end if;

        continue when v_inicial = v_deseado - v_reales;

        delete from public.payments
        where installment_id = v_cuota.id and saldo_inicial;

        if v_deseado - v_reales > 0 then
            insert into public.payments
                (loan_id, installment_id, amount, paid_at, cobrador, method, notes, saldo_inicial)
            values (
                p_loan_id,
                v_cuota.id,
                v_deseado - v_reales,
                least(v_cuota.due_date, current_date),
                v_loan.cobrador,
                'other',
                'Saldo inicial',
                true
            );
        end if;
    end loop;
end;
$$;

-- Corrección de lo ya cargado: los cobros de rendición que quedaron sobre una
-- cuota con más pagado que su importe se vuelven a imputar a las pendientes.
-- Si alguno no entra (el préstamo no tiene saldo suficiente), se deja como está.
do $$
declare
    r record;
begin
    for r in
        select distinct on (ri.id)
               ri.id, ri.loan_id, ri.monto_cobrado, ri.numero_recibo,
               coalesce(ri.cobrador, rd.cobrador) as cobrador,
               rd.numero, p.paid_at
        from public.rendicion_items ri
        join public.rendiciones  rd on rd.id = ri.rendicion_id
        join public.payments     p  on p.rendicion_item_id = ri.id
        join public.installments i  on i.id = p.installment_id
        where i.paid_amount > i.amount
          and ri.loan_id is not null
          and ri.monto_cobrado > 0
        order by ri.id
    loop
        begin
            delete from public.payments where rendicion_item_id = r.id;
            update public.rendicion_items
            set payment_id = public.imputar_cobro(
                    r.loan_id, r.monto_cobrado, r.paid_at, r.cobrador,
                    'Planilla N° ' || r.numero || ' - recibo ' || r.numero_recibo,
                    r.id)
            where id = r.id;
        exception when others then
            null; -- se deshace sólo este recibo
        end;
    end loop;
end
$$;
