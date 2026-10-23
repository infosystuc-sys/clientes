import { getSupabaseClient } from '../lib/supabase';
import { describeSupabaseError } from './supabaseErrors';
import { loanService } from './loanService';
import { round2, today } from '../lib/loanMath';
import {
  Client,
  EmisionParams,
  Installment,
  Loan,
  MovimientoRendicion,
  Payment,
  Rendicion,
  RendicionItem,
} from '../types/database';

const LOCAL_RENDICIONES_KEY = 'clientflow_demo_rendiciones';
const LOCAL_ITEMS_KEY = 'clientflow_demo_rendicion_items';
const LOCAL_MOVIMIENTOS_KEY = 'clientflow_demo_rendicion_movimientos';
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

/** Cuotas que agrupa un recibo (los viejos tienen sólo `installment_id`). */
function cuotasDelRecibo(i: Pick<RendicionItem, 'installment_id' | 'installment_ids'>): string[] {
  return [...new Set([...(i.installment_ids || []), ...(i.installment_id ? [i.installment_id] : [])])];
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
        (!zona || client.zona === zona)
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

  // Un recibo por préstamo con toda la deuda a la fecha (las candidatas ya
  // vienen ordenadas, así que el primer grupo de cada préstamo manda el orden)
  const porPrestamo = new Map<string, typeof candidatas>();
  candidatas.forEach(c => porPrestamo.set(c.loan.id, [...(porPrestamo.get(c.loan.id) || []), c]));
  const grupos = [...porPrestamo.values()].map(g => [...g].sort((a, b) => a.i.number - b.i.number));

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
    cantidad_recibos: grupos.length,
    recibos_cargados: 0,
    total_ingresos: 0,
    total_egresos: 0,
    total_esperado: 0,
    total_cobrado: null,
    created_at: new Date().toISOString(),
  };

  const items: RendicionItem[] = grupos.map((grupo, idx) => {
    const { i, loan, client } = grupo[0];
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
      importe: round2(grupo.reduce((a, g) => a + Number(g.i.amount) - Number(g.i.paid_amount), 0)),
      installment_ids: grupo.map(g => g.i.id),
      cuota_hasta: grupo[grupo.length - 1].i.number,
      cuotas_incluidas: grupo.length,
      monto_cobrado: null,
      payment_id: null,
    };
  });

  rendicion.total_esperado = round2(items.reduce((a, i) => a + i.importe, 0));

  setLocal(LOCAL_RENDICIONES_KEY, [rendicion, ...rendiciones]);
  setLocal(LOCAL_ITEMS_KEY, [...getLocal<RendicionItem[]>(LOCAL_ITEMS_KEY, []), ...items]);
  return rendicion;
}

/**
 * Modo Demo: replica `imputar_cobro`. El cobro va a las cuotas pendientes del
 * préstamo, de la más vieja a la más nueva, y el sobrante pasa a la siguiente.
 */
async function imputarCobroLocal(
  loanId: string,
  monto: number,
  fecha: string,
  cobrador: string | undefined,
  notes: string,
  rendicionItemId: string
): Promise<string | null> {
  const pendientes = getLocal<Installment[]>(LOCAL_INSTALLMENTS_KEY, [])
    .filter(i => i.loan_id === loanId && Number(i.paid_amount) < Number(i.amount))
    .sort((a, b) => a.number - b.number);
  const saldo = round2(pendientes.reduce((a, i) => a + Number(i.amount) - Number(i.paid_amount), 0));
  if (monto > saldo) {
    throw new Error(`${notes}: el cobro supera en ${round2(monto - saldo)} lo que le queda pagar al préstamo.`);
  }

  let resto = round2(monto);
  let primero: string | null = null;
  for (const cuota of pendientes) {
    if (resto <= 0) break;
    const aplica = round2(Math.min(resto, Number(cuota.amount) - Number(cuota.paid_amount)));
    const pago = await loanService.registerPayment({
      loan_id: loanId,
      installment_id: cuota.id,
      amount: aplica,
      paid_at: fecha,
      cobrador,
      method: 'cash',
      notes,
      rendicion_item_id: rendicionItemId,
    });
    primero = primero || pago.id;
    resto = round2(resto - aplica);
  }
  return primero;
}

