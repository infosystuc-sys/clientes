import React, { useEffect, useMemo, useState } from 'react';
import {
  Printer,
  FileText,
  ClipboardCheck,
  Trash2,
  Receipt,
  CalendarRange,
  UserCheck,
  Map as MapIcon,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { CollectionRow, EmisionParams, Rendicion, RendicionItem } from '../types/database';
import { addWeeks, formatDate, formatMoney, round2, today } from '../lib/loanMath';
import { printPlanilla, printRecibos } from '../lib/printDocs';
import { rendicionService } from '../services/rendicionService';
import { RendirModal } from './RendirModal';

interface RendicionesManagerProps {
  rendiciones: Rendicion[];
  collection: CollectionRow[];
  zonas: string[];
  cobradores: string[];
  onEmitir: (params: EmisionParams) => Promise<Rendicion>;
  onRendir: (rendicion: Rendicion, montos: Record<string, number>, fecha: string) => Promise<void>;
  onAnular: (rendicion: Rendicion) => Promise<void>;
  onError: (message: string) => void;
}

/** Lunes de la semana de `isoDate`. */
function startOfWeek(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return date.toISOString().slice(0, 10);
}

/** Domingo de la misma semana: el rango es inclusivo. */
function endOfWeek(lunes: string): string {
  const [y, m, d] = lunes.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 6));
  return date.toISOString().slice(0, 10);
}

