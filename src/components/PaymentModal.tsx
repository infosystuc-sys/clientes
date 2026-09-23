import React, { useState, useEffect } from 'react';
import { X, Wallet, AlertCircle, MapPin, Phone } from 'lucide-react';
import { CollectionRow, PaymentInput, PaymentMethod } from '../types/database';
import { formatDate, formatMoney, round2, today } from '../lib/loanMath';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payment: PaymentInput) => Promise<void>;
  row: CollectionRow | null;
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  other: 'Otro',
};

export const PaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose, onSave, row }) => {
  const [amount, setAmount] = useState<number>(0);
  const [paidAt, setPaidAt] = useState(today());
  const [cobrador, setCobrador] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (row) {
      setAmount(round2(row.balance));
      setPaidAt(today());
      setCobrador(row.cobrador || '');
      setMethod('cash');
      setNotes('');
    }
  }, [row, isOpen]);

  if (!isOpen || !row) return null;

  const esParcial = amount > 0 && amount < row.balance;
  const excede = amount > row.balance;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) {
      setError('El monto del cobro tiene que ser mayor a cero.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSave({
        loan_id: row.loan_id,
        installment_id: row.installment_id,
        amount: round2(amount),
        paid_at: paidAt,
        cobrador: cobrador.trim() || undefined,
        method,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'No se pudo registrar el cobro.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-emerald-500 transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Registrar Cobro</h3>
              <p className="text-xs text-slate-400">
                Cuota {row.number} · vence {formatDate(row.due_date)}
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-950/40 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Ficha del cliente */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
            <p className="font-bold text-sm text-white">{row.client_name}</p>
            <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
              <MapPin className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" /> {row.address}
            </p>
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5 font-mono">
              <Phone className="w-3 h-3 text-slate-500" /> {row.phone}
            </p>
            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[11px]">
              <span className="text-slate-400">
                Cuota de {formatMoney(row.amount)}
                {row.paid_amount > 0 && ` · ya pagó ${formatMoney(row.paid_amount)}`}
              </span>
              <span className="text-white font-bold">Saldo {formatMoney(row.balance)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">
                Monto cobrado <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                required
                min={0}
                step="0.01"
                autoFocus
                value={amount || ''}
                onChange={e => setAmount(Number(e.target.value))}
                className={`${inputClass} ${excede ? 'border-amber-500/60' : ''}`}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Fecha del cobro</label>
              <input
                type="date"
                value={paidAt}
                onChange={e => setPaidAt(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {esParcial && (
            <p className="text-[11px] text-amber-400">
              Pago parcial: queda un saldo de {formatMoney(round2(row.balance - amount))} en esta
              cuota.
            </p>
          )}
          {excede && (
            <p className="text-[11px] text-amber-400">
              El monto supera el saldo de la cuota en {formatMoney(round2(amount - row.balance))}.
              Se va a registrar igual.
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Cobrador</label>
              <input
                type="text"
                value={cobrador}
                onChange={e => setCobrador(e.target.value)}
                placeholder="Sin asignar"
                className={inputClass}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Forma de pago</label>
              <select
                value={method}
                onChange={e => setMethod(e.target.value as PaymentMethod)}
                className={inputClass}
              >
                {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map(m => (
                  <option key={m} value={m}>
                    {METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Observaciones</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Opcional"
              className={inputClass}
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
              disabled={isSubmitting || amount <= 0}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-lg shadow-emerald-600/25 transition-all"
            >
              {isSubmitting ? 'Registrando...' : 'Registrar Cobro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