/** Lo que hace falta de cada préstamo para refrescar un recibo. */
interface DatosPrestamo {
  loan: Loan;
  client?: Client;
  cuotas: Installment[];
  ultimoPago: string | null;
  pagos: Payment[];
}

/**
 * Pisa la foto del recibo con el estado actual del préstamo y del cliente:
 * pagado, saldo, atraso, último pago, plan, fecha de otorgamiento y el
 * vencimiento actual de la cuota. Así un recibo impreso después de rendir (o
 * de modificar el préstamo) muestra lo cobrado hasta hoy. El importe a cobrar
 * y el N° de crédito se conservan como se emitieron.
 */
function aplicarDatosActuales(items: RendicionItem[], datos: Map<string, DatosPrestamo>): RendicionItem[] {
  const hoy = today();
  return items.map(item => {
    const d = item.loan_id ? datos.get(item.loan_id) : undefined;
    if (!d) return item;

    const pagado = round2(d.cuotas.reduce((a, c) => a + Number(c.paid_amount), 0));
    const atraso = round2(
      d.cuotas
        .filter(c => c.due_date < hoy && Number(c.paid_amount) < Number(c.amount))
        .reduce((a, c) => a + Number(c.amount) - Number(c.paid_amount), 0)
    );
    const cuota = d.cuotas.find(c => c.id === item.installment_id);
    const imputaciones = d.pagos
      .filter(p => p.rendicion_item_id === item.id || (p.id === item.payment_id && !p.rendicion_item_id))
      .map(p => {
        const c = d.cuotas.find(x => x.id === p.installment_id);
        return {
          cuota_numero: c?.number ?? 0,
          vencimiento: c?.due_date ?? '',
          monto: round2(Number(p.amount)),
          fecha: p.paid_at,
        };
      })
      .sort((a, b) => a.cuota_numero - b.cuota_numero);

    return {
      ...item,
      cliente_numero: d.client?.numero ?? item.cliente_numero,
      cliente_nombre: d.client?.name ?? item.cliente_nombre,
      domicilio: d.client ? d.client.address : item.domicilio,
      telefono: d.client ? d.client.phone : item.telefono,
      rubro: d.client ? d.client.rubro ?? null : item.rubro,
      zona: d.client ? d.client.zona ?? null : item.zona,
      fecha_otorgamiento: d.loan.fecha_otorgamiento || item.fecha_otorgamiento,
      cuotas_total: d.loan.installments_count,
      valor_cuota: Number(d.loan.installment_amount),
      prestamo_total: Number(d.loan.total_amount),
      prestamo_pagado: pagado,
      prestamo_saldo: round2(Number(d.loan.total_amount) - pagado),
      ultimo_pago: d.ultimoPago,
      atraso,
      cuota_numero: cuota?.number ?? item.cuota_numero,
      vencimiento: cuota?.due_date ?? item.vencimiento,
      imputaciones,
      vencimiento_final:
        d.cuotas.map(c => c.due_date).sort().pop() ?? null,
    };
  });
}

