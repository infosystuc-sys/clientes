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
