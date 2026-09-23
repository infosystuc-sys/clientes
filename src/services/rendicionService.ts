import { getSupabaseClient } from '../lib/supabase';
import { describeSupabaseError } from './supabaseErrors';
import { loanService } from './loanService';
import { round2, today } from '../lib/loanMath';
import {
  Client,
  EmisionParams,
  Installment,
  Loan,
  Payment,
  Rendicion,
  RendicionItem,
} from '../types/database';

const LOCAL_RENDICIONES_KEY = 'clientflow_demo_rendiciones';
const LOCAL_ITEMS_KEY = 'clientflow_demo_rendicion_items';
// Claves que escriben clientService y loanService
const LOCAL_CLIENTS_KEY = 'clientflow_demo_clients';
const LOCAL_LOANS_KEY = 'clientflow_demo_loans';
const LOCAL_INSTALLMENTS_KEY = 'clientflow_demo_installments';
const LOCAL_PAYMENTS_KEY = 'clientflow_demo_payments';

function getLocal<T>(key: string, defaultData: T): T {
  const data = localStorage.getItem(key);
  if (!data) return defaultData;
  try {
    return JSON.parse(data);
  } catch {
    return defaultData;
  }
}

function setLocal<T>(key: string, data: T): void {
  localStorage.setItem(key, JSON.stringify(data));
}

/** Ids de cuotas que ya salieron en una planilla todavía sin rendir. */
function installmentsEnPlanillasAbiertas(): Set<string> {
  const abiertas = new Set(
    getLocal<Rendicion[]>(LOCAL_RENDICIONES_KEY, [])
      .filter(r => r.estado === 'emitida')
      .map(r => r.id)
  );
  return new Set(
    getLocal<RendicionItem[]>(LOCAL_ITEMS_KEY, [])
      .filter(i => abiertas.has(i.rendicion_id) && i.installment_id)
      .map(i => i.installment_id as string)
  );
}

/**
 * Modo Demo: replica `emitir_rendicion` de la base. Mismos filtros, mismo
 * orden y mismos datos en la foto del recibo.
 */
