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
