-- ===================================================
-- Políticas RLS — MODO DESARROLLO / DEMO
-- ===================================================
-- ATENCIÓN: estas políticas dan acceso total de lectura y escritura a
-- cualquiera que tenga la clave pública (anon), que viaja en el bundle del
-- frontend. Sirven para desarrollo y demo, NO para datos reales de clientes.
-- Para producción multiusuario ejecutá 003_rls_per_user.sql, que las reemplaza.

drop policy if exists "dev_full_access_clients"      on public.clients;
drop policy if exists "dev_full_access_projects"     on public.projects;
drop policy if exists "dev_full_access_invoices"     on public.invoices;
drop policy if exists "dev_full_access_interactions" on public.interactions;

create policy "dev_full_access_clients"
    on public.clients for all
    to anon, authenticated
    using (true) with check (true);

create policy "dev_full_access_projects"
    on public.projects for all
    to anon, authenticated
    using (true) with check (true);

create policy "dev_full_access_invoices"
    on public.invoices for all
    to anon, authenticated
    using (true) with check (true);

create policy "dev_full_access_interactions"
    on public.interactions for all
    to anon, authenticated
    using (true) with check (true);
