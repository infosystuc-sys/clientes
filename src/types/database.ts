export type ClientStatus = 'active' | 'inactive' | 'lead' | 'vip';

export interface Client {
  id: string;
  /** N° de cliente del recibo. Se asigna solo si se deja vacío. */
  numero?: number;
  /** Nombre y apellido. Obligatorio. */
  name: string;
  /** Domicilio completo. Obligatorio. */
  address: string;
  /** Diez dígitos, sin separadores ni prefijo: 3813045236. Obligatorio. */
  phone: string;
  /** Zona de cobranza. Opcional. */
  zona?: string;
  /** Cobrador asignado. Opcional. */
  cobrador?: string;
  /** Rubro o actividad del cliente. Opcional, sale del catálogo. */
  rubro?: string;
  /** Ya no se piden en el alta; se conservan para los registros existentes. */
  company?: string;
  email?: string;
  status: ClientStatus;
  total_spent: number;
  notes?: string;
  created_at: string;
  updated_at?: string;
  user_id?: string;
}

/**
 * Lo que el formulario de alta envía: los tres campos obligatorios más los
 * opcionales. El resto de las columnas toma su valor por defecto en la base.
 */
export type ClientInput = Pick<Client, 'name' | 'address' | 'phone'> & Partial<Client>;

// ---------------------------------------------------------------------------
// Préstamos
// ---------------------------------------------------------------------------

export type LoanStatus = 'active' | 'completed' | 'cancelled';

export interface Loan {
  id: string;
  client_id: string;
  /** Capital entregado en mano. */
  principal: number;
  /** Recargo total sobre el capital, en porcentaje (40 = 40%). */
  interest_rate: number;
  /** Capital + recargo: lo que el cliente devuelve. */
  total_amount: number;
  installments_count: number;
  installment_amount: number;
  /** Día en que se entregó la plata (la "FECHA EMISIÓN" del recibo). */
  fecha_otorgamiento?: string;
  /** Vencimiento de la primera cuota; las demás caen cada 7 días. */
  start_date: string;
  /** Si va vacío se usa el cobrador del cliente. */
  cobrador?: string;
  status: LoanStatus;
  notes?: string;
  created_at: string;
  updated_at?: string;
}

export type LoanInput = Omit<Loan, 'id' | 'created_at' | 'updated_at' | 'status'> &
  Partial<Pick<Loan, 'status'>>;

// ---------------------------------------------------------------------------
// Cuotas y cobros
// ---------------------------------------------------------------------------

export type InstallmentStatus = 'pending' | 'partial' | 'paid' | 'overdue';

export interface Installment {
  id: string;
  loan_id: string;
  /** Número de cuota dentro del préstamo, arranca en 1. */
  number: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  paid_at?: string | null;
}

export type PaymentMethod = 'cash' | 'transfer' | 'other';

export interface Payment {
  id: string;
  loan_id: string;
  installment_id?: string | null;
  amount: number;
  paid_at: string;
  cobrador?: string;
  method: PaymentMethod;
  notes?: string;
  created_at: string;
}

export type PaymentInput = Omit<Payment, 'id' | 'created_at'>;

/**
 * Una fila por cuota con el cliente, la zona y el cobrador ya resueltos.
 * Espeja la vista `v_cobranza` de la base.
 */
export interface CollectionRow {
  installment_id: string;
  loan_id: string;
  number: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  balance: number;
  status: InstallmentStatus;
  client_id: string;
  loan_status: LoanStatus;
  client_name: string;
  address: string;
  phone: string;
  zona?: string;
  cobrador?: string;
}

// ---------------------------------------------------------------------------
// Historial de contactos con el cliente
// ---------------------------------------------------------------------------

export type InteractionType = 'call' | 'email' | 'meeting' | 'note';

export interface Interaction {
  id: string;
  client_id: string;
  type: InteractionType;
  summary: string;
  details?: string;
  date: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Catálogo: zonas y cobradores
// ---------------------------------------------------------------------------
// Se referencian por nombre desde clients/loans, con ON UPDATE CASCADE en la
// base: renombrar una zona actualiza sola a todos sus clientes.

export interface Zona {
  id: string;
  nombre: string;
  descripcion?: string;
  activa: boolean;
  created_at: string;
}

export type ZonaInput = Pick<Zona, 'nombre'> & Partial<Omit<Zona, 'id' | 'created_at'>>;

export interface Rubro {
  id: string;
  nombre: string;
  descripcion?: string;
  activo: boolean;
  created_at: string;
}

export type RubroInput = Pick<Rubro, 'nombre'> & Partial<Omit<Rubro, 'id' | 'created_at'>>;

export interface Cobrador {
  id: string;
  nombre: string;
  /** Diez dígitos, mismo formato que el teléfono del cliente. */
  telefono?: string;
  /** Zona principal; es informativa, puede cobrar en otras. */
  zona?: string;
  activo: boolean;
  created_at: string;
}

export type CobradorInput = Pick<Cobrador, 'nombre'> &
  Partial<Omit<Cobrador, 'id' | 'created_at'>>;

// ---------------------------------------------------------------------------
// Recibos y rendición de cobradores
// ---------------------------------------------------------------------------

export type RendicionEstado = 'emitida' | 'rendida';

/** Una planilla: el lote de recibos que se le entrega a un cobrador. */
export interface Rendicion {
  id: string;
  numero: number;
  cobrador?: string | null;
  zona?: string | null;
  desde: string;
  hasta: string;
  incluye_vencidas: boolean;
  estado: RendicionEstado;
  fecha_emision: string;
  fecha_rendicion?: string | null;
  cantidad_recibos: number;
  total_esperado: number;
  total_cobrado?: number | null;
  observaciones?: string | null;
  created_at: string;
}

/**
 * Un recibo. Guarda una foto de los datos al momento de emitir, para que una
 * reimpresión salga idéntica a la que se le entregó al cobrador.
 */
export interface RendicionItem {
  id: string;
  rendicion_id: string;
  numero_recibo: number;
  installment_id?: string | null;
  loan_id?: string | null;
  client_id?: string | null;

  cliente_numero?: number | null;
  cliente_nombre: string;
  domicilio?: string | null;
  telefono?: string | null;
  rubro?: string | null;
  zona?: string | null;
  cobrador?: string | null;

  /** 0 el primer crédito del cliente, 1 el segundo... (el "/0" del papel). */
  credito_numero: number;
  fecha_otorgamiento?: string | null;
  cuotas_total?: number | null;
  valor_cuota?: number | null;
  prestamo_total?: number | null;
  prestamo_pagado?: number | null;
  prestamo_saldo?: number | null;
  ultimo_pago?: string | null;
  atraso: number;

  cuota_numero?: number | null;
  vencimiento?: string | null;
  /** Lo que hay que cobrar: el saldo de la cuota al emitir. */
  importe: number;

  monto_cobrado?: number | null;
  payment_id?: string | null;
}

export interface EmisionParams {
  desde: string;
  hasta: string;
  cobrador?: string;
  zona?: string;
  incluirVencidas: boolean;
}

export interface SupabaseCredentials {
  url: string;
  anonKey: string;
  isConfigured: boolean;
}
