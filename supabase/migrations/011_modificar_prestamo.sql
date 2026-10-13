-- ===================================================
-- Modificar un préstamo ya otorgado
-- ===================================================
-- Hasta ahora editar el capital, la cantidad de cuotas, el valor de la cuota o
-- las fechas NO regeneraba el plan. `modificar_prestamo` actualiza el préstamo y
-- reacomoda su plan de cuotas en una sola transacción, sin perder los cobros:
--   * las cuotas existentes se actualizan en el lugar (número, vencimiento e
--     importe), así que sus pagos siguen colgando de ellas;
--   * si hay más cuotas que antes, se agregan al final;
--   * si hay menos, se quitan las últimas, pero sólo si no tienen cobros.
-- El cronograma sigue la misma regla del alta: cuotas semanales de igual valor y
-- la última absorbe la diferencia hasta el total.

create or replace function public.modificar_prestamo(
    p_loan_id            uuid,
    p_client_id          uuid,
    p_principal          numeric,
    p_interest_rate      numeric,
    p_total_amount       numeric,
    p_installments_count int,
    p_installment_amount numeric,
    p_fecha_otorgamiento date,
    p_start_date         date,
    p_cobrador           text default null,
    p_notes              text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_loan      public.loans%rowtype;
    v_actuales  int;
    v_con_pagos int;
    i           int;
    v_acumulado numeric(12, 2) := 0;
    v_cuota     numeric(12, 2);
begin
    select * into v_loan from public.loans where id = p_loan_id for update;
    if not found then
        raise exception 'El préstamo no existe.';
    end if;

    -- Las cuotas que sobran no pueden tener cobros: se perderían
    select count(distinct i2.id) into v_con_pagos
    from public.installments i2
    join public.payments p on p.installment_id = i2.id
    where i2.loan_id = p_loan_id
      and i2.number > p_installments_count;

    if v_con_pagos > 0 then
        raise exception 'No se puede bajar a % cuotas: hay cobros registrados en cuotas posteriores. Anulá esos cobros primero.',
            p_installments_count;
    end if;

    update public.loans
    set client_id          = p_client_id,
        principal          = p_principal,
        interest_rate      = p_interest_rate,
        total_amount       = p_total_amount,
        installments_count = p_installments_count,
        installment_amount = p_installment_amount,
        fecha_otorgamiento = p_fecha_otorgamiento,
        start_date         = p_start_date,
        cobrador           = nullif(trim(p_cobrador), ''),
        notes              = nullif(trim(p_notes), '')
    where id = p_loan_id;

    delete from public.installments
    where loan_id = p_loan_id and number > p_installments_count;

    select count(*) into v_actuales from public.installments where loan_id = p_loan_id;

    for i in 1..p_installments_count loop
        if i < p_installments_count then
            v_cuota := p_installment_amount;
            v_acumulado := v_acumulado + v_cuota;
        else
            v_cuota := p_total_amount - v_acumulado;
        end if;

        if i <= v_actuales then
            update public.installments
            set due_date = p_start_date + ((i - 1) * 7),
                amount   = v_cuota
            where loan_id = p_loan_id and number = i;
        else
            insert into public.installments (loan_id, number, due_date, amount)
            values (p_loan_id, i, p_start_date + ((i - 1) * 7), v_cuota);
        end if;
    end loop;

    -- Con importes nuevos, "cuota saldada" puede haber cambiado
    update public.installments i
    set paid_at = case
                      when i.paid_amount >= i.amount and i.paid_amount > 0 then
                          (select max(p.paid_at) from public.payments p where p.installment_id = i.id)
                      else null
                  end
    where i.loan_id = p_loan_id;

    update public.loans l
    set status = case
                     when not exists (
                         select 1 from public.installments i
                         where i.loan_id = l.id and i.paid_amount < i.amount
                     ) then 'completed'
                     else 'active'
                 end
    where l.id = p_loan_id
      and l.status <> 'cancelled';
end;
$$;