export const RendicionesManager: React.FC<RendicionesManagerProps> = ({
  rendiciones,
  collection,
  zonas,
  cobradores,
  onEmitir,
  onRendir,
  onAnular,
  onError,
}) => {
  const lunes = startOfWeek(today());
  const [desde, setDesde] = useState(lunes);
  const [hasta, setHasta] = useState(endOfWeek(lunes));
  const [cobrador, setCobrador] = useState('');
  const [zona, setZona] = useState('');
  const [incluirVencidas, setIncluirVencidas] = useState(false);
  const [isEmitting, setIsEmitting] = useState(false);
  const [emitError, setEmitError] = useState<string | null>(null);
  const [recienEmitida, setRecienEmitida] = useState<Rendicion | null>(null);

  const [yaEmitidas, setYaEmitidas] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const [rindiendo, setRindiendo] = useState<Rendicion | null>(null);
  const [rindiendoItems, setRindiendoItems] = useState<RendicionItem[]>([]);
  const [cargandoItems, setCargandoItems] = useState(false);

  // Si la planilla recién emitida se rindió o anuló, el aviso ya no aplica
  useEffect(() => {
    if (recienEmitida && !rendiciones.some(r => r.id === recienEmitida.id && r.estado === 'emitida')) {
      setRecienEmitida(null);
    }
  }, [rendiciones, recienEmitida]);

  // Cuotas que ya están en una planilla sin rendir: no entran en la vista previa
  useEffect(() => {
    rendicionService
      .getInstallmentsEnPlanillasAbiertas()
      .then(setYaEmitidas)
      .catch(() => setYaEmitidas(new Set()));
  }, [rendiciones]);

  /**
   * Vista previa con los mismos filtros que aplica `emitir_rendicion` en la
   * base. Es orientativa: el número final lo decide la base al emitir.
   */
  const preview = useMemo(() => {
    const rows = collection.filter(
      r =>
        r.loan_status === 'active' &&
        r.status !== 'paid' &&
        r.due_date <= hasta &&
        (incluirVencidas || r.due_date >= desde) &&
        (!cobrador || r.cobrador === cobrador) &&
        (!zona || r.zona === zona) &&
        !yaEmitidas.has(r.installment_id)
    );
    return {
      cantidad: rows.length,
      total: round2(rows.reduce((a, r) => a + Number(r.balance), 0)),
      clientes: new Set(rows.map(r => r.client_id)).size,
    };
  }, [collection, desde, hasta, cobrador, zona, incluirVencidas, yaEmitidas]);

  const setSemana = (offset: number) => {
    const inicio = addWeeks(lunes, offset);
    setDesde(inicio);
    setHasta(endOfWeek(inicio));
  };

  const handleEmitir = async () => {
    setIsEmitting(true);
    setEmitError(null);
    setRecienEmitida(null);
    try {
      const rendicion = await onEmitir({
        desde,
        hasta,
        cobrador: cobrador || undefined,
        zona: zona || undefined,
        incluirVencidas,
      });
      setRecienEmitida(rendicion);
    } catch (err: any) {
      setEmitError(err?.message || 'No se pudo emitir la planilla.');
    } finally {
      setIsEmitting(false);
    }
  };

  /** Carga los recibos de la planilla y ejecuta la acción de impresión. */
  const imprimir = async (rendicion: Rendicion, tipo: 'recibos' | 'planilla') => {
    setBusyId(`${rendicion.id}-${tipo}`);
    try {
      const items = await rendicionService.getItems(rendicion.id);
      if (tipo === 'recibos') printRecibos(rendicion, items);
      else printPlanilla(rendicion, items);
    } catch (err: any) {
      onError(err?.message || 'No se pudo preparar la impresión.');
    } finally {
      setBusyId(null);
    }
  };

  const abrirRendicion = async (rendicion: Rendicion) => {
    setRindiendo(rendicion);
    setRindiendoItems([]);
    setCargandoItems(true);
    try {
      setRindiendoItems(await rendicionService.getItems(rendicion.id));
    } catch (err: any) {
      onError(err?.message || 'No se pudieron cargar los recibos.');
      setRindiendo(null);
    } finally {
      setCargandoItems(false);
    }
  };

  const abiertas = rendiciones.filter(r => r.estado === 'emitida');
  const inputClass =
    'w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-emerald-500';

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Recibos y Rendición</h2>
        <p className="text-xs text-slate-400">
          Emití los recibos de cada cobrador para un período, imprimilos, y cuando vuelva cargá
          lo que cobró.
        </p>
      </div>

      {/* ------------------------------ EMISIÓN ------------------------------ */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/40 flex items-center gap-2">
          <div className="p-2 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400">
            <Receipt className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-sm text-white">Emitir recibos</h3>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-slate-500" /> Cobrador
              </label>
              <select value={cobrador} onChange={e => setCobrador(e.target.value)} className={inputClass}>
                <option value="">Todos los cobradores</option>
                {cobradores.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <MapIcon className="w-3.5 h-3.5 text-slate-500" /> Zona
              </label>
              <select value={zona} onChange={e => setZona(e.target.value)} className={inputClass}>
                <option value="">Todas las zonas</option>
                {zonas.map(z => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <CalendarRange className="w-3.5 h-3.5 text-slate-500" /> Vencen desde
              </label>
              <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className={inputClass} />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">hasta</label>
              <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: 'Semana pasada', offset: -1 },
              { label: 'Esta semana', offset: 0 },
              { label: 'Semana que viene', offset: 1 },
            ].map(s => (
              <button
                key={s.offset}
                onClick={() => setSemana(s.offset)}
                className="px-3 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700 text-slate-300 text-[11px] font-medium transition-colors"
              >
                {s.label}
              </button>
            ))}

            <label className="flex items-center gap-2 ml-2 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={incluirVencidas}
                onChange={e => setIncluirVencidas(e.target.checked)}
                className="accent-emerald-500"
              />
              Incluir cuotas atrasadas anteriores al período
            </label>
          </div>

          {emitError && (
            <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-950/40 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{emitError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
            <p className="text-xs text-slate-400">
              {preview.cantidad === 0 ? (
                'No hay cuotas pendientes con estos filtros.'
              ) : (
                <>
                  Se van a emitir <b className="text-white">{preview.cantidad} recibos</b> de{' '}
                  {preview.clientes} {preview.clientes === 1 ? 'cliente' : 'clientes'} por{' '}
                  <b className="text-emerald-400">{formatMoney(preview.total)}</b>
                </>
              )}
            </p>
            <button
              onClick={handleEmitir}
              disabled={isEmitting || preview.cantidad === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-lg shadow-emerald-600/25 transition-all"
            >
              {isEmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
              Emitir planilla
            </button>
          </div>

          {/* Recién emitida: las impresiones van en botones directos para que el
              navegador no bloquee la ventana emergente. */}
          {recienEmitida && (
            <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex flex-wrap items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <p className="text-xs text-emerald-200 flex-1 min-w-[200px]">
                Planilla <b>N° {recienEmitida.numero}</b> emitida con{' '}
                {recienEmitida.cantidad_recibos} recibos por{' '}
                {formatMoney(recienEmitida.total_esperado)}.
              </p>
              <button
                onClick={() => imprimir(recienEmitida, 'recibos')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
              >
                <Printer className="w-4 h-4" /> Imprimir recibos
              </button>
              <button
                onClick={() => imprimir(recienEmitida, 'planilla')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors"
              >
                <FileText className="w-4 h-4" /> Imprimir planilla
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------ PLANILLAS ----------------------------- */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <h3 className="font-bold text-sm text-white">Planillas</h3>
          {abiertas.length > 0 && (
            <span className="text-[11px] text-amber-300 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {abiertas.length} sin rendir
            </span>
          )}
        </div>

        {rendiciones.length === 0 ? (
          <p className="p-8 text-xs text-slate-500 text-center">Todavía no emitiste ninguna planilla.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">N°</th>
                  <th className="py-3 px-4">Cobrador / Zona</th>
                  <th className="py-3 px-4">Período</th>
                  <th className="py-3 px-4 text-right">Recibos</th>
                  <th className="py-3 px-4 text-right">Esperado</th>
                  <th className="py-3 px-4 text-right">Rendido</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {rendiciones.map(r => {
                  const rendida = r.estado === 'rendida';
                  const diferencia = rendida
                    ? round2(Number(r.total_cobrado || 0) - Number(r.total_esperado))
                    : 0;
                  return (
                    <tr key={r.id} className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-mono font-bold text-blue-400">{r.numero}</td>
                      <td className="py-3 px-4">
                        <p className="text-white font-semibold">{r.cobrador || 'Todos los cobradores'}</p>
                        <p className="text-[11px] text-slate-500">{r.zona || 'Todas las zonas'}</p>
                      </td>
                      <td className="py-3 px-4 text-[11px] text-slate-400">
                        {formatDate(r.desde)} al {formatDate(r.hasta)}
                        {r.incluye_vencidas && <span className="block text-amber-400/80">+ atrasadas</span>}
                      </td>
                      <td className="py-3 px-4 text-right">{r.cantidad_recibos}</td>
                      <td className="py-3 px-4 text-right font-semibold text-white">
                        {formatMoney(r.total_esperado)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {rendida ? (
                          <>
                            <span className="font-semibold text-emerald-400">
                              {formatMoney(r.total_cobrado || 0)}
                            </span>
                            {diferencia !== 0 && (
                              <span className={`block text-[10px] ${diferencia < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                {diferencia > 0 ? '+' : ''}
                                {formatMoney(diferencia)}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {rendida ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                            Rendida {formatDate(r.fecha_rendicion)}
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold border bg-amber-500/20 text-amber-300 border-amber-500/30">
                            En la calle
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => imprimir(r, 'recibos')}
                            disabled={busyId !== null}
                            className="p-2 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700 text-slate-300 disabled:opacity-40 transition-colors"
                            title="Imprimir recibos"
                          >
                            {busyId === `${r.id}-recibos` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => imprimir(r, 'planilla')}
                            disabled={busyId !== null}
                            className="p-2 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700 text-slate-300 disabled:opacity-40 transition-colors"
                            title={rendida ? 'Imprimir planilla rendida' : 'Imprimir planilla de ruta'}
                          >
                            {busyId === `${r.id}-planilla` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                          </button>
                          {!rendida && (
                            <>
                              <button
                                onClick={() => abrirRendicion(r)}
                                className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors"
                              >
                                <ClipboardCheck className="w-3.5 h-3.5" /> Rendir
                              </button>
                              <button
                                onClick={() => onAnular(r)}
                                className="p-2 rounded-lg bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/30 text-rose-300 transition-colors"
                                title="Anular planilla (sus cuotas vuelven a quedar disponibles)"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RendirModal
        rendicion={rindiendo}
        items={rindiendoItems}
        isLoading={cargandoItems}
        onClose={() => setRindiendo(null)}
        onConfirm={(montos, fecha) => onRendir(rindiendo as Rendicion, montos, fecha)}
      />
    </div>
  );
};
