-- ===================================================
-- Ingresos y egresos del cobrador en la rendición
-- ===================================================
-- La planilla en papel, además de los recibos, lleva los movimientos de plata
-- del cobrador en el ciclo: fondos que recibe (F.A.R., anticipos), entregas de
-- préstamos, combustible, viáticos, transferencias, etc. El resultado de la
-- rendición es: lo cobrado en recibos + ingresos - egresos.
--
-- Los conceptos son un catálogo administrable desde Configuración. Cada
-- movimiento guarda el NOMBRE del concepto como texto (registro histórico):
-- renombrar o borrar un concepto no cambia las rendiciones ya cargadas.

-- ---------------------------------------------------------------------------
-- 1. Catálogo de conceptos
-- ---------------------------------------------------------------------------
create table if not exists public.conceptos_rendicion (
    id          uuid primary key default gen_random_uuid(),
    nombre      varchar(100) not null unique,
    descripcion text,
    activo      boolean not null default true,
    created_at  timestamptz not null default now()
);

-- Los de la planilla en papel
insert into public.conceptos_rendicion (nombre) values
    ('1.2.1 Cobranza realizada'),
    ('1.3.1 Anticipo'),
    ('1.3.1 Viáticos'),
    ('1.3.5 F.A.R'),
    ('1.3.7 Anticipo'),
    ('2.1.2 Clientes Nuevos 3%'),
    ('2.1.2 Clientes Nuevos 4%'),
    ('2.1.2 Entrega de M/C Clientes nuevos'),
    ('2.1.2 Entrega de M/C renovaciones'),
    ('5.1.18 Gastos varios'),
    ('5.2.16 Transporte'),
    ('5.2.3 Combustible'),
    ('5.2.8 Alojamiento')
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Movimientos de cada rendición
-- ---------------------------------------------------------------------------
create table if not exists public.rendicion_movimientos (
    id           uuid primary key default gen_random_uuid(),
    rendicion_id uuid not null references public.rendiciones (id) on delete cascade,
    concepto     varchar(100) not null,
    tipo         varchar(10) not null check (tipo in ('ingreso', 'egreso')),
    importe      numeric(12, 2) not null check (importe > 0),
    detalle      text,
    orden        integer not null default 0,
    created_at   timestamptz not null default now()
);

create index if not exists rendicion_movimientos_rendicion_idx
    on public.rendicion_movimientos (rendicion_id);

alter table public.rendiciones add column if not exists total_ingresos numeric(12, 2) not null default 0;
alter table public.rendiciones add column if not exists total_egresos  numeric(12, 2) not null default 0;

-- ---------------------------------------------------------------------------
-- 3. guardar_rendicion ahora también guarda los movimientos
-- ---------------------------------------------------------------------------
-- p_movimientos: [{ "concepto", "tipo", "importe", "detalle" }, ...]
--   null -> los movimientos no se tocan; un array (aunque sea vacío) los
--           reemplaza a todos.
-- Se borra la versión anterior: con un parámetro más quedarían dos funciones
-- con el mismo nombre y la API no sabría a cuál llamar.
drop function if exists public.guardar_rendicion(uuid, jsonb, date, boolean);

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
        fecha_rendicion  = case
                               when p_cerrar and v_rend.estado = 'emitida' then p_fecha
                               else fecha_rendicion
                           end
    where r.id = p_rendicion_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS y policies de desarrollo
-- ---------------------------------------------------------------------------
alter table public.conceptos_rendicion   enable row level security;
alter table public.rendicion_movimientos enable row level security;

drop policy if exists "dev_full_access_conceptos_rendicion"   on public.conceptos_rendicion;
drop policy if exists "dev_full_access_rendicion_movimientos" on public.rendicion_movimientos;

create policy "dev_full_access_conceptos_rendicion"
    on public.conceptos_rendicion for all to anon, authenticated
    using (true) with check (true);

create policy "dev_full_access_rendicion_movimientos"
    on public.rendicion_movimientos for all to anon, authenticated
    using (true) with check (true);