async function conDatosActuales(items: RendicionItem[]): Promise<RendicionItem[]> {
  const loanIds = [...new Set(items.map(i => i.loan_id).filter((id): id is string => Boolean(id)))];
  if (loanIds.length === 0) return items;
  const datos = new Map<string, DatosPrestamo>();

  const supabase = getSupabaseClient();
  if (supabase) {
    const [loansRes, cuotasRes, pagosRes] = await Promise.all([
      supabase.from('loans').select('*, clients(*)').in('id', loanIds),
      supabase.from('installments').select('*').in('loan_id', loanIds),
      supabase
        .from('payments')
        .select('id, loan_id, installment_id, amount, paid_at, rendicion_item_id')
        .in('loan_id', loanIds),
    ]);
    const error = loansRes.error || cuotasRes.error || pagosRes.error;
    if (error) throw describeSupabaseError(error, 'No se pudo leer el estado actual de los préstamos');

    const pagos = (pagosRes.data || []) as Payment[];
    (loansRes.data || []).forEach((row: any) => {
      const { clients: client, ...loan } = row;
      datos.set(loan.id, {
        pagos: pagos.filter(p => p.loan_id === loan.id),
        loan: loan as Loan,
        client: client as Client | undefined,
        cuotas: ((cuotasRes.data || []) as Installment[]).filter(c => c.loan_id === loan.id),
        ultimoPago:
          pagos
            .filter(p => p.loan_id === loan.id)
            .map(p => p.paid_at)
            .sort()
            .pop() || null,
      });
    });
    return aplicarDatosActuales(items, datos);
  }

  const clients = getLocal<Client[]>(LOCAL_CLIENTS_KEY, []);
  const cuotas = getLocal<Installment[]>(LOCAL_INSTALLMENTS_KEY, []);
  const pagos = getLocal<Payment[]>(LOCAL_PAYMENTS_KEY, []);
  getLocal<Loan[]>(LOCAL_LOANS_KEY, [])
    .filter(l => loanIds.includes(l.id))
    .forEach(loan =>
      datos.set(loan.id, {
        loan,
        pagos: pagos.filter(p => p.loan_id === loan.id),
        client: clients.find(c => c.id === loan.client_id),
        cuotas: cuotas.filter(c => c.loan_id === loan.id),
        ultimoPago:
          pagos
            .filter(p => p.loan_id === loan.id)
            .map(p => p.paid_at)
            .sort()
            .pop() || null,
      })
    );
  return aplicarDatosActuales(items, datos);
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
      return conDatosActuales((data || []) as RendicionItem[]);
    }

    return conDatosActuales(
      getLocal<RendicionItem[]>(LOCAL_ITEMS_KEY, [])
        .filter(i => i.rendicion_id === rendicionId)
        .sort((a, b) => a.numero_recibo - b.numero_recibo)
    );
  },

  /** Ingresos y egresos del cobrador cargados en la planilla. */
  async getMovimientos(rendicionId: string): Promise<MovimientoRendicion[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('rendicion_movimientos')
        .select('*')
        .eq('rendicion_id', rendicionId)
        .order('orden', { ascending: true });
      if (error) throw describeSupabaseError(error, 'No se pudieron cargar los ingresos y egresos');
      return (data || []) as MovimientoRendicion[];
    }

    return getLocal<MovimientoRendicion[]>(LOCAL_MOVIMIENTOS_KEY, [])
      .filter(m => m.rendicion_id === rendicionId)
      .sort((a, b) => (a.orden || 0) - (b.orden || 0));
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
   * Guarda lo que rindió el cobrador. `montos` va de id de recibo a monto
   * cobrado (0 = no pagó) o `null` (vuelve a "sin cargar"). Con `cerrar` la
   * planilla queda rendida y los recibos que no figuran cuentan como no
   * cobrados; sin `cerrar` sólo se guarda el avance y los ausentes no cambian.
   * Sobre una planilla ya rendida modifica los cobros registrados.
   */
  async guardar(
    rendicionId: string,
    montos: Record<string, number | null>,
    fecha: string,
    cerrar: boolean,
    movimientos: MovimientoRendicion[] | null = null
  ): Promise<void> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.rpc('guardar_rendicion', {
        p_rendicion_id: rendicionId,
        p_montos: montos,
        p_fecha: fecha,
        p_cerrar: cerrar,
        p_movimientos: movimientos
          ? movimientos.map(m => ({
              concepto: m.concepto,
              tipo: m.tipo,
              importe: m.importe,
              detalle: m.detalle || null,
            }))
          : null,
      });
      if (error) throw describeSupabaseError(error, 'No se pudo guardar la rendición');
      return;
    }

    // Modo Demo: misma lógica que la función de la base, validando antes de tocar nada
    const rendiciones = getLocal<Rendicion[]>(LOCAL_RENDICIONES_KEY, []);
    const rendicion = rendiciones.find(r => r.id === rendicionId);
    if (!rendicion) throw new Error('La planilla no existe.');
    const cierra = cerrar || rendicion.estado === 'rendida';
    (movimientos || []).forEach((m, i) => {
      if (!m.concepto?.trim()) throw new Error(`El movimiento ${i + 1} no tiene concepto.`);
      if (!(Number(m.importe) > 0)) {
        throw new Error(`El movimiento ${i + 1} (${m.concepto}) tiene que tener un importe mayor a cero.`);
      }
    });

    const todos = getLocal<RendicionItem[]>(LOCAL_ITEMS_KEY, []);
    const propios = todos
      .filter(i => i.rendicion_id === rendicionId)
      .sort((a, b) => a.numero_recibo - b.numero_recibo);

    const destino = new Map<string, number | null>();
    for (const item of propios) {
      let monto: number | null;
      if (item.id in montos) monto = montos[item.id] === null ? null : round2(montos[item.id] as number);
      else if (cierra) monto = 0;
      else monto = item.monto_cobrado ?? null;
      if (monto !== null && monto < 0) {
        throw new Error(`El recibo ${item.numero_recibo} tiene un monto negativo.`);
      }
      destino.set(item.id, monto);
    }

    for (const item of propios) {
      const monto = destino.get(item.id) ?? null;
      if (monto === (item.monto_cobrado ?? null)) continue;

      const previos = getLocal<Payment[]>(LOCAL_PAYMENTS_KEY, []).filter(
        p => p.rendicion_item_id === item.id || p.id === item.payment_id
      );
      for (const previo of previos) await loanService.deletePayment(previo);

      let paymentId: string | null = null;
      if (monto && monto > 0 && item.loan_id) {
        paymentId = await imputarCobroLocal(
          item.loan_id,
          monto,
          fecha,
          item.cobrador || rendicion.cobrador || undefined,
          `Planilla N° ${rendicion.numero} - recibo ${item.numero_recibo}`,
          item.id
        );
      }
      item.monto_cobrado = monto;
      item.payment_id = paymentId;
    }

    const cargados = propios.filter(i => i.monto_cobrado !== null && i.monto_cobrado !== undefined);
    const total = round2(cargados.reduce((a, i) => a + Number(i.monto_cobrado), 0));

    let movs = getLocal<MovimientoRendicion[]>(LOCAL_MOVIMIENTOS_KEY, []);
    if (movimientos) {
      movs = [
        ...movs.filter(m => m.rendicion_id !== rendicionId),
        ...movimientos.map((m, i) => ({
          ...m,
          id: crypto.randomUUID(),
          rendicion_id: rendicionId,
          importe: round2(m.importe),
          orden: i + 1,
        })),
      ];
      setLocal(LOCAL_MOVIMIENTOS_KEY, movs);
    }
    const propiosMovs = movs.filter(m => m.rendicion_id === rendicionId);
    const sumar = (tipo: string) =>
      round2(propiosMovs.filter(m => m.tipo === tipo).reduce((a, m) => a + Number(m.importe), 0));

    setLocal(
      LOCAL_ITEMS_KEY,
      todos.map(i => propios.find(p => p.id === i.id) || i)
    );
    setLocal(
      LOCAL_RENDICIONES_KEY,
      rendiciones.map(r =>
        r.id === rendicionId
          ? {
              ...r,
              recibos_cargados: cargados.length,
              total_cobrado: cierra || cargados.length > 0 ? total : null,
              total_ingresos: sumar('ingreso'),
              total_egresos: sumar('egreso'),
              estado: cierra ? 'rendida' : r.estado,
              fecha_rendicion: cerrar && r.estado === 'emitida' ? fecha : r.fecha_rendicion,
            }
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
      const [itemsRes, pagosRes] = await Promise.all([
        supabase.from('rendicion_items').select('*'),
        supabase.from('payments').select('installment_id').not('rendicion_item_id', 'is', null),
      ]);
      const error = itemsRes.error || pagosRes.error;
      if (error) throw describeSupabaseError(error, 'No se pudo verificar qué cuotas tienen recibo');
      return new Set([
        ...(itemsRes.data || []).flatMap((r: any) => cuotasDelRecibo(r)),
        ...((pagosRes.data || []).map((r: any) => r.installment_id).filter(Boolean) as string[]),
      ]);
    }

    return new Set(
      [
        ...getLocal<RendicionItem[]>(LOCAL_ITEMS_KEY, []).flatMap(cuotasDelRecibo),
        ...getLocal<Payment[]>(LOCAL_PAYMENTS_KEY, [])
          .filter(p => p.rendicion_item_id)
          .map(p => p.installment_id),
      ].filter((id): id is string => Boolean(id))
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
      // Recibos emitidos para esta cuota o cuyo cobro se imputó a ella
      const { data: pagos, error: pErr } = await supabase
        .from('payments')
        .select('rendicion_item_id')
        .eq('installment_id', installmentId)
        .not('rendicion_item_id', 'is', null);
      if (pErr) throw describeSupabaseError(pErr, 'No se pudo buscar el recibo de esta cuota');
      const imputados = [...new Set((pagos || []).map((p: any) => p.rendicion_item_id as string))];

      let query = supabase.from('rendicion_items').select('*');
      query = imputados.length
        ? query.or(
            `installment_id.eq.${installmentId},installment_ids.cs.{${installmentId}},id.in.(${imputados.join(',')})`
          )
        : query.or(`installment_id.eq.${installmentId},installment_ids.cs.{${installmentId}}`);
      const { data: items, error } = await query;
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
      return { rendicion, item: (await conDatosActuales([item]))[0] };
    }

    const imputados = new Set(
      getLocal<Payment[]>(LOCAL_PAYMENTS_KEY, [])
        .filter(p => p.installment_id === installmentId && p.rendicion_item_id)
        .map(p => p.rendicion_item_id as string)
    );
    const propios = getLocal<RendicionItem[]>(LOCAL_ITEMS_KEY, []).filter(
      i => cuotasDelRecibo(i).includes(installmentId) || imputados.has(i.id)
    );
    if (propios.length === 0) return null;

    const rendicion = getLocal<Rendicion[]>(LOCAL_RENDICIONES_KEY, [])
      .filter(r => propios.some(i => i.rendicion_id === r.id))
      .sort((a, b) => b.numero - a.numero)[0];
    if (!rendicion) return null;

    const item = propios.find(i => i.rendicion_id === rendicion.id)!;
    return { rendicion, item: (await conDatosActuales([item]))[0] };
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
    if ((rendicion.recibos_cargados || 0) > 0) {
      throw new Error(
        `La planilla N° ${rendicion.numero} tiene cobros cargados. Vaciá los importes y guardá antes de anularla.`
      );
    }
    setLocal(
      LOCAL_RENDICIONES_KEY,
      getLocal<Rendicion[]>(LOCAL_RENDICIONES_KEY, []).filter(r => r.id !== rendicion.id)
    );
    setLocal(
      LOCAL_ITEMS_KEY,
      getLocal<RendicionItem[]>(LOCAL_ITEMS_KEY, []).filter(i => i.rendicion_id !== rendicion.id)
    );
    setLocal(
      LOCAL_MOVIMIENTOS_KEY,
      getLocal<MovimientoRendicion[]>(LOCAL_MOVIMIENTOS_KEY, []).filter(m => m.rendicion_id !== rendicion.id)
    );
  },
};
