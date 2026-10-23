-- ============================================================
-- PENDIENTE DE APLICAR en el proyecto hkqvcfwezbvdtumdrzhv
-- Pegá TODO este archivo en el SQL Editor de Supabase y dale Run.
-- Se puede ejecutar más de una vez sin romper nada.
--
-- Lleva la base del esquema viejo (proyectos/facturas) al circuito de
-- préstamos, cobranza, catálogos y recibos/rendición de cobradores.
--
-- Equivale a correr, en orden:
--   migrations/004_clients_alta_simplificada.sql
--   migrations/005_prestamos_y_cobranza.sql
--   migrations/006_zonas_y_cobradores.sql
--   migrations/007_rubros.sql
--   migrations/008_recibos_y_rendiciones.sql
--   migrations/009_cliente_solo_nombre.sql
--   migrations/010_rendicion_parcial_y_edicion.sql
--   migrations/011_modificar_prestamo.sql
--   migrations/012_saldos_iniciales.sql
--   migrations/013_imputacion_cobros.sql
--   migrations/014_ingresos_egresos_rendicion.sql
--   migrations/015_un_recibo_por_prestamo.sql
-- ============================================================

-- ===================================================
-- Alta de cliente simplificada
-- ===================================================
-- El alta pasa a pedir sólo: nombre y apellido, domicilio completo y teléfono
-- (obligatorios), más zona y cobrador asignado (opcionales).
--
-- `company` y `email` dejan de pedirse, así que dejan de ser obligatorias. No se
-- eliminan para no perder los datos ya cargados ni romper las vistas que todavía
-- las muestran cuando están presentes.

-- 1. Campos nuevos del circuito de cobranza
alter table public.clients add column if not exists zona     varchar(100);
alter table public.clients add column if not exists cobrador varchar(150);

create index if not exists clients_zona_idx     on public.clients (zona);
create index if not exists clients_cobrador_idx on public.clients (cobrador);

-- 2. Empresa y email ya no se piden en el alta
alter table public.clients alter column company drop not null;
alter table public.clients alter column email   drop not null;

-- 3. Normalizar los teléfonos existentes al formato de 10 dígitos (3813045236):
--    se descarta todo lo que no sea dígito y se conservan los últimos 10
--    (quita prefijos internacionales tipo +54 9).
update public.clients
set phone = right(regexp_replace(phone, '\D', '', 'g'), 10)
where phone is not null
  and phone !~ '^[0-9]{10}$';

-- 4. Teléfono con formato validado. Domicilio y teléfono son opcionales
--    (009: sólo el nombre es obligatorio).
alter table public.clients alter column address drop not null;
alter table public.clients alter column phone   drop not null;
update public.clients set address = null where btrim(address) = '';

alter table public.clients drop constraint if exists clients_phone_format;
alter table public.clients add  constraint clients_phone_format
    check (phone ~ '^[0-9]{10}$');


-- ===================================================
-- Préstamos con cuotas semanales y gestión de cobranza
-- ===================================================
-- Reemplaza el módulo de proyectos y facturación (heredado de la plantilla) por
-- el circuito real: se otorga un préstamo a un cliente, el sistema arma el plan
-- de cuotas semanales, y los cobradores registran los cobros por zona.

-- ---------------------------------------------------------------------------
-- 1. Baja del módulo viejo
-- ---------------------------------------------------------------------------
-- ATENCIÓN: esto borra las tablas de proyectos y facturas con todos sus datos.
drop table if exists public.invoices cascade;
drop table if exists public.projects cascade;

