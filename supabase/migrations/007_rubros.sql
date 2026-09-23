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
