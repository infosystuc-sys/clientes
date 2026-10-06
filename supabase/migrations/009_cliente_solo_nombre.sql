-- ===================================================
-- Alta de cliente: sólo el nombre es obligatorio
-- ===================================================
-- Domicilio y teléfono pasan a ser opcionales: se puede dar de alta un cliente
-- con el nombre y completar el resto después. El teléfono, si se carga, sigue
-- validado a 10 dígitos (el check deja pasar el null).
--
-- Re-ejecutable.

alter table public.clients alter column address drop not null;
alter table public.clients alter column phone   drop not null;

-- Un domicilio vacío se guarda como null, no como ''.
update public.clients set address = null where btrim(address) = '';
