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