function emitirLocal(params: EmisionParams): Rendicion {
  const { desde, hasta, incluirVencidas } = params;
  const cobrador = params.cobrador?.trim() || null;
  const zona = params.zona?.trim() || null;
  const hoy = today();

  if (!desde || !hasta) throw new Error('Indicá el rango de fechas a emitir.');
  if (hasta < desde) throw new Error('La fecha "hasta" no puede ser anterior a "desde".');

  const clients = getLocal<Client[]>(LOCAL_CLIENTS_KEY, []);
  const loans = getLocal<Loan[]>(LOCAL_LOANS_KEY, []);
  const installments = getLocal<Installment[]>(LOCAL_INSTALLMENTS_KEY, []);
  const payments = getLocal<Payment[]>(LOCAL_PAYMENTS_KEY, []);
  const yaEmitidas = installmentsEnPlanillasAbiertas();

  const candidatas = installments
    .map(i => {
      const loan = loans.find(l => l.id === i.loan_id);
      const client = loan && clients.find(c => c.id === loan.client_id);
      return loan && client ? { i, loan, client } : null;
    })
    .filter((x): x is { i: Installment; loan: Loan; client: Client } => x !== null)
    .filter(({ i, loan, client }) => {
      const cobradorEfectivo = loan.cobrador || client.cobrador || null;
      return (
        loan.status === 'active' &&
        Number(i.paid_amount) < Number(i.amount) &&
        i.due_date <= hasta &&
        (incluirVencidas || i.due_date >= desde) &&
        (!cobrador || cobradorEfectivo === cobrador) &&
        (!zona || client.zona === zona) &&
        !yaEmitidas.has(i.id)
      );
    })
    .sort(
      (a, b) =>
        // zona (sin zona al final), N° de cliente, vencimiento
        (a.client.zona ? 0 : 1) - (b.client.zona ? 0 : 1) ||
        (a.client.zona || '').localeCompare(b.client.zona || '') ||
        (a.client.numero || 0) - (b.client.numero || 0) ||
        a.i.due_date.localeCompare(b.i.due_date)
    );

  if (candidatas.length === 0) {
    throw new Error('No hay cuotas pendientes para emitir con esos filtros.');
  }

  const rendiciones = getLocal<Rendicion[]>(LOCAL_RENDICIONES_KEY, []);
  const rendicion: Rendicion = {
    id: crypto.randomUUID(),
    numero: rendiciones.reduce((max, r) => Math.max(max, r.numero), 0) + 1,
    cobrador,
    zona,
    desde,
    hasta,
    incluye_vencidas: incluirVencidas,
    estado: 'emitida',
    fecha_emision: new Date().toISOString(),
    fecha_rendicion: null,
    cantidad_recibos: candidatas.length,
    total_esperado: 0,
    total_cobrado: null,
    created_at: new Date().toISOString(),
  };

  const items: RendicionItem[] = candidatas.map(({ i, loan, client }, idx) => {
    const cuotasDelPrestamo = installments.filter(x => x.loan_id === loan.id);
    const pagado = round2(cuotasDelPrestamo.reduce((a, x) => a + Number(x.paid_amount), 0));
    const atraso = round2(
      cuotasDelPrestamo
        .filter(x => x.due_date < hoy && Number(x.paid_amount) < Number(x.amount))
        .reduce((a, x) => a + Number(x.amount) - Number(x.paid_amount), 0)
    );
    const ultimoPago =
      payments
        .filter(p => p.loan_id === loan.id)
        .map(p => p.paid_at)
        .sort()
        .pop() || null;
    // Mismo orden que la base: fecha de otorgamiento y, a igual fecha, alta
    const clave = (l: Loan) => `${l.fecha_otorgamiento || l.created_at.slice(0, 10)}|${l.created_at}|${l.id}`;
    const creditoNumero = loans.filter(
      l => l.client_id === loan.client_id && clave(l) < clave(loan)
    ).length;

    return {
      id: crypto.randomUUID(),
      rendicion_id: rendicion.id,
      numero_recibo: idx + 1,
      installment_id: i.id,
      loan_id: loan.id,
      client_id: client.id,
      cliente_numero: client.numero ?? null,
      cliente_nombre: client.name,
      domicilio: client.address,
      telefono: client.phone,
      rubro: client.rubro ?? null,
      zona: client.zona ?? null,
      cobrador: loan.cobrador || client.cobrador || null,
      credito_numero: creditoNumero,
      fecha_otorgamiento: loan.fecha_otorgamiento || loan.created_at.slice(0, 10),
      cuotas_total: loan.installments_count,
      valor_cuota: Number(loan.installment_amount),
      prestamo_total: Number(loan.total_amount),
      prestamo_pagado: pagado,
      prestamo_saldo: round2(Number(loan.total_amount) - pagado),
      ultimo_pago: ultimoPago,
      atraso,
      cuota_numero: i.number,
      vencimiento: i.due_date,
      importe: round2(Number(i.amount) - Number(i.paid_amount)),
      monto_cobrado: null,
      payment_id: null,
    };
  });

  rendicion.total_esperado = round2(items.reduce((a, i) => a + i.importe, 0));

  setLocal(LOCAL_RENDICIONES_KEY, [rendicion, ...rendiciones]);
  setLocal(LOCAL_ITEMS_KEY, [...getLocal<RendicionItem[]>(LOCAL_ITEMS_KEY, []), ...items]);
  return rendicion;
}

