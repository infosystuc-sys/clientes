-- ===================================================
-- Políticas RLS — PRODUCCIÓN MULTIUSUARIO (OPCIONAL, NO APLICADA)
-- ===================================================
-- Ejecutá este script cuando quieras que cada usuario registrado vea
-- únicamente sus propios datos. Requiere que los usuarios inicien sesión
-- (botón "Autenticación" en la app) antes de poder leer o escribir.
--
-- Migración de datos existentes: después de correrlo, asigná los registros
-- actuales a tu usuario con
--   update public.clients set user_id = '<tu-uuid-de-auth.users>' where user_id is null;

alter table public.clients add column if not exists user_id uuid
    references auth.users (id) on delete cascade default auth.uid();

create index if not exists clients_user_id_idx on public.clients (user_id);

drop policy if exists "dev_full_access_clients"      on public.clients;
drop policy if exists "dev_full_access_projects"     on public.projects;
drop policy if exists "dev_full_access_invoices"     on public.invoices;
drop policy if exists "dev_full_access_interactions" on public.interactions;

-- Los clientes pertenecen al usuario que los creó
create policy "users_own_clients"
    on public.clients for all
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

-- Proyectos, facturas e interacciones heredan la pertenencia del cliente
create policy "users_own_projects"
    on public.projects for all
    to authenticated
    using (exists (select 1 from public.clients c
                   where c.id = client_id and c.user_id = (select auth.uid())))
    with check (exists (select 1 from public.clients c
                        where c.id = client_id and c.user_id = (select auth.uid())));

create policy "users_own_invoices"
    on public.invoices for all
    to authenticated
    using (exists (select 1 from public.clients c
                   where c.id = client_id and c.user_id = (select auth.uid())))
    with check (exists (select 1 from public.clients c
                        where c.id = client_id and c.user_id = (select auth.uid())));

create policy "users_own_interactions"
    on public.interactions for all
    to authenticated
    using (exists (select 1 from public.clients c
                   where c.id = client_id and c.user_id = (select auth.uid())))
    with check (exists (select 1 from public.clients c
                        where c.id = client_id and c.user_id = (select auth.uid())));
