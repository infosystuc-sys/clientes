-- ===================================================
-- Emisión: sólo cuenta que la cuota esté impaga
-- ===================================================
-- Hasta ahora una cuota que ya estaba en otra planilla sin rendir no se volvía
-- a emitir, y un cliente podía quedar afuera de la planilla nueva aunque
-- debiera. Ahora la emisión toma toda cuota impaga a la fecha, esté o no en
-- otra planilla abierta. Al rendir, lo cobrado se imputa a las cuotas
-- pendientes del préstamo (013), así que no se duplica ningún pago.

create or replace function public.emitir_rendicion(
    p_desde            date,
    p_hasta            date,
    p_cobrador         text    default null,
    p_zona             text    default null,
    p_incluir_vencidas boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_id       uuid;
    v_cantidad integer;
    v_total    numeric(12, 2);
begin
    p_cobrador := nullif(trim(p_cobrador), '');
    p_zona     := nullif(trim(p_zona), '');

    if p_desde is null or p_hasta is null then
        raise exception 'Indicá el rango de fechas a emitir.';
    end if;
    if p_hasta < p_desde then
        raise exception 'La fecha "hasta" no puede ser anterior a "desde".';
    end if;

    insert into public.rendiciones (cobrador, zona, desde, hasta, incluye_vencidas)
    values (p_cobrador, p_zona, p_desde, p_hasta, p_incluir_vencidas)
    returning id into v_id;

    with cuotas as (
        select i.id, i.loan_id, i.number, i.due_date, i.amount - i.paid_amount as saldo
        from public.installments i
        join public.loans   l on l.id = i.loan_id
        join public.clients c on c.id = l.client_id
        where l.status = 'active'
          and i.paid_amount < i.amount
          and i.due_date <= p_hasta
          and (p_incluir_vencidas or i.due_date >= p_desde)
          and (p_cobrador is null or coalesce(l.cobrador, c.cobrador) = p_cobrador)
          and (p_zona is null or c.zona = p_zona)
    ),
    por_prestamo as (
        select loan_id,
               array_agg(id order by number)       as ids,
               (array_agg(id order by number))[1]  as primera,
               min(number)                          as desde_n,
               max(number)                          as hasta_n,
               count(*)::integer                    as cantidad,
               min(due_date)                        as primer_vto,
               sum(saldo)                           as importe
        from cuotas
        group by loan_id
    )
    insert into public.rendicion_items (
        rendicion_id, numero_recibo, installment_id, loan_id, client_id,
        cliente_numero, cliente_nombre, domicilio, telefono, rubro, zona, cobrador,
        credito_numero, fecha_otorgamiento, cuotas_total, valor_cuota,
        prestamo_total, prestamo_pagado, prestamo_saldo, ultimo_pago, atraso,
        cuota_numero, vencimiento, importe,
        installment_ids, cuota_hasta, cuotas_incluidas
    )
    select
        v_id,
        row_number() over (order by c.zona nulls last, c.numero, pp.primer_vto),
        pp.primera, l.id, c.id,
        c.numero, c.name, c.address, c.phone, c.rubro, c.zona,
        coalesce(l.cobrador, c.cobrador),
        cred.anteriores,
        l.fecha_otorgamiento,
        l.installments_count,
        l.installment_amount,
        l.total_amount,
        agg.pagado,
        l.total_amount - agg.pagado,
        up.ultimo,
        agg.atraso,
        pp.desde_n,
        pp.primer_vto,
        pp.importe,
        pp.ids,
        pp.hasta_n,
        pp.cantidad
    from por_prestamo pp
    join public.loans   l on l.id = pp.loan_id
    join public.clients c on c.id = l.client_id
    cross join lateral (
        select coalesce(sum(i2.paid_amount), 0) as pagado,
               coalesce(sum(i2.amount - i2.paid_amount)
                        filter (where i2.due_date < current_date and i2.paid_amount < i2.amount), 0) as atraso
        from public.installments i2
        where i2.loan_id = l.id
    ) agg
    cross join lateral (
        select max(p.paid_at) as ultimo
        from public.payments p
        where p.loan_id = l.id
    ) up
    cross join lateral (
        -- N° de crédito del cliente: 0 el primero, 1 el segundo... (el "/0" del papel)
        select count(*)::integer as anteriores
        from public.loans l2
        where l2.client_id = l.client_id
          and (l2.fecha_otorgamiento, l2.created_at, l2.id)
            < (l.fecha_otorgamiento, l.created_at, l.id)
    ) cred;

    select count(*), coalesce(sum(importe), 0)
    into v_cantidad, v_total
    from public.rendicion_items
    where rendicion_id = v_id;

    if v_cantidad = 0 then
        -- La excepción deshace también el alta de la planilla vacía
        raise exception 'No hay cuotas pendientes para emitir con esos filtros.';
    end if;

    update public.rendiciones
    set cantidad_recibos = v_cantidad,
        total_esperado   = v_total
    where id = v_id;

    return v_id;
end;
$$;
