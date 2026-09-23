-- ===================================================
-- ClienteFlow — Datos de demostración (opcional)
-- Idempotente: se puede correr varias veces sin duplicar.
-- Requiere el esquema de préstamos y cobranza ya aplicado.
-- ===================================================

-- Catálogo primero: clients.zona y clients.cobrador son claves foráneas.
insert into public.zonas (nombre, descripcion)
values
    ('Centro', 'Microcentro y alrededores'),
    ('Norte', 'Barrio Norte y Villa Mariano Moreno'),
    ('Sur', 'Villa Luján y Villa 9 de Julio'),
    ('Yerba Buena', 'Yerba Buena y Cebil Redondo')
on conflict (nombre) do nothing;

insert into public.rubros (nombre)
values ('Kiosco'), ('Verdulería'), ('Albañilería'), ('Peluquería'), ('Remisero')
on conflict (nombre) do nothing;

insert into public.cobradores (nombre, telefono, zona)
values
    ('Juan Pérez', '3814445566', 'Centro'),
    ('María López', '3815556677', 'Sur')
on conflict (nombre) do nothing;

-- Clientes
insert into public.clients (id, name, address, phone, zona, cobrador, rubro, notes)
values
    ('11111111-1111-1111-1111-111111111111', 'Carlos Mendoza', 'Av. Belgrano 1230, Barrio Centro, San Miguel de Tucumán', '3813045236', 'Centro', 'Juan Pérez', 'Kiosco', 'Cliente de años, nunca falla.'),
    ('22222222-2222-2222-2222-222222222222', 'Mariana Gómez', 'Calle Lavalle 450, Barrio Norte, San Miguel de Tucumán', '3814102233', 'Norte', 'Juan Pérez', 'Verdulería', 'Paga los viernes a la tarde.'),
    ('33333333-3333-3333-3333-333333333333', 'Roberto Fernández', 'Pje. Los Álamos 89, Villa Luján', '3815567788', 'Sur', 'María López', 'Albañilería', 'Atención: cambió de domicilio en agosto.'),
    ('44444444-4444-4444-4444-444444444444', 'Elena Rossi', 'Av. Aconquija 2100, Yerba Buena', '3816778899', 'Yerba Buena', 'María López', 'Peluquería', 'Referida por Mariana Gómez.')
-- Si ya existen (la base migrada los trae del seed original), se completan
on conflict (id) do update
set name     = excluded.name,
    address  = excluded.address,
    phone    = excluded.phone,
    zona     = excluded.zona,
    cobrador = excluded.cobrador,
    rubro    = excluded.rubro,
    notes    = excluded.notes;

-- Préstamos. El trigger genera automáticamente el plan de cuotas semanales.
insert into public.loans (id, client_id, principal, interest_rate, total_amount,
                          installments_count, installment_amount, start_date, cobrador, notes,
                          fecha_otorgamiento)
values
    -- Arrancó hace 6 semanas: ya tiene cuotas vencidas y cuotas por vencer
    ('aa111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
     100000.00, 40.00, 140000.00, 14, 10000.00, current_date - 42, 'Juan Pérez',
     'Renovación del préstamo anterior.', current_date - 49),

    -- Arrancó hace 2 semanas
    ('aa222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
     60000.00, 50.00, 90000.00, 12, 7500.00, current_date - 14, 'Juan Pérez', null, current_date - 21),

    -- Recién otorgado, primera cuota la semana que viene
    ('aa333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444',
     200000.00, 35.00, 270000.00, 18, 15000.00, current_date + 7, 'María López', null, current_date)
on conflict (id) do nothing;

-- Cobros ya registrados. Los triggers actualizan cuotas y estado del préstamo.
-- Se saldan las 4 primeras cuotas de Carlos y se deja la 5ta a medias.
insert into public.payments (loan_id, installment_id, amount, paid_at, cobrador, method)
select i.loan_id,
       i.id,
       case when i.number <= 4 then i.amount else 4000.00 end,
       i.due_date,
       'Juan Pérez',
       'cash'
from public.installments i
where i.loan_id = 'aa111111-1111-1111-1111-111111111111'
  and i.number <= 5
  and not exists (select 1 from public.payments p where p.installment_id = i.id);

-- Mariana pagó sus 2 primeras cuotas en fecha.
insert into public.payments (loan_id, installment_id, amount, paid_at, cobrador, method)
select i.loan_id, i.id, i.amount, i.due_date, 'Juan Pérez', 'cash'
from public.installments i
where i.loan_id = 'aa222222-2222-2222-2222-222222222222'
  and i.number <= 2
  and not exists (select 1 from public.payments p where p.installment_id = i.id);

-- Historial de contactos
insert into public.interactions (id, client_id, type, summary, details, date)
values
    ('cc111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'call', 'Llamada por atraso', 'Se comprometió a pagar dos cuotas juntas el viernes.', now() - interval '2 days'),
    ('cc222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'meeting', 'Visita de cobranza', 'Pagó al día. Consulta por un préstamo nuevo en octubre.', now() - interval '5 days'),
    ('cc333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'note', 'Alta de préstamo', 'Entregado en efectivo en el domicilio.', now() - interval '1 day')
on conflict (id) do nothing;