-- ---------------------------------------------------------------------------
-- 2. Préstamos
-- ---------------------------------------------------------------------------
create table if not exists public.loans (
    id                 uuid primary key default gen_random_uuid(),
    client_id          uuid not null references public.clients (id) on delete cascade,
    -- Capital entregado en mano al cliente
    principal          numeric(12, 2) not null check (principal > 0),
    -- Recargo total sobre el capital, en porcentaje (40 = 40%)
    interest_rate      numeric(6, 2) not null default 0 check (interest_rate >= 0),
    -- Total a devolver = capital + recargo
    total_amount       numeric(12, 2) not null check (total_amount > 0),
    installments_count int not null check (installments_count between 1 and 104),
    installment_amount numeric(12, 2) not null check (installment_amount > 0),
    -- Fecha de vencimiento de la primera cuota; las demás caen cada 7 días
    start_date         date not null default current_date,
    -- Si queda en null se cobra el cobrador asignado al cliente
    cobrador           varchar(150),
    status             varchar(20) not null default 'active'
                       check (status in ('active', 'completed', 'cancelled')),
    notes              text,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create index if not exists loans_client_id_idx on public.loans (client_id);
create index if not exists loans_status_idx    on public.loans (status);
create index if not exists loans_cobrador_idx  on public.loans (cobrador);

drop trigger if exists loans_set_updated_at on public.loans;
create trigger loans_set_updated_at
    before update on public.loans
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Cuotas
-- ---------------------------------------------------------------------------
create table if not exists public.installments (
    id          uuid primary key default gen_random_uuid(),
    loan_id     uuid not null references public.loans (id) on delete cascade,
    number      int not null check (number > 0),
    due_date    date not null,
    amount      numeric(12, 2) not null check (amount >= 0),
    -- Se mantiene al día por trigger a partir de la tabla de pagos
    paid_amount numeric(12, 2) not null default 0 check (paid_amount >= 0),
    paid_at     date,
    unique (loan_id, number)
);

create index if not exists installments_loan_id_idx  on public.installments (loan_id);
create index if not exists installments_due_date_idx on public.installments (due_date);

-- ---------------------------------------------------------------------------
-- 4. Pagos (cada cobro registrado por un cobrador)
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
    id             uuid primary key default gen_random_uuid(),
    loan_id        uuid not null references public.loans (id) on delete cascade,
    installment_id uuid references public.installments (id) on delete cascade,
    amount         numeric(12, 2) not null check (amount > 0),
    paid_at        date not null default current_date,
    cobrador       varchar(150),
    method         varchar(20) not null default 'cash'
                   check (method in ('cash', 'transfer', 'other')),
    notes          text,
    created_at     timestamptz not null default now()
);

create index if not exists payments_loan_id_idx        on public.payments (loan_id);
create index if not exists payments_installment_id_idx on public.payments (installment_id);
create index if not exists payments_paid_at_idx        on public.payments (paid_at desc);
create index if not exists payments_cobrador_idx       on public.payments (cobrador);

-- ---------------------------------------------------------------------------
-- 5. Al alta del préstamo se arma el plan de cuotas semanales
-- ---------------------------------------------------------------------------
create or replace function public.generate_loan_installments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    i          int;
    acumulado  numeric(12, 2) := 0;
    cuota      numeric(12, 2);
begin
    for i in 1..new.installments_count loop
        if i < new.installments_count then
            cuota := new.installment_amount;
            acumulado := acumulado + cuota;
        else
            -- La última cuota absorbe la diferencia por redondeo
            cuota := new.total_amount - acumulado;
        end if;

        insert into public.installments (loan_id, number, due_date, amount)
        values (new.id, i, new.start_date + ((i - 1) * 7), cuota);
    end loop;

    return new;
end;
$$;

drop trigger if exists loans_generate_installments on public.loans;
create trigger loans_generate_installments
    after insert on public.loans
    for each row
    execute function public.generate_loan_installments();

-- ---------------------------------------------------------------------------
-- 6. Cada pago recalcula la cuota y, si corresponde, cierra el préstamo
-- ---------------------------------------------------------------------------
create or replace function public.refresh_payment_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    target_installment uuid := coalesce(new.installment_id, old.installment_id);
    target_loan        uuid := coalesce(new.loan_id, old.loan_id);
begin
    if target_installment is not null then
        update public.installments i
        set paid_amount = s.total,
            paid_at     = case when s.total >= i.amount then s.last_date else null end
        from (
            select coalesce(sum(p.amount), 0) as total,
                   max(p.paid_at)             as last_date
            from public.payments p
            where p.installment_id = target_installment
        ) s
        where i.id = target_installment;
    end if;

    -- Un préstamo queda saldado cuando no le queda ninguna cuota con saldo
    update public.loans l
    set status = case
                     when not exists (
                         select 1 from public.installments i
                         where i.loan_id = l.id and i.paid_amount < i.amount
                     ) then 'completed'
                     else 'active'
                 end
    where l.id = target_loan
      and l.status <> 'cancelled';

    return coalesce(new, old);
