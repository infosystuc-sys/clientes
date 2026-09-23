import React, { useState, useEffect } from 'react';
import {
  X,
  MapPin,
  Phone,
  Map as MapIcon,
  UserCheck,
  Calendar,
  MessageSquare,
  Plus,
  HandCoins,
  Users,
  AlertCircle,
  PhoneCall,
  Mail,
  FileText,
  Send,
  ChevronDown,
  Briefcase,
  Loader2,
} from 'lucide-react';
import { Client, Installment, Interaction, InteractionType, Loan } from '../types/database';
import { clientService } from '../services/clientService';
import { loanService, installmentStatus } from '../services/loanService';
import { formatDate, formatMoney, round2 } from '../lib/loanMath';
import { CatalogSelect } from './CatalogSelect';

interface ClientDetailModalProps {
  client: Client | null;
  isOpen: boolean;
  onClose: () => void;
  onClientUpdated: () => void;
  onNewLoan: (client: Client) => void;
  /** Catálogo de rubros y alta al vuelo, para editarlo desde la ficha. */
  rubros: string[];
  onCreateRubro: (nombre: string) => Promise<string>;
  onUpdateClient: (client: Client, patch: Partial<Client>) => Promise<void>;
}

const INTERACTION_ICONS: Record<InteractionType, React.ElementType> = {
  call: PhoneCall,
  email: Mail,
  meeting: Users,
  note: FileText,
};

const INTERACTION_LABELS: Record<InteractionType, string> = {
  call: 'Llamada',
  email: 'Email',
  meeting: 'Visita',
  note: 'Nota',
};