export const rendicionService = {
  async getRendiciones(): Promise<Rendicion[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('rendiciones')
        .select('*')
        .order('numero', { ascending: false });
      if (error) throw describeSupabaseError(error, 'No se pudieron cargar las planillas');
      return (data || []) as Rendicion[];
    }

    return getLocal<Rendicion[]>(LOCAL_RENDICIONES_KEY, []).sort((a, b) => b.numero - a.numero);
  },

  async getItems(rendicionId: string): Promise<RendicionItem[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('rendicion_items')
        .select('*')
        .eq('rendicion_id', rendicionId)
        .order('numero_recibo', { ascending: true });
      if (error) throw describeSupabaseError(error, 'No se pudieron cargar los recibos');
      return (data || []) as RendicionItem[];
    }

    return getLocal<RendicionItem[]>(LOCAL_ITEMS_KEY, [])
      .filter(i => i.rendicion_id === rendicionId)
      .sort((a, b) => a.numero_recibo - b.numero_recibo);
  },

  /** Para la vista previa: cuotas que no se van a volver a emitir. */
  async getInstallmentsEnPlanillasAbiertas(): Promise<Set<string>> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('rendicion_items')
        .select('installment_id, rendiciones!inner(estado)')
        .eq('rendiciones.estado', 'emitida');
      if (error) throw describeSupabaseError(error, 'No se pudieron cargar las planillas abiertas');
      return new Set(
        (data || []).map((r: any) => r.installment_id).filter(Boolean) as string[]
      );
    }

    return installmentsEnPlanillasAbiertas();
  },

  /** Emite la planilla y sus recibos. Devuelve la planilla creada. */
  async emitir(params: EmisionParams): Promise<Rendicion> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data: id, error } = await supabase.rpc('emitir_rendicion', {
        p_desde: params.desde,
        p_hasta: params.hasta,
        p_cobrador: params.cobrador || null,
        p_zona: params.zona || null,
        p_incluir_vencidas: params.incluirVencidas,
      });
      if (error) throw describeSupabaseError(error, 'No se pudo emitir la planilla');

      const { data, error: fetchError } = await supabase
        .from('rendiciones')
        .select('*')
        .eq('id', id)
        .single();
      if (fetchError) throw describeSupabaseError(fetchError, 'No se pudo leer la planilla emitida');
      return data as Rendicion;
    }

    return emitirLocal(params);
  },

  /**
   * Registra lo que rindió el cobrador. `montos` va de id de recibo a monto
   * cobrado; los recibos que no figuran cuentan como no cobrados.
   */
  async rendir(rendicionId: string, montos: Record<string, number>, fecha: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.rpc('rendir_rendicion', {
        p_rendicion_id: rendicionId,
        p_montos: montos,
        p_fecha: fecha,
      });
      if (error) throw describeSupabaseError(error, 'No se pudo rendir la planilla');
      return;
    }

    // Modo Demo: misma validación que la función de la base, antes de tocar nada
    const rendiciones = getLocal<Rendicion[]>(LOCAL_RENDICIONES_KEY, []);
    const rendicion = rendiciones.find(r => r.id === rendicionId);
    if (!rendicion) throw new Error('La planilla no existe.');
    if (rendicion.estado !== 'emitida') {
      throw new Error(`La planilla N° ${rendicion.numero} ya fue rendida.`);
    }

    const todos = getLocal<RendicionItem[]>(LOCAL_ITEMS_KEY, []);
    const propios = todos
      .filter(i => i.rendicion_id === rendicionId)
      .sort((a, b) => a.numero_recibo - b.numero_recibo);

    const negativo = propios.find(i => (montos[i.id] || 0) < 0);
    if (negativo) throw new Error(`El recibo ${negativo.numero_recibo} tiene un monto negativo.`);

    let total = 0;
    for (const item of propios) {
      const monto = round2(montos[item.id] || 0);
      let paymentId: string | null = null;

      if (monto > 0 && item.installment_id && item.loan_id) {
        const pago = await loanService.registerPayment({
          loan_id: item.loan_id,
          installment_id: item.installment_id,
          amount: monto,
          paid_at: fecha,
          cobrador: item.cobrador || rendicion.cobrador || undefined,
          method: 'cash',
          notes: `Planilla N° ${rendicion.numero} - recibo ${item.numero_recibo}`,
        });
        paymentId = pago.id;
      }

      item.monto_cobrado = monto;
      item.payment_id = paymentId;
      total += monto;
    }

    setLocal(
      LOCAL_ITEMS_KEY,
      todos.map(i => propios.find(p => p.id === i.id) || i)
    );
    setLocal(
      LOCAL_RENDICIONES_KEY,
      rendiciones.map(r =>
        r.id === rendicionId
          ? { ...r, estado: 'rendida', fecha_rendicion: fecha, total_cobrado: round2(total) }
          : r
      )
    );
  },

  /**
   * Ids de cuotas que tuvieron al menos un recibo emitido alguna vez (en
   * cualquier planilla, rendida o no). Se usa para habilitar el botón de
   * reimprimir en la pantalla de Cobranza sin consultar fila por fila.
   */
  async getInstallmentsConRecibo(): Promise<Set<string>> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.from('rendicion_items').select('installment_id');
      if (error) throw describeSupabaseError(error, 'No se pudo verificar qué cuotas tienen recibo');
      return new Set((data || []).map((r: any) => r.installment_id).filter(Boolean) as string[]);
    }

    return new Set(
      getLocal<RendicionItem[]>(LOCAL_ITEMS_KEY, [])
        .map(i => i.installment_id)
        .filter((id): id is string => Boolean(id))
    );
  },

  /**
   * El recibo emitido más reciente para una cuota puntual, con su planilla.
   * Sirve para reimprimir un solo comprobante desde la pantalla de Cobranza
   * sin tener que reimprimir toda la planilla de la que salió. Si la cuota
   * pasó por más de una planilla (se emitió, no se cobró y se reemitió), toma
   * la más reciente. Devuelve null si esa cuota nunca tuvo un recibo emitido.
   */
  async getUltimoReciboDeCuota(
    installmentId: string
  ): Promise<{ rendicion: Rendicion; item: RendicionItem } | null> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data: items, error } = await supabase
        .from('rendicion_items')
        .select('*')
        .eq('installment_id', installmentId);
      if (error) throw describeSupabaseError(error, 'No se pudo buscar el recibo de esta cuota');
      if (!items || items.length === 0) return null;

      const { data: rends, error: rErr } = await supabase
        .from('rendiciones')
        .select('*')
        .in(
          'id',
          items.map(i => i.rendicion_id)
        )
        .order('numero', { ascending: false })
        .limit(1);
      if (rErr) throw describeSupabaseError(rErr, 'No se pudo buscar la planilla de esta cuota');
      const rendicion = rends?.[0] as Rendicion | undefined;
      if (!rendicion) return null;

      const item = items.find(i => i.rendicion_id === rendicion.id) as RendicionItem;
      return { rendicion, item };
    }

    const propios = getLocal<RendicionItem[]>(LOCAL_ITEMS_KEY, []).filter(
      i => i.installment_id === installmentId
    );
    if (propios.length === 0) return null;

    const rendicion = getLocal<Rendicion[]>(LOCAL_RENDICIONES_KEY, [])
      .filter(r => propios.some(i => i.rendicion_id === r.id))
      .sort((a, b) => b.numero - a.numero)[0];
    if (!rendicion) return null;

    const item = propios.find(i => i.rendicion_id === rendicion.id)!;
    return { rendicion, item };
  },

  /** Anula una planilla emitida. Una rendida no se puede anular. */
  async anular(rendicion: Rendicion): Promise<void> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('rendiciones').delete().eq('id', rendicion.id);
      if (error) throw describeSupabaseError(error, 'No se pudo anular la planilla');
      return;
    }

    if (rendicion.estado === 'rendida') {
      throw new Error(`La planilla N° ${rendicion.numero} ya fue rendida y no se puede anular.`);
    }
    setLocal(
      LOCAL_RENDICIONES_KEY,
      getLocal<Rendicion[]>(LOCAL_RENDICIONES_KEY, []).filter(r => r.id !== rendicion.id)
    );
    setLocal(
      LOCAL_ITEMS_KEY,
      getLocal<RendicionItem[]>(LOCAL_ITEMS_KEY, []).filter(i => i.rendicion_id !== rendicion.id)
    );
  },
};
