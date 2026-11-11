-- ===================================================
-- Eliminar una planilla rendida (o con cobros cargados)
-- ===================================================
-- Hasta ahora sólo se podía anular una planilla sin cobros. `eliminar_rendicion`
-- borra la planilla junto con todos los pagos que generó (los triggers de
-- payments recalculan cuotas y préstamos), sus recibos y sus ingresos/egresos,
-- en una sola transacción.

create or replace function public.eliminar_rendicion(p_rendicion_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_rend public.rendiciones%rowtype;
begin
    select * into v_rend
    from public.rendiciones
    where id = p_rendicion_id
    for update;

    if not found then
        raise exception 'La planilla no existe.';
    end if;

    -- Pagos que generaron sus recibos
    delete from public.payments p
    using public.rendicion_items ri
    where ri.rendicion_id = p_rendicion_id
      and (p.rendicion_item_id = ri.id or p.id = ri.payment_id);

    -- Sin cobros ya no la frena el trigger de borrado
    update public.rendiciones
    set estado = 'emitida', recibos_cargados = 0
    where id = p_rendicion_id;

    -- Recibos y movimientos se van en cascada
    delete from public.rendiciones where id = p_rendicion_id;
end;
$$;