end;
$$;

drop trigger if exists payments_refresh_totals on public.payments;
create trigger payments_refresh_totals
    after insert or update or delete on public.payments
    for each row
    execute function public.refresh_payment_totals();

-- ---------------------------------------------------------------------------
-- 7. Vista de cobranza: una fila por cuota, con zona y cobrador resueltos
-- ---------------------------------------------------------------------------
-- security_invoker hace que la vista respete las policies de quien consulta.
drop view if exists public.v_cobranza;
create view public.v_cobranza with (security_invoker = true) as
select
    i.id                        as installment_id,
    i.loan_id,
    i.number,
    i.due_date,
    i.amount,
    i.paid_amount,
    (i.amount - i.paid_amount)  as balance,
    case
        when i.paid_amount >= i.amount then 'paid'
        when i.due_date < current_date then 'overdue'
        when i.paid_amount > 0         then 'partial'
        else 'pending'
    end                         as status,
    l.client_id,
    l.status                    as loan_status,
    c.name                      as client_name,
    c.address,
    c.phone,
    c.zona,
    coalesce(l.cobrador, c.cobrador) as cobrador
from public.installments i
join public.loans   l on l.id = i.loan_id
join public.clients c on c.id = l.client_id;

-- ---------------------------------------------------------------------------
-- 8. RLS y policies de desarrollo, iguales a las del resto de las tablas
-- ---------------------------------------------------------------------------
alter table public.loans        enable row level security;
alter table public.installments enable row level security;
alter table public.payments     enable row level security;

drop policy if exists "dev_full_access_loans"        on public.loans;
drop policy if exists "dev_full_access_installments" on public.installments;
drop policy if exists "dev_full_access_payments"     on public.payments;

create policy "dev_full_access_loans"
    on public.loans for all to anon, authenticated
    using (true) with check (true);

create policy "dev_full_access_installments"
    on public.installments for all to anon, authenticated
    using (true) with check (true);

create policy "dev_full_access_payments"
    on public.payments for all to anon, authenticated
    using (true) with check (true);


-- ===================================================
-- Catálogo de zonas y cobradores
-- ===================================================
-- Hasta ahora la zona y el cobrador eran texto libre en cada cliente: se
-- prestaban a typos ("Centro" vs "centro") y no había forma de renombrar una
-- zona sin tocar fila por fila.
--
-- Se agregan dos tablas de catálogo y se enganchan por el NOMBRE, con
-- ON UPDATE CASCADE. Elegido a propósito sobre un id numérico: renombrar una
-- zona o un cobrador propaga solo a todos los clientes y préstamos, y el resto
-- de la app sigue leyendo `clients.zona` como texto, sin joins extra.