const STATUS_STYLES = {
  paid: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  pending: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
  partial: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  overdue: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

const STATUS_LABELS = {
  paid: 'Pagada',
  pending: 'Pendiente',
  partial: 'Parcial',
  overdue: 'Vencida',
};

export const ClientDetailModal: React.FC<ClientDetailModalProps> = ({
  client,
  isOpen,
  onClose,
  onClientUpdated,
  onNewLoan,
  rubros,
  onCreateRubro,
  onUpdateClient,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'loans' | 'interactions'>('profile');

  const [loans, setLoans] = useState<Loan[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [expandedLoan, setExpandedLoan] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rubro editable en la propia ficha, se guarda al elegirlo.
  const [rubro, setRubro] = useState('');
  const [savingRubro, setSavingRubro] = useState(false);

  const [showAddInteraction, setShowAddInteraction] = useState(false);
  const [interactionType, setInteractionType] = useState<InteractionType>('call');
  const [interactionSummary, setInteractionSummary] = useState('');
  const [interactionDetails, setInteractionDetails] = useState('');

  useEffect(() => {
    setRubro(client?.rubro || '');
    if (client && isOpen) loadClientData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, isOpen]);

  const loadClientData = async () => {
    if (!client) return;
    setIsLoading(true);
    setError(null);
    try {
      const [loanData, interactionData] = await Promise.all([
        loanService.getLoans(client.id),
        clientService.getInteractions(client.id),
      ]);
      setLoans(loanData);
      setInteractions(interactionData);

      // Las cuotas de todos los préstamos del cliente, en una sola pasada.
      const all = await loanService.getInstallments();
      const loanIds = new Set(loanData.map(l => l.id));
      setInstallments(all.filter(i => loanIds.has(i.loan_id)));
    } catch (err: any) {
      console.error('Error cargando detalles del cliente:', err);
      setError(err?.message || 'No se pudieron cargar los datos del cliente.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen || !client) return null;

  const handleCreateInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interactionSummary.trim()) return;

    setError(null);
    try {
      await clientService.createInteraction({
        client_id: client.id,
        type: interactionType,
        summary: interactionSummary.trim(),
        details: interactionDetails.trim(),
        date: new Date().toISOString(),
      });
    } catch (err: any) {
      setError(err?.message || 'No se pudo registrar la interacción.');
      return;
    }

    setInteractionSummary('');
    setInteractionDetails('');
    setShowAddInteraction(false);
    loadClientData();
  };

  const handleRubroChange = async (nuevo: string) => {
    if (!client || nuevo === (client.rubro || '')) return;

    const anterior = rubro;
    setRubro(nuevo);
    setSavingRubro(true);
    setError(null);
    try {
      await onUpdateClient(client, { rubro: nuevo || undefined });
    } catch (err: any) {
      setRubro(anterior);
      setError(err?.message || 'No se pudo actualizar el rubro.');
    } finally {
      setSavingRubro(false);
    }
  };

  const loanInstallments = (loanId: string) =>
    installments.filter(i => i.loan_id === loanId).sort((a, b) => a.number - b.number);

  const deudaTotal = round2(
    installments.reduce((acc, i) => acc + (Number(i.amount) - Number(i.paid_amount)), 0)
  );
  const pagadoTotal = round2(installments.reduce((acc, i) => acc + Number(i.paid_amount), 0));

  const inputClass =
    'w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-blue-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 via-teal-600 to-cyan-500 flex items-center justify-center font-bold text-white text-lg shadow-lg shadow-emerald-500/20 shrink-0">
              {client.name.charAt(0)}
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{client.name}</h2>
              <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                <span className="flex items-center gap-1">
                  <MapIcon className="w-3.5 h-3.5 text-slate-500" /> {client.zona || 'Sin zona'}
                </span>
                <span className="flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5 text-slate-500" />{' '}
                  {client.cobrador || 'Sin cobrador'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <button
              onClick={() => onNewLoan(client)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/25 transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" /> Préstamo
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 px-6 bg-slate-950/40 border-b border-slate-800 overflow-x-auto">
          {[
            { id: 'profile', label: 'Resumen', icon: Users },
            { id: 'loans', label: `Préstamos (${loans.length})`, icon: HandCoins },
            { id: 'interactions', label: `Historial (${interactions.length})`, icon: MessageSquare },
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 px-3 border-b-2 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {error && (
            <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-950/40 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {isLoading && <p className="text-xs text-slate-400">Cargando...</p>}

          {/* RESUMEN */}
          {activeTab === 'profile' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Domicilio
                  </span>
                  <p className="text-xs font-semibold text-white flex items-start gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                    {client.address}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Teléfono
                  </span>
                  <p className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-mono tracking-wider">{client.phone}</span>
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Deuda vigente
                  </span>
                  <p className="text-sm font-bold text-amber-400">{formatMoney(deudaTotal)}</p>
                  <p className="text-[10px] text-slate-500">
                    Pagó {formatMoney(pagadoTotal)} en total
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="font-semibold text-xs text-slate-300 flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5 text-amber-400" /> Rubro
                  </h4>
                  {savingRubro && (
                    <span className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Guardando...
                    </span>
                  )}
                </div>
                <div className="max-w-sm">
                  <CatalogSelect
                    label=""
                    value={rubro}
                    onChange={handleRubroChange}
                    options={rubros}
                    onCreate={onCreateRubro}
                    icon={Briefcase}
                    emptyLabel="Sin rubro asignado"
                    createLabel="Nuevo rubro"
                    disabled={savingRubro}
                  />
                </div>

                <h4 className="font-semibold text-xs text-slate-300 pt-2 border-t border-slate-800">
                  Información adicional
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-400">
                  <p className="flex items-center gap-2">
                    <MapIcon className="w-4 h-4 text-slate-500" />
                    <span>Zona: {client.zona || 'sin asignar'}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-slate-500" />
                    <span>Cobrador: {client.cobrador || 'sin asignar'}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-500" />
                    <span>Alta el {new Date(client.created_at).toLocaleDateString('es-AR')}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <HandCoins className="w-4 h-4 text-slate-500" />
                    <span>
                      {loans.filter(l => l.status === 'active').length} préstamos activos de{' '}
                      {loans.length} históricos
                    </span>
                  </p>
                </div>
                {client.notes && (
                  <p className="text-xs text-slate-400 pt-2 border-t border-slate-800">
                    {client.notes}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* PRÉSTAMOS */}
          {activeTab === 'loans' && (
            <div className="space-y-3 animate-fadeIn">
              {loans.length === 0 && !isLoading && (
                <div className="p-8 rounded-xl border border-dashed border-slate-800 text-center space-y-2">
                  <HandCoins className="w-7 h-7 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-400">Este cliente todavía no tiene préstamos.</p>
                  <button
                    onClick={() => onNewLoan(client)}
                    className="text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                  >
                    Otorgar el primero
                  </button>
                </div>
              )}

              {loans.map(loan => {
                const cuotas = loanInstallments(loan.id);
                const pagas = cuotas.filter(i => installmentStatus(i) === 'paid').length;
                const saldo = round2(
                  cuotas.reduce((a, i) => a + (Number(i.amount) - Number(i.paid_amount)), 0)
                );
                const abierto = expandedLoan === loan.id;

                return (
                  <div
                    key={loan.id}
                    className="rounded-xl bg-slate-950/60 border border-slate-800 overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedLoan(abierto ? null : loan.id)}
                      className="w-full p-4 flex items-center justify-between gap-3 hover:bg-slate-900/60 transition-colors text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white">
                          {formatMoney(loan.principal)} → {formatMoney(loan.total_amount)}
                          <span className="text-slate-500 font-normal">
                            {' '}
                            · {loan.installments_count} cuotas de{' '}
                            {formatMoney(loan.installment_amount)}
                          </span>
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Desde {formatDate(loan.start_date)} · {pagas}/{cuotas.length} pagas ·
                          saldo <span className="text-white font-semibold">{formatMoney(saldo)}</span>
                        </p>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${
                          abierto ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {abierto && (
                      <div className="border-t border-slate-800 divide-y divide-slate-800/60">
                        {cuotas.map(i => {
                          const st = installmentStatus(i);
                          return (
                            <div
                              key={i.id}
                              className="px-4 py-2.5 flex items-center justify-between text-[11px]"
                            >
                              <span className="text-slate-400 font-mono">N° {i.number}</span>
                              <span className="text-slate-400">{formatDate(i.due_date)}</span>
                              <span className="text-slate-300">{formatMoney(i.amount)}</span>
                              <span className="text-emerald-400">
                                {Number(i.paid_amount) > 0 ? formatMoney(i.paid_amount) : '—'}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full font-semibold border ${STATUS_STYLES[st]}`}
                              >
                                {STATUS_LABELS[st]}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* HISTORIAL */}
          {activeTab === 'interactions' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-xs text-slate-300">Historial de contactos</h4>
                <button
                  onClick={() => setShowAddInteraction(!showAddInteraction)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] font-semibold transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Registrar
                </button>
              </div>

              {showAddInteraction && (
                <form
                  onSubmit={handleCreateInteraction}
                  className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <select
                      value={interactionType}
                      onChange={e => setInteractionType(e.target.value as InteractionType)}
                      className={inputClass}
                    >
                      {(Object.keys(INTERACTION_LABELS) as InteractionType[]).map(t => (
                        <option key={t} value={t}>
                          {INTERACTION_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      required
                      placeholder="Resumen (ej. No estaba en el domicilio)"
                      value={interactionSummary}
                      onChange={e => setInteractionSummary(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <textarea
                    rows={2}
                    placeholder="Detalle (opcional)"
                    value={interactionDetails}
                    onChange={e => setInteractionDetails(e.target.value)}
                    className={`${inputClass} resize-none`}
                  />
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" /> Guardar
                  </button>
                </form>
              )}

              {interactions.length === 0 && !isLoading && (
                <p className="text-xs text-slate-500">Todavía no hay contactos registrados.</p>
              )}

              <div className="space-y-2">
                {interactions.map(item => {
                  const Icon = INTERACTION_ICONS[item.type] || FileText;
                  return (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex gap-3"
                    >
                      <div className="p-2 rounded-lg bg-slate-800 text-blue-400 h-fit">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-white">{item.summary}</p>
                          <span className="text-[10px] text-slate-500 shrink-0">
                            {new Date(item.date).toLocaleDateString('es-AR')}
                          </span>
                        </div>
                        {item.details && (
                          <p className="text-[11px] text-slate-400 mt-0.5">{item.details}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
