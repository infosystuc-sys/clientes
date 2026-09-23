import React, { useEffect, useMemo, useState } from 'react';
import { X, ClipboardCheck, AlertCircle, CheckCheck, Eraser, Loader2 } from 'lucide-react';
import { Rendicion, RendicionItem } from '../types/database';
import { formatDate, formatMoney, round2, today } from '../lib/loanMath';
import { clienteCredito } from '../lib/printDocs';

interface RendirModalProps {
  rendicion: Rendicion | null;
  items: RendicionItem[];
  isLoading: boolean;
  onClose: () => void;
  onConfirm: (montos: Record<string, number>, fecha: string) => Promise<void>;
}

/**
 * Acepta los importes como se anotan a mano: "7500", "7.500", "$ 7.500",
 * "7500,50", "1.234,5" y también "6428.51". Regla: con coma, la coma es el
 * decimal y los puntos son miles; sin coma, un punto seguido de grupos de tres
 * dígitos es de miles ("7.500") y cualquier otro punto es decimal ("6428.51").
 */
export function parseMonto(raw: string): number {
  let s = raw.trim().replace(/[\s$]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const valor = Number(s);
  return Number.isFinite(valor) ? valor : NaN;
}

/** Importe en el formato en que lo escribiría el operador: 6428,51. */
const toInput = (value: number) => String(round2(value)).replace('.', ',');

export const RendirModal: React.FC<RendirModalProps> = ({
  rendicion,
  items,
  isLoading,
  onClose,
  onConfirm,
}) => {
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [fecha, setFecha] = useState(today());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMontos({});
    setFecha(today());
    setError(null);
  }, [rendicion?.id]);

  const resumen = useMemo(() => {
    let cobrado = 0;
    let cobrados = 0;
    let invalidos = 0;
    items.forEach(item => {
      const valor = parseMonto(montos[item.id] || '');
      if (Number.isNaN(valor) || valor < 0) invalidos++;
      else if (valor > 0) {
        cobrado += valor;
        cobrados++;
      }
    });
    const esperado = items.reduce((a, i) => a + Number(i.importe), 0);
    return {
      esperado: round2(esperado),
      cobrado: round2(cobrado),
      diferencia: round2(cobrado - esperado),
      cobrados,
      invalidos,
    };
  }, [items, montos]);

  if (!rendicion) return null;

  const setMonto = (id: string, value: string) => setMontos(prev => ({ ...prev, [id]: value }));

  const cobrarTodo = () =>
    setMontos(Object.fromEntries(items.map(i => [i.id, toInput(Number(i.importe))])));

  const handleConfirm = async () => {
    if (resumen.invalidos > 0) {
      setError('Hay importes que no son válidos. Revisá los marcados en rojo.');
      return;
    }

    const aviso =
      resumen.cobrados === 0
        ? `No cargaste ningún cobro. La planilla N° ${rendicion.numero} va a quedar rendida en $ 0 y sus cuotas vuelven a estar disponibles para emitir. ¿Continuar?`
        : `Se van a registrar ${resumen.cobrados} cobros por ${formatMoney(resumen.cobrado)} con fecha ${formatDate(fecha)}. Una vez rendida, la planilla no se puede modificar. ¿Confirmar?`;
    if (!window.confirm(aviso)) return;

    const payload: Record<string, number> = {};
    items.forEach(item => {
      const valor = parseMonto(montos[item.id] || '');
      if (valor > 0) payload[item.id] = round2(valor);
    });

    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirm(payload, fecha);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'No se pudo rendir la planilla.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">
                Rendir planilla N° {rendicion.numero}
              </h3>
              <p className="text-xs text-slate-400">
                {rendicion.cobrador || 'Todos los cobradores'} ·{' '}
                {rendicion.zona || 'Todas las zonas'} · {formatDate(rendicion.desde)} al{' '}
                {formatDate(rendicion.hasta)}
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

        {/* Controles */}
        <div className="px-6 py-3 border-b border-slate-800 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-300">Fecha de cobro</label>
            <input
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div className="flex-1" />
          <button
            onClick={cobrarTodo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold transition-colors"
            title="Completa cada recibo con el importe total a cobrar"
          >
            <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> Todos pagaron completo
          </button>
          <button
            onClick={() => setMontos({})}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold transition-colors"
          >
            <Eraser className="w-3.5 h-3.5" /> Limpiar
          </button>
        </div>

        {/* Recibos */}
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="p-10 flex items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando recibos...
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-semibold uppercase tracking-wider text-[10px] sticky top-0">
                <tr>
                  <th className="py-2.5 px-3">Rec.</th>
                  <th className="py-2.5 px-3">N° Cli.</th>
                  <th className="py-2.5 px-3">Cliente</th>
                  <th className="py-2.5 px-3">Cuota</th>
                  <th className="py-2.5 px-3 text-right">A cobrar</th>
                  <th className="py-2.5 px-3 text-right w-44">Cobrado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {items.map(item => {
                  const raw = montos[item.id] || '';
                  const valor = parseMonto(raw);
                  const invalido = Number.isNaN(valor) || valor < 0;
                  const parcial = !invalido && valor > 0 && valor < Number(item.importe);
                  return (
                    <tr key={item.id} className="hover:bg-slate-800/30">
                      <td className="py-2 px-3 font-mono text-slate-500">{item.numero_recibo}</td>
                      <td className="py-2 px-3 font-mono">{clienteCredito(item)}</td>
                      <td className="py-2 px-3">
                        <p className="font-semibold text-white">{item.cliente_nombre}</p>
                        <p className="text-[11px] text-slate-500 truncate max-w-xs">
                          {item.domicilio}
                        </p>
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-400">
                        {item.cuota_numero}/{item.cuotas_total} · {formatDate(item.vencimiento)}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-white">
                        {formatMoney(item.importe)}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={raw}
                            onChange={e => setMonto(item.id, e.target.value)}
                            placeholder="0"
                            className={`w-28 px-2.5 py-1.5 rounded-lg bg-slate-950 border text-right text-xs font-mono focus:outline-none ${
                              invalido
                                ? 'border-rose-500 text-rose-300'
                                : parcial
                                ? 'border-amber-500/60 text-amber-200'
                                : 'border-slate-800 text-slate-100 focus:border-emerald-500'
                            }`}
                          />
                          <button
                            onClick={() => setMonto(item.id, toInput(Number(item.importe)))}
                            className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-emerald-600/30 border border-slate-700 text-[10px] text-slate-300 font-semibold transition-colors"
                            title="Pagó la cuota completa"
                          >
                            Total
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Totales y confirmación */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/40 space-y-3">
          {error && (
            <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-950/40 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            <span className="text-slate-400">
              Esperado <b className="text-white">{formatMoney(resumen.esperado)}</b>
            </span>
            <span className="text-slate-400">
              Rendido <b className="text-emerald-400">{formatMoney(resumen.cobrado)}</b>
            </span>
            <span className="text-slate-400">
              Diferencia{' '}
              <b className={resumen.diferencia < 0 ? 'text-rose-400' : 'text-emerald-400'}>
                {formatMoney(resumen.diferencia)}
              </b>
            </span>
            <span className="text-slate-400">
              Recibos cobrados{' '}
              <b className="text-white">
                {resumen.cobrados}/{items.length}
              </b>
            </span>

            <div className="flex-1" />

            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800/60 text-slate-300 text-xs font-semibold hover:bg-slate-700/60 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={isSubmitting || isLoading || items.length === 0}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-lg shadow-emerald-600/25 transition-all"
            >
              {isSubmitting ? 'Registrando...' : 'Confirmar rendición'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Lo que dejes vacío cuenta como no cobrado, y esa cuota vuelve a estar disponible para
            la próxima planilla. Se aceptan pagos parciales.
          </p>
        </div>
      </div>
    </div>
  );
};
