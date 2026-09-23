import React, { useState, useEffect } from 'react';
import { X, HandCoins, AlertCircle, CalendarClock, UserCheck } from 'lucide-react';
import { Client, Loan, LoanInput } from '../types/database';
import { CatalogSelect } from './CatalogSelect';
import {
  addWeeks,
  formatDate,
  formatMoney,
  installmentAmount,
  rateFromTotal,
  round2,
  today,
  totalFromRate,
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
  const [interestRate, setInterestRate] = useState<number>(40);
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [installmentsCount, setInstallmentsCount] = useState<number>(12);
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
      setInterestRate(Number(initialLoan.interest_rate) || 0);
      setTotalAmount(Number(initialLoan.total_amount) || 0);
      setInstallmentsCount(initialLoan.installments_count || 1);
      setFechaOtorgamiento(initialLoan.fecha_otorgamiento || initialLoan.created_at.slice(0, 10));
      setStartDate(initialLoan.start_date || addWeeks(today(), 1));
      setCobrador(initialLoan.cobrador || '');
      setNotes(initialLoan.notes || '');
    } else {
      setClientId(defaultClientId || clients[0]?.id || '');
      setPrincipal(0);
      setInterestRate(40);
      setTotalAmount(0);
      setInstallmentsCount(12);
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

  if (!isOpen) return null;

  /** Capital y % mandan: el total se recalcula. */
  const applyPrincipal = (value: number) => {
    setPrincipal(value);
    setTotalAmount(totalFromRate(value, interestRate));
  };

  const applyRate = (value: number) => {
    setInterestRate(value);
    setTotalAmount(totalFromRate(principal, value));
  };

  /** Si escriben el total a mano, el % se deduce de ahí. */
  const applyTotal = (value: number) => {
    setTotalAmount(value);
    setInterestRate(rateFromTotal(principal, value));
  };

  const cuota = installmentAmount(totalAmount, installmentsCount);
  const ultimaCuota = round2(totalAmount - cuota * (installmentsCount - 1));
  const ultimoVencimiento = startDate ? addWeeks(startDate, installmentsCount - 1) : '';
  const ganancia = round2(totalAmount - principal);

  const canSubmit = Boolean(clientId && principal > 0 && totalAmount > 0 && installmentsCount > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      setError('Elegí un cliente y cargá capital, total y cantidad de cuotas.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSave({
        client_id: clientId,
        principal: round2(principal),
        interest_rate: round2(interestRate),
        total_amount: round2(totalAmount),
        installments_count: installmentsCount,
        installment_amount: cuota,
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
                {selectedClient.address} · Tel. {selectedClient.phone}
              </p>
            )}
            {clients.length === 0 && (
              <p className="text-[11px] text-amber-400">Primero cargá al menos un cliente.</p>
            )}
          </div>

          {/* Montos */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">
                Capital entregado <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                required
                min={0}
                step="0.01"
                value={principal || ''}
                onChange={e => applyPrincipal(Number(e.target.value))}
                className={inputClass}
                placeholder="100000"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Recargo %</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={interestRate}
                onChange={e => applyRate(Number(e.target.value))}
                className={inputClass}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">
                Total a devolver <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                required
                min={0}
                step="0.01"
                value={totalAmount || ''}
                onChange={e => applyTotal(Number(e.target.value))}
                className={inputClass}
                placeholder="140000"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Podés cargar el recargo en % o escribir el total a mano: el otro campo se ajusta solo.
          </p>

          {/* Plan de cuotas */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-800">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">
                Cuotas semanales <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                required
                min={1}
                max={104}
                value={installmentsCount}
                onChange={e => setInstallmentsCount(Number(e.target.value))}
                className={inputClass}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Otorgado el</label>
              <input
                type="date"
                value={fechaOtorgamiento}
                onChange={e => {
                  // La primera cuota acompaña a la semana siguiente, salvo que ya la hayan movido
                  if (startDate === addWeeks(fechaOtorgamiento, 1)) {
                    setStartDate(addWeeks(e.target.value, 1));
                  }
                  setFechaOtorgamiento(e.target.value);
                }}
                className={inputClass}
                title="Día en que se entregó la plata. Sale como FECHA EMISIÓN en el recibo."
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Primera cuota vence</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className={inputClass}
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

          {/* Resumen calculado */}
          {totalAmount > 0 && installmentsCount > 0 && (
            <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20 space-y-2">
              <div className="flex items-center gap-2 text-emerald-300 text-xs font-bold">
                <CalendarClock className="w-4 h-4" />
                <span>
                  {installmentsCount} cuotas semanales de {formatMoney(cuota)}
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
                  <span className="text-emerald-400 font-bold">{formatMoney(ganancia)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Última cuota</span>
                  <span className="text-white font-bold">{formatDate(ultimoVencimiento)}</span>
                </div>
              </div>
              {ultimaCuota !== cuota && (
                <p className="text-[11px] text-slate-400">
                  La última cuota ajusta a {formatMoney(ultimaCuota)} para cerrar el total exacto.
                </p>
              )}
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
              disabled={isSubmitting || !canSubmit}
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
