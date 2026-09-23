import { getSupabaseClient } from '../lib/supabase';
import { describeSupabaseError } from './supabaseErrors';
import { buildSchedule, round2, today } from '../lib/loanMath';
import {
  Client,
  CollectionRow,
  Installment,
  InstallmentStatus,
  Loan,
  LoanInput,
  Payment,
  PaymentInput,
} from '../types/database';

const LOCAL_LOANS_KEY = 'clientflow_demo_loans';
const LOCAL_INSTALLMENTS_KEY = 'clientflow_demo_installments';
const LOCAL_PAYMENTS_KEY = 'clientflow_demo_payments';

function getLocal<T>(key: string, defaultData: T): T {
  const data = localStorage.getItem(key);
  if (!data) {
    localStorage.setItem(key, JSON.stringify(defaultData));
    return defaultData;
  }
  try {
    return JSON.parse(data);
  } catch {
    return defaultData;
  }
}

function setLocal<T>(key: string, data: T): void {
  localStorage.setItem(key, JSON.stringify(data));
}

/**
 * Estado de una cuota. Misma lógica que la expresión `case` de la vista
 * `v_cobranza`: una cuota vencida sigue siendo "vencida" aunque tenga un pago
 * parcial encima.
 */
export function installmentStatus(
  installment: Pick<Installment, 'amount' | 'paid_amount' | 'due_date'>
): InstallmentStatus {
  const amount = Number(installment.amount) || 0;
  const paid = Number(installment.paid_amount) || 0;

  if (paid >= amount) return 'paid';
  if (installment.due_date < today()) return 'overdue';
  if (paid > 0) return 'partial';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Modo Demo: replica local de los triggers de la base
// ---------------------------------------------------------------------------

function recalcLocal(loanId: string, installmentId?: string | null): void {
  const payments = getLocal<Payment[]>(LOCAL_PAYMENTS_KEY, []);
  const installments = getLocal<Installment[]>(LOCAL_INSTALLMENTS_KEY, []);

  if (installmentId) {
    const propias = payments.filter(p => p.installment_id === installmentId);
    const total = round2(propias.reduce((acc, p) => acc + (Number(p.amount) || 0), 0));
    const index = installments.findIndex(i => i.id === installmentId);

    if (index !== -1) {
      const cuota = installments[index];
      const ultimaFecha = propias.map(p => p.paid_at).sort().pop() || null;
      installments[index] = {
        ...cuota,
        paid_amount: total,
        paid_at: total >= Number(cuota.amount) ? ultimaFecha : null,
      };
      setLocal(LOCAL_INSTALLMENTS_KEY, installments);
    }
  }

  const loans = getLocal<Loan[]>(LOCAL_LOANS_KEY, []);
  const loanIndex = loans.findIndex(l => l.id === loanId);
  if (loanIndex !== -1 && loans[loanIndex].status !== 'cancelled') {
    const saldado = installments
      .filter(i => i.loan_id === loanId)
      .every(i => Number(i.paid_amount) >= Number(i.amount));
    loans[loanIndex] = { ...loans[loanIndex], status: saldado ? 'completed' : 'active' };
    setLocal(LOCAL_LOANS_KEY, loans);
  }
}

export const loanService = {
  // -------------------------------------------------------------------------
  // PRÉSTAMOS
  // -------------------------------------------------------------------------

  async getLoans(clientId?: string): Promise<Loan[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      let query = supabase.from('loans').select('*').order('created_at', { ascending: false });
      if (clientId) query = query.eq('client_id', clientId);

      const { data, error } = await query;
      if (error) throw describeSupabaseError(error, 'No se pudieron cargar los préstamos');
      return (data || []) as Loan[];
    }

    const loans = getLocal<Loan[]>(LOCAL_LOANS_KEY, []);
    return clientId ? loans.filter(l => l.client_id === clientId) : loans;
  },

  /** Crea el préstamo. El plan de cuotas lo arma el trigger de la base. */
  async createLoan(loanData: LoanInput): Promise<Loan> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.from('loans').insert([loanData]).select().single();
      if (error) throw describeSupabaseError(error, 'No se pudo registrar el préstamo');
      return data as Loan;
    }

    const newLoan: Loan = {
      ...loanData,
      fecha_otorgamiento: loanData.fecha_otorgamiento || today(),
      status: loanData.status || 'active',
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };

    const loans = getLocal<Loan[]>(LOCAL_LOANS_KEY, []);
    setLocal(LOCAL_LOANS_KEY, [newLoan, ...loans]);

    // En Modo Demo generamos el cronograma acá, igual que lo hace el trigger.
    const installments = getLocal<Installment[]>(LOCAL_INSTALLMENTS_KEY, []);
    const nuevas: Installment[] = buildSchedule(newLoan).map(row => ({
      id: crypto.randomUUID(),
      loan_id: newLoan.id,
      number: row.number,
      due_date: row.due_date,
      amount: row.amount,
      paid_amount: 0,
      paid_at: null,
    }));
    setLocal(LOCAL_INSTALLMENTS_KEY, [...installments, ...nuevas]);

    return newLoan;
  },

  async updateLoan(id: string, loanData: Partial<Loan>): Promise<Loan> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('loans')
        .update(loanData)
        .eq('id', id)
        .select()
        .single();
      if (error) throw describeSupabaseError(error, 'No se pudo actualizar el préstamo');
      return data as Loan;
    }

    const loans = getLocal<Loan[]>(LOCAL_LOANS_KEY, []);
    const index = loans.findIndex(l => l.id === id);
    if (index === -1) throw new Error('No se encontró el préstamo que querés actualizar.');

    const updated = { ...loans[index], ...loanData };
    loans[index] = updated;
    setLocal(LOCAL_LOANS_KEY, loans);
    return updated;
  },

  async deleteLoan(id: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('loans').delete().eq('id', id);
      if (error) throw describeSupabaseError(error, 'No se pudo eliminar el préstamo');
      return;
    }

    setLocal(
      LOCAL_LOANS_KEY,
      getLocal<Loan[]>(LOCAL_LOANS_KEY, []).filter(l => l.id !== id)
    );
    setLocal(
      LOCAL_INSTALLMENTS_KEY,
      getLocal<Installment[]>(LOCAL_INSTALLMENTS_KEY, []).filter(i => i.loan_id !== id)
    );
    setLocal(
      LOCAL_PAYMENTS_KEY,
      getLocal<Payment[]>(LOCAL_PAYMENTS_KEY, []).filter(p => p.loan_id !== id)
    );
  },

  // -------------------------------------------------------------------------
  // CUOTAS
  // -------------------------------------------------------------------------

  async getInstallments(loanId?: string): Promise<Installment[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      let query = supabase
        .from('installments')
        .select('*')
        .order('due_date', { ascending: true });
      if (loanId) query = query.eq('loan_id', loanId);

      const { data, error } = await query;
      if (error) throw describeSupabaseError(error, 'No se pudieron cargar las cuotas');
      return (data || []) as Installment[];
    }

    const installments = getLocal<Installment[]>(LOCAL_INSTALLMENTS_KEY, []).sort((a, b) =>
      a.due_date.localeCompare(b.due_date)
    );
    return loanId ? installments.filter(i => i.loan_id === loanId) : installments;
  },

  // -------------------------------------------------------------------------
  // COBRANZA
  // -------------------------------------------------------------------------

  /**
   * Una fila por cuota con cliente, zona y cobrador resueltos. En vivo sale de
   * la vista `v_cobranza`; en Modo Demo se arma cruzando el localStorage.
   */
  async getCollection(clients: Client[]): Promise<CollectionRow[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('v_cobranza')
        .select('*')
        .order('due_date', { ascending: true });
      if (error) throw describeSupabaseError(error, 'No se pudo cargar la cobranza');
      return (data || []) as CollectionRow[];
    }

    const loans = getLocal<Loan[]>(LOCAL_LOANS_KEY, []);
    const installments = getLocal<Installment[]>(LOCAL_INSTALLMENTS_KEY, []);

    return installments
      .map(i => {
        const loan = loans.find(l => l.id === i.loan_id);
        const client = clients.find(c => c.id === loan?.client_id);
        if (!loan || !client) return null;

        return {
          installment_id: i.id,
          loan_id: i.loan_id,
          number: i.number,
          due_date: i.due_date,
          amount: Number(i.amount),
          paid_amount: Number(i.paid_amount),
          balance: round2(Number(i.amount) - Number(i.paid_amount)),
          status: installmentStatus(i),
          client_id: client.id,
          loan_status: loan.status,
          client_name: client.name,
          address: client.address,
          phone: client.phone,
          zona: client.zona,
          cobrador: loan.cobrador || client.cobrador,
        } as CollectionRow;
      })
      .filter((row): row is CollectionRow => row !== null)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
  },

  // -------------------------------------------------------------------------
  // PAGOS
  // -------------------------------------------------------------------------

  async getPayments(loanId?: string): Promise<Payment[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      let query = supabase.from('payments').select('*').order('paid_at', { ascending: false });
      if (loanId) query = query.eq('loan_id', loanId);

      const { data, error } = await query;
      if (error) throw describeSupabaseError(error, 'No se pudieron cargar los cobros');
      return (data || []) as Payment[];
    }

    const payments = getLocal<Payment[]>(LOCAL_PAYMENTS_KEY, []).sort((a, b) =>
      b.paid_at.localeCompare(a.paid_at)
    );
    return loanId ? payments.filter(p => p.loan_id === loanId) : payments;
  },

  /** Registra un cobro. Los totales de la cuota los recalcula el trigger. */
  async registerPayment(paymentData: PaymentInput): Promise<Payment> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('payments')
        .insert([paymentData])
        .select()
        .single();
      if (error) throw describeSupabaseError(error, 'No se pudo registrar el cobro');
      return data as Payment;
    }

    const newPayment: Payment = {
      ...paymentData,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    setLocal(LOCAL_PAYMENTS_KEY, [newPayment, ...getLocal<Payment[]>(LOCAL_PAYMENTS_KEY, [])]);
    recalcLocal(newPayment.loan_id, newPayment.installment_id);
    return newPayment;
  },

  async deletePayment(payment: Payment): Promise<void> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('payments').delete().eq('id', payment.id);
      if (error) throw describeSupabaseError(error, 'No se pudo anular el cobro');
      return;
    }

    setLocal(
      LOCAL_PAYMENTS_KEY,
      getLocal<Payment[]>(LOCAL_PAYMENTS_KEY, []).filter(p => p.id !== payment.id)
    );
    recalcLocal(payment.loan_id, payment.installment_id);
  },
};
