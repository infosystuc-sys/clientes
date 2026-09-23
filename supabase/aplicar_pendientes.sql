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

-- 4. Domicilio y teléfono pasan a ser obligatorios, con formato validado
alter table public.clients alter column address set not null;
alter table public.clients alter column phone   set not null;

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