-- ---------------------------------------------------------------------------
-- 1. Zonas
-- ---------------------------------------------------------------------------
create table if not exists public.zonas (
    id          uuid primary key default gen_random_uuid(),
    nombre      varchar(100) not null unique,
    descripcion text,
    activa      boolean not null default true,
    created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Cobradores
-- ---------------------------------------------------------------------------
create table if not exists public.cobradores (
    id         uuid primary key default gen_random_uuid(),
    nombre     varchar(150) not null unique,
    telefono   varchar(10) check (telefono is null or telefono ~ '^[0-9]{10}$'),
    -- Zona principal del cobrador (informativa: puede cobrar en otras)
    zona       varchar(100),
    activo     boolean not null default true,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Sembrar el catálogo con lo que ya estaba cargado a mano
-- ---------------------------------------------------------------------------
insert into public.zonas (nombre)
select distinct trim(zona)
from public.clients
where zona is not null and trim(zona) <> ''
on conflict (nombre) do nothing;

insert into public.cobradores (nombre)
select distinct trim(nombre) from (
    select cobrador as nombre from public.clients
    union
    select cobrador from public.loans
    union
    select cobrador from public.payments
) t
where nombre is not null and trim(nombre) <> ''
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Integridad referencial por nombre
-- ---------------------------------------------------------------------------
-- Renombrar propaga (ON UPDATE CASCADE); borrar deja el registro sin
-- zona/cobrador asignado en vez de borrar clientes o préstamos.
alter table public.cobradores drop constraint if exists cobradores_zona_fk;
alter table public.cobradores add  constraint cobradores_zona_fk
    foreign key (zona) references public.zonas (nombre)
    on update cascade on delete set null;

alter table public.clients drop constraint if exists clients_zona_fk;
alter table public.clients add  constraint clients_zona_fk
    foreign key (zona) references public.zonas (nombre)
    on update cascade on delete set null;

alter table public.clients drop constraint if exists clients_cobrador_fk;
alter table public.clients add  constraint clients_cobrador_fk
    foreign key (cobrador) references public.cobradores (nombre)
    on update cascade on delete set null;

alter table public.loans drop constraint if exists loans_cobrador_fk;
alter table public.loans add  constraint loans_cobrador_fk
    foreign key (cobrador) references public.cobradores (nombre)
    on update cascade on delete set null;

-- `payments.cobrador` queda SIN clave foránea a propósito: es el registro
-- histórico de quién cobró. Si un cobrador se da de baja, los cobros que hizo
-- tienen que seguir diciendo su nombre.

create index if not exists cobradores_zona_idx on public.cobradores (zona);

-- ---------------------------------------------------------------------------
-- 5. RLS y policies de desarrollo
-- ---------------------------------------------------------------------------
alter table public.zonas      enable row level security;
alter table public.cobradores enable row level security;

drop policy if exists "dev_full_access_zonas"      on public.zonas;
drop policy if exists "dev_full_access_cobradores" on public.cobradores;

create policy "dev_full_access_zonas"
    on public.zonas for all to anon, authenticated
    using (true) with check (true);

create policy "dev_full_access_cobradores"
    on public.cobradores for all to anon, authenticated
    using (true) with check (true);


-- ===================================================
-- Rubros: reemplazan a `clients.category`
-- ===================================================
-- `category` venía de la plantilla con valores fijos que no significaban nada
-- para este negocio (Enterprise / Pyme / Startup / Individual). Pasa a ser
-- `rubro`, un catálogo administrable desde Configuración, enganchado por nombre
-- con ON UPDATE CASCADE igual que zonas y cobradores.

-- ---------------------------------------------------------------------------
-- 1. Catálogo de rubros
-- ---------------------------------------------------------------------------
create table if not exists public.rubros (
    id          uuid primary key default gen_random_uuid(),
    nombre      varchar(100) not null unique,
    descripcion text,
    activo      boolean not null default true,
    created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Nueva columna y traspaso de lo que había en `category`
-- ---------------------------------------------------------------------------
alter table public.clients add column if not exists rubro varchar(100);

do $$
begin
    -- Sólo si la columna vieja todavía existe (para poder re-ejecutar el script)
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'clients' and column_name = 'category'
    ) then
        -- Los valores viejos se conservan como rubros para no perder nada.
        -- Se pueden renombrar o borrar desde Configuración.
        insert into public.rubros (nombre)
        select distinct trim(category)
        from public.clients
        where category is not null and trim(category) <> ''
        on conflict (nombre) do nothing;

        update public.clients set rubro = trim(category) where rubro is null and category is not null;

        alter table public.clients drop column category;
    end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Integridad referencial
-- ---------------------------------------------------------------------------
alter table public.clients drop constraint if exists clients_rubro_fk;
alter table public.clients add  constraint clients_rubro_fk
    foreign key (rubro) references public.rubros (nombre)
    on update cascade on delete set null;

create index if not exists clients_rubro_idx on public.clients (rubro);

-- ---------------------------------------------------------------------------
-- 4. RLS y policies de desarrollo
-- ---------------------------------------------------------------------------
alter table public.rubros enable row level security;

drop policy if exists "dev_full_access_rubros" on public.rubros;

create policy "dev_full_access_rubros"
    on public.rubros for all to anon, authenticated
    using (true) with check (true);


-- ===================================================
-- Emisión de recibos y rendición de cobradores
-- ===================================================
-- Circuito:
--   1. Se EMITE una planilla para un cobrador y/o zona y un rango de fechas: un
--      recibo por cada cuota impaga que vence en ese lapso.
--   2. El cobrador sale con los recibos impresos y anota a mano lo que cobra.
--   3. Al volver se RINDE la planilla: se carga lo cobrado en cada recibo y el
--      sistema registra los pagos contra cada cuota, todo en una transacción.
--
-- Los datos del recibo se guardan como FOTO al momento de emitir: una
-- reimpresión tiene que salir idéntica a la que se entregó, aunque después se
-- hayan registrado pagos.

-- ---------------------------------------------------------------------------
-- 1. Número de cliente (el "CLIENTE N°" del recibo)
-- ---------------------------------------------------------------------------
-- Es editable a propósito: permite conservar la numeración que ya se usaba en
-- papel. Si se deja vacío, se asigna el siguiente libre.
alter table public.clients add column if not exists numero integer;

with ordenados as (
    select id, row_number() over (order by created_at, id) as n
    from public.clients
    where numero is null
)
update public.clients c
set numero = o.n + coalesce((select max(numero) from public.clients), 0)
from ordenados o
where c.id = o.id;

alter table public.clients alter column numero set not null;

alter table public.clients drop constraint if exists clients_numero_key;
alter table public.clients add  constraint clients_numero_key unique (numero);

alter table public.clients drop constraint if exists clients_numero_positivo;
alter table public.clients add  constraint clients_numero_positivo check (numero > 0);

create or replace function public.assign_client_numero()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.numero is null then
        -- Serializa las altas simultáneas para que no salgan dos con el mismo número
        perform pg_advisory_xact_lock(hashtext('public.clients.numero'));
        select coalesce(max(numero), 0) + 1 into new.numero from public.clients;
    end if;
    return new;
end;
$$;

drop trigger if exists clients_assign_numero on public.clients;
create trigger clients_assign_numero
    before insert on public.clients
    for each row
    execute function public.assign_client_numero();

-- ---------------------------------------------------------------------------
-- 1b. Fecha de otorgamiento del préstamo (la "FECHA EMISIÓN" del recibo)
-- ---------------------------------------------------------------------------
-- No alcanza con created_at: al pasar al sistema préstamos que ya estaban en la
-- calle, la fecha de carga no es la fecha en que se entregó la plata.
alter table public.loans add column if not exists fecha_otorgamiento date;
update public.loans set fecha_otorgamiento = created_at::date where fecha_otorgamiento is null;
alter table public.loans alter column fecha_otorgamiento set default current_date;
alter table public.loans alter column fecha_otorgamiento set not null;

-- ---------------------------------------------------------------------------
-- 2. Planillas de rendición
-- ---------------------------------------------------------------------------
create table if not exists public.rendiciones (
    id                uuid primary key default gen_random_uuid(),
    numero            integer generated by default as identity unique,
    -- Filtros con los que se emitió (texto: es un registro histórico)
    cobrador          varchar(150),
    zona              varchar(100),
    desde             date not null,
    hasta             date not null check (hasta >= desde),
    incluye_vencidas  boolean not null default false,
    estado            varchar(20) not null default 'emitida'
                      check (estado in ('emitida', 'rendida')),
    fecha_emision     timestamptz not null default now(),
    fecha_rendicion   date,
    cantidad_recibos  integer not null default 0,
    total_esperado    numeric(12, 2) not null default 0,
    total_cobrado     numeric(12, 2),
    observaciones     text,
    created_at        timestamptz not null default now()
);

create index if not exists rendiciones_estado_idx   on public.rendiciones (estado);
create index if not exists rendiciones_cobrador_idx on public.rendiciones (cobrador);

-- ---------------------------------------------------------------------------
-- 3. Recibos (uno por cuota), con la foto de los datos al emitir
-- ---------------------------------------------------------------------------
create table if not exists public.rendicion_items (
    id                 uuid primary key default gen_random_uuid(),
    rendicion_id       uuid not null references public.rendiciones (id) on delete cascade,
    numero_recibo      integer not null,
    installment_id     uuid references public.installments (id) on delete set null,
    loan_id            uuid references public.loans (id) on delete set null,
    client_id          uuid references public.clients (id) on delete set null,

    -- Cliente
    cliente_numero     integer,
    cliente_nombre     text not null,
    domicilio          text,
    telefono           text,
    rubro              text,
    zona               text,
    cobrador           text,

    -- Préstamo
    credito_numero     integer not null default 0,
    fecha_otorgamiento date,
    cuotas_total       integer,
    valor_cuota        numeric(12, 2),
    prestamo_total     numeric(12, 2),
    prestamo_pagado    numeric(12, 2),
    prestamo_saldo     numeric(12, 2),
    ultimo_pago        date,
    atraso             numeric(12, 2) not null default 0,

    -- Cuota a cobrar
    cuota_numero       integer,
    vencimiento        date,
    importe            numeric(12, 2) not null,

    -- Resultado de la rendición
    monto_cobrado      numeric(12, 2) check (monto_cobrado >= 0),
    payment_id         uuid references public.payments (id) on delete set null,

    unique (rendicion_id, numero_recibo)
);

create index if not exists rendicion_items_rendicion_idx   on public.rendicion_items (rendicion_id);
create index if not exists rendicion_items_installment_idx on public.rendicion_items (installment_id);

-- Una planilla rendida ya generó pagos: no se puede borrar sin descuadrar la caja.
create or replace function public.prevent_delete_rendida()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.estado = 'rendida' then
        raise exception 'La planilla N° % ya fue rendida y no se puede anular.', old.numero;
    end if;
    return old;
end;
$$;

drop trigger if exists rendiciones_prevent_delete on public.rendiciones;
create trigger rendiciones_prevent_delete
    before delete on public.rendiciones
    for each row
    execute function public.prevent_delete_rendida();

-- ---------------------------------------------------------------------------
-- 4. Emitir: arma la planilla y sus recibos en una sola transacción
-- ---------------------------------------------------------------------------
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

    insert into public.rendicion_items (
        rendicion_id, numero_recibo, installment_id, loan_id, client_id,
        cliente_numero, cliente_nombre, domicilio, telefono, rubro, zona, cobrador,
        credito_numero, fecha_otorgamiento, cuotas_total, valor_cuota,
        prestamo_total, prestamo_pagado, prestamo_saldo, ultimo_pago, atraso,
        cuota_numero, vencimiento, importe
    )
    select
        v_id,
        row_number() over (order by c.zona nulls last, c.numero, i.due_date),
        i.id, l.id, c.id,
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
        i.number,
        i.due_date,
        i.amount - i.paid_amount
    from public.installments i
    join public.loans   l on l.id = i.loan_id
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
    ) cred
    where l.status = 'active'
      and i.paid_amount < i.amount
      and i.due_date <= p_hasta
      and (p_incluir_vencidas or i.due_date >= p_desde)
      and (p_cobrador is null or coalesce(l.cobrador, c.cobrador) = p_cobrador)
      and (p_zona is null or c.zona = p_zona)
      -- Una cuota que ya salió en otra planilla todavía sin rendir no se reimprime
      and not exists (
          select 1
          from public.rendicion_items ri
          join public.rendiciones r on r.id = ri.rendicion_id
          where ri.installment_id = i.id
            and r.estado = 'emitida'
            and r.id <> v_id
      );

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

-- ---------------------------------------------------------------------------
-- 5. Rendir: registra los cobros de toda la planilla en una sola transacción
-- ---------------------------------------------------------------------------
-- p_montos: objeto JSON { "<id del recibo>": monto_cobrado, ... }.
-- Los recibos que no figuran se toman como no cobrados (0).
create or replace function public.rendir_rendicion(
    p_rendicion_id uuid,
    p_montos       jsonb,
    p_fecha        date default current_date
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_rend  public.rendiciones%rowtype;
    v_item  public.rendicion_items%rowtype;
    v_monto numeric(12, 2);
    v_pago  uuid;
    v_total numeric(12, 2) := 0;
begin
    select * into v_rend
    from public.rendiciones
    where id = p_rendicion_id
    for update;

    if not found then
        raise exception 'La planilla no existe.';
    end if;
    if v_rend.estado <> 'emitida' then
        raise exception 'La planilla N° % ya fue rendida.', v_rend.numero;
    end if;

    for v_item in
        select * from public.rendicion_items
        where rendicion_id = p_rendicion_id
        order by numero_recibo
    loop
        v_monto := coalesce((p_montos ->> v_item.id::text)::numeric, 0);

        if v_monto < 0 then
            raise exception 'El recibo % tiene un monto negativo.', v_item.numero_recibo;
        end if;

        v_pago := null;
        if v_monto > 0 and v_item.installment_id is not null and v_item.loan_id is not null then
            insert into public.payments (loan_id, installment_id, amount, paid_at, cobrador, method, notes)
            values (
                v_item.loan_id,
                v_item.installment_id,
                v_monto,
                coalesce(p_fecha, current_date),
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

        v_total := v_total + v_monto;
    end loop;

    update public.rendiciones
    set estado          = 'rendida',
        fecha_rendicion = coalesce(p_fecha, current_date),
        total_cobrado   = v_total
    where id = p_rendicion_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS y policies de desarrollo
-- ---------------------------------------------------------------------------
alter table public.rendiciones     enable row level security;
alter table public.rendicion_items enable row level security;

drop policy if exists "dev_full_access_rendiciones"     on public.rendiciones;
drop policy if exists "dev_full_access_rendicion_items" on public.rendicion_items;

create policy "dev_full_access_rendiciones"
    on public.rendiciones for all to anon, authenticated
    using (true) with check (true);

create policy "dev_full_access_rendicion_items"
    on public.rendicion_items for all to anon, authenticated
    using (true) with check (true);




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


-- ===================================================
-- Modificar un préstamo ya otorgado
-- ===================================================
-- Hasta ahora editar el capital, la cantidad de cuotas, el valor de la cuota o
-- las fechas NO regeneraba el plan. `modificar_prestamo` actualiza el préstamo y
-- reacomoda su plan de cuotas en una sola transacción, sin perder los cobros:
--   * las cuotas existentes se actualizan en el lugar (número, vencimiento e
--     importe), así que sus pagos siguen colgando de ellas;
--   * si hay más cuotas que antes, se agregan al final;
--   * si hay menos, se quitan las últimas, pero sólo si no tienen cobros.
-- El cronograma sigue la misma regla del alta: cuotas semanales de igual valor y
-- la última absorbe la diferencia hasta el total.

create or replace function public.modificar_prestamo(
    p_loan_id            uuid,
    p_client_id          uuid,
    p_principal          numeric,
    p_interest_rate      numeric,
    p_total_amount       numeric,
    p_installments_count int,
    p_installment_amount numeric,
    p_fecha_otorgamiento date,
    p_start_date         date,
    p_cobrador           text default null,
    p_notes              text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_loan      public.loans%rowtype;
    v_actuales  int;
    v_con_pagos int;
    i           int;
    v_acumulado numeric(12, 2) := 0;
    v_cuota     numeric(12, 2);
begin
    select * into v_loan from public.loans where id = p_loan_id for update;
    if not found then
        raise exception 'El préstamo no existe.';
    end if;

    -- Las cuotas que sobran no pueden tener cobros: se perderían
    select count(distinct i2.id) into v_con_pagos
    from public.installments i2
    join public.payments p on p.installment_id = i2.id
    where i2.loan_id = p_loan_id
      and i2.number > p_installments_count;

    if v_con_pagos > 0 then
        raise exception 'No se puede bajar a % cuotas: hay cobros registrados en cuotas posteriores. Anulá esos cobros primero.',
            p_installments_count;
    end if;

    update public.loans
    set client_id          = p_client_id,
        principal          = p_principal,
        interest_rate      = p_interest_rate,
        total_amount       = p_total_amount,
        installments_count = p_installments_count,
        installment_amount = p_installment_amount,
        fecha_otorgamiento = p_fecha_otorgamiento,
        start_date         = p_start_date,
        cobrador           = nullif(trim(p_cobrador), ''),
        notes              = nullif(trim(p_notes), '')
    where id = p_loan_id;

    delete from public.installments
    where loan_id = p_loan_id and number > p_installments_count;

    select count(*) into v_actuales from public.installments where loan_id = p_loan_id;

    for i in 1..p_installments_count loop
        if i < p_installments_count then
            v_cuota := p_installment_amount;
            v_acumulado := v_acumulado + v_cuota;
        else
            v_cuota := p_total_amount - v_acumulado;
        end if;

        if i <= v_actuales then
            update public.installments
            set due_date = p_start_date + ((i - 1) * 7),
                amount   = v_cuota
            where loan_id = p_loan_id and number = i;
        else
            insert into public.installments (loan_id, number, due_date, amount)
            values (p_loan_id, i, p_start_date + ((i - 1) * 7), v_cuota);
        end if;
    end loop;

    -- Con importes nuevos, "cuota saldada" puede haber cambiado
    update public.installments i
    set paid_at = case
                      when i.paid_amount >= i.amount and i.paid_amount > 0 then
                          (select max(p.paid_at) from public.payments p where p.installment_id = i.id)
                      else null
                  end
    where i.loan_id = p_loan_id;

    update public.loans l
    set status = case
                     when not exists (
                         select 1 from public.installments i
                         where i.loan_id = l.id and i.paid_amount < i.amount
                     ) then 'completed'
                     else 'active'
                 end
    where l.id = p_loan_id
      and l.status <> 'cancelled';
end;
$$;


-- ===================================================
-- Saldos iniciales: cuotas pagadas antes de pasar al sistema
-- ===================================================
-- Al cargar un préstamo que ya estaba en la calle hay que indicar qué cuotas ya
-- se pagaron, total o parcialmente. Eso se registra como pagos marcados
-- `saldo_inicial`, separados de los cobros reales (cobranza y rendiciones):
-- se pueden corregir desde la edición del préstamo sin tocar esos cobros.

alter table public.payments
    add column if not exists saldo_inicial boolean not null default false;

-- p_pagado: { "<número de cuota>": total pagado de esa cuota, ... }
-- Las cuotas que no figuran no se tocan. El saldo inicial de cada cuota es lo
-- que falta para llegar a ese total después de los cobros reales; se registra
-- con fecha de vencimiento de la cuota (o hoy, si todavía no venció).
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

        if v_deseado < 0 then
            raise exception 'La cuota % tiene un pagado negativo.', v_cuota.number;
        end if;
        if v_deseado > v_cuota.amount then
            raise exception 'La cuota % no puede tener pagado más que su importe (%).',
                v_cuota.number, v_cuota.amount;
        end if;

        select coalesce(sum(amount) filter (where not saldo_inicial), 0),
               coalesce(sum(amount) filter (where saldo_inicial), 0)
        into v_reales, v_inicial
        from public.payments
        where installment_id = v_cuota.id;

        if v_deseado < v_reales then
            raise exception 'La cuota % ya tiene cobros registrados por %: el pagado no puede ser menor.',
                v_cuota.number, v_reales;
        end if;

        -- Sin cambios: no se toca nada
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


-- ===================================================
-- Un solo recibo por préstamo con toda la deuda a la fecha
-- ===================================================
-- Antes la planilla tenía un recibo por cuota: un cliente con tres cuotas
-- atrasadas recibía tres recibos. Ahora sale UN recibo por préstamo con todo lo
-- que adeuda hasta la fecha "hasta" de la emisión (y, si no se incluyen las
-- atrasadas, sólo lo que vence dentro del período).
--
-- El recibo guarda todas las cuotas que agrupa (`installment_ids`) para que no
-- se vuelvan a emitir en otra planilla mientras esta siga abierta. Al rendir,
-- lo cobrado ya se imputa a las cuotas pendientes más viejas (013), así que no
-- cambia nada ahí.

alter table public.rendicion_items add column if not exists installment_ids  uuid[];
alter table public.rendicion_items add column if not exists cuota_hasta      integer;
alter table public.rendicion_items add column if not exists cuotas_incluidas integer not null default 1;

-- Los recibos ya emitidos son de una sola cuota
update public.rendicion_items
set installment_ids = array[installment_id],
    cuota_hasta     = cuota_numero
where installment_ids is null and installment_id is not null;

create index if not exists rendicion_items_installment_ids_idx
    on public.rendicion_items using gin (installment_ids);

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
          -- Una cuota que ya está en otra planilla todavía sin rendir no se repite
          and not exists (
              select 1
              from public.rendicion_items ri
              join public.rendiciones r on r.id = ri.rendicion_id
              where r.estado = 'emitida'
                and r.id <> v_id
                and (ri.installment_id = i.id or i.id = any (ri.installment_ids))
          )
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
