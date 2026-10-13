-- ===================================================
-- Saldos iniciales: cuotas pagadas antes de pasar al sistema
-- ===================================================
-- Al cargar un préstamo que ya estaba en la calle hay que indicar qué cuotas ya
-- se pagaron, total o parcialmente. Eso se registra como pagos marcados
-- `saldo_inicial`, separados de los cobros reales (cobranza y rendiciones):
-- se pueden corregir desde la edición del préstamo sin tocar esos cobros.

alter table public.payments
    add column if not exists saldo_inicial boolean not null default false;

-- p_pagado: { "<número de cuota>": total pagado de esa cuota, ... }
-- Las cuotas que no figuran no se tocan. El saldo inicial de cada cuota es lo
-- que falta para llegar a ese total después de los cobros reales; se registra
-- con fecha de vencimiento de la cuota (o hoy, si todavía no venció).
create or replace function public.cargar_saldos_iniciales(
    p_loan_id uuid,
    p_pagado  jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_loan    public.loans%rowtype;
    v_cuota   public.installments%rowtype;
    v_clave   text;
    v_deseado numeric(12, 2);
    v_reales  numeric(12, 2);
    v_inicial numeric(12, 2);
begin
    select * into v_loan from public.loans where id = p_loan_id for update;
    if not found then
        raise exception 'El préstamo no existe.';
    end if;

    for v_cuota in
        select * from public.installments where loan_id = p_loan_id order by number
    loop
        v_clave := v_cuota.number::text;
        continue when not (p_pagado ? v_clave);

        v_deseado := coalesce((p_pagado ->> v_clave)::numeric, 0);

        if v_deseado < 0 then
            raise exception 'La cuota % tiene un pagado negativo.', v_cuota.number;
        end if;
        if v_deseado > v_cuota.amount then
            raise exception 'La cuota % no puede tener pagado más que su importe (%).',
                v_cuota.number, v_cuota.amount;
        end if;

        select coalesce(sum(amount) filter (where not saldo_inicial), 0),
               coalesce(sum(amount) filter (where saldo_inicial), 0)
        into v_reales, v_inicial
        from public.payments
        where installment_id = v_cuota.id;

        if v_deseado < v_reales then
            raise exception 'La cuota % ya tiene cobros registrados por %: el pagado no puede ser menor.',
                v_cuota.number, v_reales;
        end if;

        -- Sin cambios: no se toca nada
        continue when v_inicial = v_deseado - v_reales;

        delete from public.payments
        where installment_id = v_cuota.id and saldo_inicial;

        if v_deseado - v_reales > 0 then
            insert into public.payments
                (loan_id, installment_id, amount, paid_at, cobrador, method, notes, saldo_inicial)
            values (
                p_loan_id,
                v_cuota.id,
                v_deseado - v_reales,
                least(v_cuota.due_date, current_date),
                v_loan.cobrador,
                'other',
                'Saldo inicial',
                true
            );
        end if;
    end loop;
end;
$$;
