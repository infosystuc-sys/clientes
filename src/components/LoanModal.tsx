import React, { useState, useEffect } from 'react';
import { X, HandCoins, AlertCircle, CalendarClock, UserCheck } from 'lucide-react';
import { Client, Loan, LoanInput } from '../types/database';
import { CatalogSelect } from './CatalogSelect';
import {
  addWeeks,
  buildSchedule,
  formatDate,
  formatMoney,
  rateFromTotal,
  round2,
  today,
} from '../lib/loanMath';

interface LoanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (loanData: LoanInput) => Promise<void>;
  clients: Client[];
  initialLoan?: Loan | null;
  defaultClientId?: string;
  /** Catálogo de cobradores dados de alta en Configuración. */
  cobradores: string[];
  onCreateCobrador: (nombre: string) => Promise<string>;
}

export const LoanModal: React.FC<LoanModalProps> = ({
  isOpen,
  onClose,
  onSave,
  clients,
  initialLoan,
  defaultClientId,
  cobradores,
  onCreateCobrador,
}) => {
  const [clientId, setClientId] = useState('');
  const [principal, setPrincipal] = useState<number>(0);
  const [installmentsCount, setInstallmentsCount] = useState<number>(12);
  /** Lo que paga el cliente cada semana; el total sale de cuota × cantidad. */
  const [cuota, setCuota] = useState<number>(0);
  const [fechaOtorgamiento, setFechaOtorgamiento] = useState(today());
  const [startDate, setStartDate] = useState(addWeeks(today(), 1));
  const [cobrador, setCobrador] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedClient = clients.find(c => c.id === clientId);

  useEffect(() => {
    setError(null);
    if (initialLoan) {
      setClientId(initialLoan.client_id);
      setPrincipal(Number(initialLoan.principal) || 0);
      setInstallmentsCount(initialLoan.installments_count || 1);
      setCuota(Number(initialLoan.installment_amount) || 0);
      setFechaOtorgamiento(initialLoan.fecha_otorgamiento || initialLoan.created_at.slice(0, 10));
      setStartDate(initialLoan.start_date || addWeeks(today(), 1));
      setCobrador(initialLoan.cobrador || '');
      setNotes(initialLoan.notes || '');
    } else {
      setClientId(defaultClientId || clients[0]?.id || '');
      setPrincipal(0);
      setInstallmentsCount(12);
      setCuota(0);
      setFechaOtorgamiento(today());
      setStartDate(addWeeks(today(), 1));
      setCobrador('');
      setNotes('');
    }
  }, [initialLoan, defaultClientId, clients, isOpen]);

  // Al elegir cliente se propone su cobrador, sin pisar una edición manual.
  useEffect(() => {
    if (!initialLoan && selectedClient && !cobrador) {
      setCobrador(selectedClient.cobrador || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Un aviso de validación deja de valer en cuanto se corrigen los datos
  useEffect(() => setError(null), [principal, installmentsCount, cuota, startDate]);

  if (!isOpen) return null;

  // El préstamo se arma con capital, cantidad de cuotas y valor de la cuota:
  // el total y el recargo se deducen, no se cargan.
  const totalAmount = round2(cuota * installmentsCount);
  const ganancia = round2(totalAmount - principal);
  const recargo = rateFromTotal(principal, totalAmount);
  const plan =
    cuota > 0 && installmentsCount > 0 && startDate
      ? buildSchedule({
          total_amount: totalAmount,
          installments_count: installmentsCount,
          installment_amount: cuota,
          start_date: startDate,
        })
      : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const faltante = !clientId
      ? 'Elegí un cliente.'
      : !(principal > 0)
        ? 'Cargá el capital entregado.'
        : !(installmentsCount >= 1 && installmentsCount <= 104)
          ? 'La cantidad de cuotas va de 1 a 104.'
          : !(cuota > 0)
            ? 'Cargá el monto de la cuota.'
            : !startDate
              ? 'Cargá el vencimiento de la primera cuota.'
              : totalAmount < principal
                ? `Las cuotas suman ${formatMoney(totalAmount)}, menos que el capital entregado.`
                : null;
    if (faltante) {
      setError(faltante);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSave({
        client_id: clientId,
        principal: round2(principal),
        interest_rate: recargo,
        total_amount: totalAmount,
        installments_count: installmentsCount,
        installment_amount: round2(cuota),
        fecha_otorgamiento: fechaOtorgamiento,
        start_date: startDate,
        cobrador: cobrador.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'No se pudo registrar el préstamo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-emerald-500 transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400">
              <HandCoins className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">
                {initialLoan ? 'Editar Préstamo' : 'Nuevo Préstamo'}
              </h3>
              <p className="text-xs text-slate-400">
                El plan de cuotas semanales se genera automáticamente
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-950/40 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {initialLoan && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-950/30 text-amber-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Editar el monto o la cantidad de cuotas <strong>no regenera</strong> el plan ya
                emitido. Para cambiar el cronograma, eliminá el préstamo y cargalo de nuevo.
              </span>
            </div>
          )}

          {/* Cliente */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">
              Cliente <span className="text-rose-400">*</span>
            </label>
            <select
              required
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                Seleccioná un cliente
              </option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.zona ? ` — ${c.zona}` : ''}
                </option>
              ))}
            </select>
            {selectedClient && (
              <p className="text-[11px] text-slate-500">
                {[selectedClient.address, selectedClient.phone && `Tel. ${selectedClient.phone}`]
                  .filter(Boolean)
                  .join(' · ') || 'Sin domicilio ni teléfono cargados'}
              </p>
            )}
            {clients.length === 0 && (
              <p className="text-[11px] text-amber-400">Primero cargá al menos un cliente.</p>
            )}
          </div>

          {/* Capital, cuotas y valor de la cuota */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">
                Capital entregado <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={principal || ''}
                onChange={e => setPrincipal(Number(e.target.value))}
                className={inputClass}
                placeholder="100000"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">
                Cuotas semanales <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                min={1}
                max={104}
                value={installmentsCount || ''}
                onChange={e => setInstallmentsCount(Math.trunc(Number(e.target.value)))}
                className={inputClass}
                placeholder="12"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">
                Monto de la cuota <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={cuota || ''}
                onChange={e => setCuota(Number(e.target.value))}
                className={inputClass}
                placeholder="12000"
              />
            </div>
          </div>

          {/* Fechas y cobrador */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-800">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">
                Vence la 1ª cuota <span className="text-rose-400">*</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className={inputClass}
                title="Las demás cuotas vencen cada 7 días a partir de esta fecha."
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Otorgado el</label>
              <input
                type="date"
                value={fechaOtorgamiento}
                onChange={e => setFechaOtorgamiento(e.target.value)}
                className={inputClass}
                title="Día en que se entregó la plata. Sale como FECHA EMISIÓN en el recibo."
              />
            </div>

            <CatalogSelect
              label="Cobrador"
              value={cobrador}
              onChange={setCobrador}
              options={cobradores}
              onCreate={onCreateCobrador}
              icon={UserCheck}
              emptyLabel={
                selectedClient?.cobrador
                  ? `Usar el del cliente (${selectedClient.cobrador})`
                  : 'Sin cobrador asignado'
              }
              createLabel="Nuevo cobrador"
            />
          </div>

          {/* Plan resultante */}
          {plan.length > 0 && (
            <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20 space-y-3">
              <div className="flex items-center gap-2 text-emerald-300 text-xs font-bold">
                <CalendarClock className="w-4 h-4" />
                <span>
                  {installmentsCount} cuotas semanales de {formatMoney(cuota)}, del{' '}
                  {formatDate(plan[0].due_date)} al {formatDate(plan[plan.length - 1].due_date)}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                <div>
                  <span className="text-slate-400 block">Entregás</span>
                  <span className="text-white font-bold">{formatMoney(principal)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Cobrás</span>
                  <span className="text-white font-bold">{formatMoney(totalAmount)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Ganancia</span>
                  <span className={`font-bold ${ganancia < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {formatMoney(ganancia)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Recargo</span>
                  <span className="text-white font-bold">{principal > 0 ? `${recargo}%` : '—'}</span>
                </div>
              </div>
              <details className="text-[11px]" open={!initialLoan && plan.length <= 16}>
                <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
                  Ver plan de cuotas
                </summary>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 font-mono">
                  {plan.map(c => (
                    <div key={c.number} className="flex justify-between gap-2 text-slate-300">
                      <span className="text-slate-500">{String(c.number).padStart(2, '0')}</span>
                      <span>{formatDate(c.due_date).slice(0, 5)}</span>
                      <span>{formatMoney(c.amount)}</span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Observaciones</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Garante, referencias, acuerdos particulares..."
              className={`${inputClass} resize-none`}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800/60 text-slate-300 text-xs font-semibold hover:bg-slate-700/60 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-lg shadow-emerald-600/25 transition-all"
            >
              {isSubmitting ? 'Guardando...' : initialLoan ? 'Guardar Cambios' : 'Otorgar Préstamo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
