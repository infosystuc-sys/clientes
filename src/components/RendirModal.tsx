import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  ClipboardCheck,
  AlertCircle,
  CheckCheck,
  Eraser,
  Loader2,
  Save,
  Plus,
  Trash2,
} from 'lucide-react';
import { MovimientoRendicion, Rendicion, RendicionItem, TipoMovimiento } from '../types/database';
import { formatDate, formatMoney, round2, today } from '../lib/loanMath';
import { clienteCredito, cuotasRecibo } from '../lib/printDocs';

interface RendirModalProps {
  rendicion: Rendicion | null;
  items: RendicionItem[];
  /** Ingresos y egresos ya guardados de la planilla. */
  movimientos: MovimientoRendicion[];
  /** Catálogo de conceptos de Configuración. */
  conceptos: string[];
  isLoading: boolean;
  onClose: () => void;
  /**
   * `montos`: importe por recibo, `null` para dejarlo sin cargar. Con `cerrar`
   * la planilla queda rendida; sin él sólo se guarda el avance. `movimientos`
   * reemplaza a todos los ingresos y egresos de la planilla.
   */
  onSave: (
    montos: Record<string, number | null>,
    fecha: string,
    cerrar: boolean,
    movimientos: MovimientoRendicion[]
  ) => Promise<void>;
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

/** Un renglón de ingreso/egreso como lo edita el operador. */
interface FilaMovimiento {
  key: string;
  concepto: string;
  tipo: TipoMovimiento;
  importe: string;
  detalle: string;
}

const filaVacia = (): FilaMovimiento => ({
  key: crypto.randomUUID(),
  concepto: '',
  tipo: 'ingreso',
  importe: '',
  detalle: '',
});

export const RendirModal: React.FC<RendirModalProps> = ({
  rendicion,
  items,
  movimientos,
  conceptos,
  isLoading,
  onClose,
  onSave,
}) => {
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [filas, setFilas] = useState<FilaMovimiento[]>([]);
  const [tab, setTab] = useState<'recibos' | 'movimientos'>('recibos');
  const [fecha, setFecha] = useState(today());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rendida = rendicion?.estado === 'rendida';

  // Al abrir (o cuando llegan los datos) se precarga lo que ya estaba guardado
  useEffect(() => {
    setMontos(
      Object.fromEntries(
        items
          .filter(i => i.monto_cobrado !== null && i.monto_cobrado !== undefined)
          .map(i => [i.id, toInput(Number(i.monto_cobrado))])
      )
    );
    setFecha(rendicion?.fecha_rendicion || today());
    setError(null);
  }, [rendicion?.id, items]);

  useEffect(() => {
    setFilas(
      movimientos.map(m => ({
        key: m.id || crypto.randomUUID(),
        concepto: m.concepto,
        tipo: m.tipo,
        importe: toInput(Number(m.importe)),
        detalle: m.detalle || '',
      }))
    );
  }, [rendicion?.id, movimientos]);

  useEffect(() => setTab('recibos'), [rendicion?.id]);

  const resumen = useMemo(() => {
    let cobrado = 0;
    let cobrados = 0;
    let cargados = 0;
    let invalidos = 0;
    items.forEach(item => {
      const raw = (montos[item.id] || '').trim();
      const valor = parseMonto(raw);
      if (Number.isNaN(valor) || valor < 0) invalidos++;
      else if (raw !== '') cargados++;
      if (!Number.isNaN(valor) && valor > 0) {
        cobrado += valor;
        cobrados++;
      }
    });
    const esperado = items.reduce((a, i) => a + Number(i.importe), 0);

    let ingresos = 0;
    let egresos = 0;
    let movInvalidos = 0;
    filas.forEach(f => {
      const vacia = !f.concepto && !f.importe.trim() && !f.detalle.trim();
      if (vacia) return;
      const valor = parseMonto(f.importe);
      if (!f.concepto || Number.isNaN(valor) || valor <= 0) {
        movInvalidos++;
        return;
      }
      if (f.tipo === 'ingreso') ingresos += valor;
      else egresos += valor;
    });

    return {
      esperado: round2(esperado),
      cobrado: round2(cobrado),
      diferencia: round2(cobrado - esperado),
      cobrados,
      cargados,
      invalidos,
      ingresos: round2(ingresos),
      egresos: round2(egresos),
      movInvalidos,
      resultado: round2(cobrado + ingresos - egresos),
    };
  }, [items, montos, filas]);

  if (!rendicion) return null;

  const setMonto = (id: string, value: string) => setMontos(prev => ({ ...prev, [id]: value }));

  const cobrarTodo = () =>
    setMontos(Object.fromEntries(items.map(i => [i.id, toInput(Number(i.importe))])));

  const setFila = (key: string, cambios: Partial<FilaMovimiento>) =>
    setFilas(prev => prev.map(f => (f.key === key ? { ...f, ...cambios } : f)));

  const guardar = async (cerrar: boolean) => {
    if (resumen.invalidos > 0) {
      setTab('recibos');
      setError('Hay importes que no son válidos. Revisá los marcados en rojo.');
      return;
    }
    if (resumen.movInvalidos > 0) {
      setTab('movimientos');
      setError('Hay ingresos o egresos incompletos: cada uno necesita concepto e importe mayor a cero.');
      return;
    }

    const sinCargar = items.length - resumen.cargados;
    let aviso: string | null = null;
    if (rendida) {
      aviso = `Se van a modificar los cobros de la planilla N° ${rendicion.numero}: los pagos de los recibos que cambiaron se reemplazan y los recibos vacíos pasan a no cobrados. ¿Guardar los cambios?`;
    } else if (cerrar) {
      aviso =
        resumen.cobrados === 0
          ? `No cargaste ningún cobro. La planilla N° ${rendicion.numero} va a quedar rendida en $ 0 y sus cuotas vuelven a estar disponibles para emitir. ¿Continuar?`
          : `Se van a registrar ${resumen.cobrados} cobros por ${formatMoney(resumen.cobrado)} con fecha ${formatDate(fecha)}.${
              sinCargar > 0 ? ` Los ${sinCargar} recibos sin cargar cuentan como no cobrados.` : ''
            } Resultado de la rendición: ${formatMoney(resumen.resultado)}. Después podés modificarla. ¿Cerrar la planilla?`;
    }
    if (aviso && !window.confirm(aviso)) return;

    const payload: Record<string, number | null> = {};
    items.forEach(item => {
      const raw = montos[item.id] || '';
      if (raw.trim() !== '') payload[item.id] = round2(parseMonto(raw));
      // Lo que se vació después de haberse guardado vuelve a "sin cargar"
      else if (!cerrar && !rendida && item.monto_cobrado !== null && item.monto_cobrado !== undefined) {
        payload[item.id] = null;
      }
    });

    const movs: MovimientoRendicion[] = filas
      .filter(f => f.concepto || f.importe.trim() || f.detalle.trim())
      .map(f => ({
        concepto: f.concepto,
        tipo: f.tipo,
        importe: round2(parseMonto(f.importe)),
        detalle: f.detalle.trim() || null,
      }));

    setIsSubmitting(true);
    setError(null);
    try {
      await onSave(payload, fecha, cerrar || rendida, movs);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar la rendición.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const tabClass = (activa: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
      activa
        ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
    }`;
  const cellInput =
    'w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-emerald-500';
  // Conceptos ya usados que se borraron del catálogo siguen apareciendo
  const opcionesConcepto = Array.from(new Set([...conceptos, ...filas.map(f => f.concepto).filter(Boolean)]));

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
                {rendida ? 'Modificar rendición' : 'Rendir planilla'} N° {rendicion.numero}
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
          <div className="flex items-center gap-1.5">
            <button onClick={() => setTab('recibos')} className={tabClass(tab === 'recibos')}>
              Recibos ({items.length})
            </button>
            <button onClick={() => setTab('movimientos')} className={tabClass(tab === 'movimientos')}>
              Ingresos y egresos ({filas.length})
            </button>
          </div>
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
          {tab === 'recibos' ? (
            <>
              <button
                onClick={cobrarTodo}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                title="Completa cada recibo con el importe total a cobrar"
              >
                <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> Todos pagaron completo
              </button>
              <button
                onClick={() => setMontos({})}
                title="Vacía todos los importes de esta pantalla"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                <Eraser className="w-3.5 h-3.5" /> Limpiar
              </button>
            </>
          ) : (
            <button
              onClick={() => setFilas(prev => [...prev, filaVacia()])}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" /> Agregar movimiento
            </button>
          )}
        </div>

        {/* Contenido */}
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="p-10 flex items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando planilla...
            </div>
          ) : tab === 'recibos' ? (
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
                        {cuotasRecibo(item)} · {formatDate(item.vencimiento)}
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
          ) : filas.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 space-y-3">
              <p>Sin ingresos ni egresos cargados para este cobrador.</p>
              <button
                onClick={() => setFilas([filaVacia()])}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Agregar movimiento
              </button>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-semibold uppercase tracking-wider text-[10px] sticky top-0">
                <tr>
                  <th className="py-2.5 px-3">Concepto</th>
                  <th className="py-2.5 px-3 w-36">Tipo</th>
                  <th className="py-2.5 px-3 w-36 text-right">Importe</th>
                  <th className="py-2.5 px-3">Detalle</th>
                  <th className="py-2.5 px-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filas.map(f => {
                  const valor = parseMonto(f.importe);
                  const importeInvalido = f.importe.trim() !== '' && (Number.isNaN(valor) || valor <= 0);
                  return (
                    <tr key={f.key}>
                      <td className="py-2 px-3">
                        <select
                          value={f.concepto}
                          onChange={e => setFila(f.key, { concepto: e.target.value })}
                          className={`${cellInput} ${!f.concepto ? 'text-slate-500' : ''}`}
                        >
                          <option value="">Elegí un concepto…</option>
                          {opcionesConcepto.map(c => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex rounded-lg border border-slate-800 overflow-hidden">
                          {(['ingreso', 'egreso'] as TipoMovimiento[]).map(t => (
                            <button
                              key={t}
                              onClick={() => setFila(f.key, { tipo: t })}
                              className={`flex-1 py-1.5 text-[11px] font-semibold transition-colors ${
                                f.tipo === t
                                  ? t === 'ingreso'
                                    ? 'bg-emerald-600/30 text-emerald-300'
                                    : 'bg-rose-600/30 text-rose-300'
                                  : 'bg-slate-950 text-slate-500 hover:text-slate-300'
                              }`}
                            >
                              {t === 'ingreso' ? 'Ingreso' : 'Egreso'}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={f.importe}
                          onChange={e => setFila(f.key, { importe: e.target.value })}
                          placeholder="0"
                          className={`${cellInput} text-right font-mono ${importeInvalido ? 'border-rose-500! text-rose-300' : ''}`}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={f.detalle}
                          onChange={e => setFila(f.key, { detalle: e.target.value })}
                          placeholder="Ej.: Víctor, transferencia, entrega…"
                          className={cellInput}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <button
                          onClick={() => setFilas(prev => prev.filter(x => x.key !== f.key))}
                          className="p-1.5 rounded-lg hover:bg-rose-600/20 text-slate-500 hover:text-rose-300 transition-colors"
                          title="Quitar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">A cobrar</p>
              <p className="font-bold text-white">{formatMoney(resumen.esperado)}</p>
              <p className="text-[11px] text-slate-400">{items.length} recibos</p>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Cobrado</p>
              <p className="font-bold text-emerald-400">{formatMoney(resumen.cobrado)}</p>
              <p className="text-[11px] text-slate-400">
                {resumen.cobrados} recibos
                {resumen.diferencia !== 0 && (
                  <span className={resumen.diferencia < 0 ? 'text-rose-400' : 'text-emerald-400'}>
                    {' '}· {formatMoney(resumen.diferencia)}
                  </span>
                )}
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Ingresos</p>
              <p className="font-bold text-emerald-300">+ {formatMoney(resumen.ingresos)}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Egresos</p>
              <p className="font-bold text-rose-300">− {formatMoney(resumen.egresos)}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 col-span-2 sm:col-span-1">
              <p className="text-[10px] uppercase tracking-wider text-emerald-400/80 font-semibold">Resultado</p>
              <p className={`font-bold ${resumen.resultado < 0 ? 'text-rose-300' : 'text-white'}`}>
                {formatMoney(resumen.resultado)}
              </p>
              <p className="text-[11px] text-slate-400">cobrado + ingresos − egresos</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[11px] text-slate-500 flex-1 min-w-[240px]">
              {rendida
                ? 'Los cambios reemplazan los pagos de los recibos modificados. Un recibo vacío cuenta como no cobrado.'
                : '"Guardar avance" registra lo cargado y deja la planilla abierta. Al cerrar, lo que quede vacío cuenta como no cobrado. Escribí 0 si el cliente fue visitado y no pagó.'}
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800/60 text-slate-300 text-xs font-semibold hover:bg-slate-700/60 transition-colors"
            >
              Cancelar
            </button>
            {!rendida && (
              <button
                onClick={() => guardar(false)}
                disabled={isSubmitting || isLoading || items.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-emerald-500/40 bg-emerald-600/10 hover:bg-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed text-emerald-300 text-xs font-semibold transition-colors"
                title="Guarda lo cargado y deja la planilla abierta para seguir después"
              >
                <Save className="w-3.5 h-3.5" /> Guardar avance
              </button>
            )}
            <button
              onClick={() => guardar(true)}
              disabled={isSubmitting || isLoading || items.length === 0}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-lg shadow-emerald-600/25 transition-all"
            >
              {isSubmitting ? 'Guardando...' : rendida ? 'Guardar cambios' : 'Cerrar y rendir'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
