-- ===================================================
-- ClienteFlow CRM — Esquema inicial
-- Basado en GUIA_SUPABASE_BACKEND.md
-- ===================================================

-- 1. Clientes
create table if not exists public.clients (
    id          uuid primary key default gen_random_uuid(),
    name        varchar(255) not null,
    company     varchar(255) not null,
    email       varchar(255) not null unique,
    phone       varchar(50),
    address     text,
    status      varchar(50) default 'active'
                check (status in ('active', 'inactive', 'lead', 'vip')),
    category    varchar(50) default 'Pyme'
                check (category in ('Enterprise', 'Pyme', 'Startup', 'Individual')),
    total_spent numeric(12, 2) not null default 0.00,
    notes       text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- 2. Proyectos
create table if not exists public.projects (
    id          uuid primary key default gen_random_uuid(),
    client_id   uuid not null references public.clients (id) on delete cascade,
    name        varchar(255) not null,
    description text,
    status      varchar(50) default 'in_progress'
                check (status in ('planning', 'in_progress', 'completed', 'on_hold')),
    budget      numeric(12, 2) not null default 0.00,
    progress    int not null default 0 check (progress >= 0 and progress <= 100),
    start_date  date default current_date,
    due_date    date,
    created_at  timestamptz not null default now()
);

-- 3. Facturas
create table if not exists public.invoices (
    id             uuid primary key default gen_random_uuid(),
    client_id      uuid not null references public.clients (id) on delete cascade,
    project_id     uuid references public.projects (id) on delete set null,
    invoice_number varchar(100) not null unique,
    amount         numeric(12, 2) not null default 0.00,
    status         varchar(50) default 'pending'
                   check (status in ('paid', 'pending', 'overdue')),
    issue_date     date default current_date,
    due_date       date,
    items_summary  text,
    created_at     timestamptz not null default now()
);

-- 4. Interacciones (historial CRM)
create table if not exists public.interactions (
    id         uuid primary key default gen_random_uuid(),
    client_id  uuid not null references public.clients (id) on delete cascade,
    type       varchar(50) not null check (type in ('call', 'email', 'meeting', 'note')),
    summary    varchar(255) not null,
    details    text,
    date       timestamptz not null default now(),
    created_at timestamptz not null default now()
);

-- 5. Índices sobre las claves foráneas y los campos usados para ordenar/filtrar
create index if not exists projects_client_id_idx     on public.projects (client_id);
create index if not exists invoices_client_id_idx     on public.invoices (client_id);
create index if not exists invoices_project_id_idx    on public.invoices (project_id);
create index if not exists interactions_client_id_idx on public.interactions (client_id);
create index if not exists clients_created_at_idx     on public.clients (created_at desc);
create index if not exists projects_created_at_idx    on public.projects (created_at desc);
create index if not exists invoices_created_at_idx    on public.invoices (created_at desc);
create index if not exists interactions_date_idx      on public.interactions (client_id, date desc);

-- 6. updated_at automático en clients
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
    before update on public.clients
    for each row
    execute function public.set_updated_at();

-- 7. Row Level Security
alter table public.clients      enable row level security;
alter table public.projects     enable row level security;
alter table public.invoices     enable row level security;
alter table public.interactions enable row level security;
