import React, { useEffect, useMemo, useState } from 'react';
import {
  Wallet,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Map as MapIcon,
  UserCheck,
  Search,
  Phone,
  MapPin,
  Download,
  Printer,
  Loader2,
} from 'lucide-react';
import { CollectionRow, InstallmentStatus } from '../types/database';
import { addWeeks, formatDate, formatMoney, round2, today } from '../lib/loanMath';
import { printRecibos } from '../lib/printDocs';
import { rendicionService } from '../services/rendicionService';

interface CollectionsManagerProps {
  rows: CollectionRow[];
  onCollect: (row: CollectionRow) => void;
  /** Muestra el error de una reimpresión fallida (mismo toast que el resto de la app). */
  onError: (message: string) => void;
}

type PeriodFilter = 'week' | 'overdue' | 'pending' | 'all';

const PERIOD_LABELS: Record<PeriodFilter, string> = {
  week: 'Semana actual',
  overdue: 'Vencidas',
  pending: 'Todo lo impago',
  all: 'Todas',
};

const STATUS_STYLES: Record<InstallmentStatus, string> = {
  paid: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  pending: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
  partial: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  overdue: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

const STATUS_LABELS: Record<InstallmentStatus, string> = {
  paid: 'Pagada',
  pending: 'Pendiente',
  partial: 'Parcial',
  overdue: 'Vencida',
};

/** Lunes de la semana de `isoDate`. */
function startOfWeek(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0 = domingo
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

export const CollectionsManager: React.FC<CollectionsManagerProps> = ({
  rows,
  onCollect,
  onError,
}) => {
  const [period, setPeriod] = useState<PeriodFilter>('week');
  const [zona, setZona] = useState('all');
  const [cobrador, setCobrador] = useState('all');
  const [search, setSearch] = useState('');

  // Cuotas con al menos un recibo emitido alguna vez: sólo esas se pueden reimprimir.
  const [conRecibo, setConRecibo] = useState<Set<string>>(new Set());
  const [reimprimiendoId, setReimprimiendoId] = useState<string | null>(null);

  useEffect(() => {
    rendicionService
      .getInstallmentsConRecibo()
      .then(setConRecibo)
      .catch(() => setConRecibo(new Set()));
  }, [rows]);

  const reimprimir = async (row: CollectionRow) => {
    setReimprimiendoId(row.installment_id);
    try {
      const encontrado = await rendicionService.getUltimoReciboDeCuota(row.installment_id);
      if (!encontrado) {
        onError('Esta cuota nunca tuvo un recibo emitido.');
        return;
      }
      printRecibos(encontrado.rendicion, [encontrado.item]);
    } catch (err: any) {
      onError(err?.message || 'No se pudo reimprimir el recibo.');
    } finally {
      setReimprimiendoId(null);
    }
  };

  const hoy = today();
  const lunes = startOfWeek(hoy);
  const domingo = addWeeks(lunes, 1);

  const zonas = useMemo(
    () => Array.from(new Set(rows.map(r => r.zona).filter(Boolean) as string[])).sort(),
    [rows]
  );
  const cobradores = useMemo(
    () => Array.from(new Set(rows.map(r => r.cobrador).filter(Boolean) as string[])).sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const term = search.toLowerCase();

    return rows.filter(r => {
      if (r.loan_status === 'cancelled') return false;

      if (period === 'week' && !(r.due_date >= lunes && r.due_date < domingo)) return false;
      if (period === 'overdue' && r.status !== 'overdue') return false;
      if (period === 'pending' && r.status === 'paid') return false;

      if (zona !== 'all' && (r.zona || '') !== zona) return false;
      if (cobrador !== 'all' && (r.cobrador || '') !== cobrador) return false;

      if (term) {
        const haystack = [r.client_name, r.address, r.phone, r.zona, r.cobrador]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      return true;
    });
  }, [rows, period, zona, cobrador, search, lunes, domingo]);

  const totals = useMemo(() => {
    const aCobrar = round2(
      filtered.filter(r => r.status !== 'paid').reduce((acc, r) => acc + Number(r.balance), 0)
    );
    const cobrado = round2(filtered.reduce((acc, r) => acc + Number(r.paid_amount), 0));
    const mora = round2(
      filtered.filter(r => r.status === 'overdue').reduce((acc, r) => acc + Number(r.balance), 0)
    );
    return { aCobrar, cobrado, mora, moraCount: filtered.filter(r => r.status === 'overdue').length };
  }, [filtered]);

  /** Agrupa el saldo pendiente y lo cobrado por zona o por cobrador. */
  const groupBy = (key: 'zona' | 'cobrador') => {
    const map = new Map<string, { aCobrar: number; cobrado: number; mora: number; count: number }>();

    filtered.forEach(r => {
      const label = r[key] || 'Sin asignar';
      const acc = map.get(label) || { aCobrar: 0, cobrado: 0, mora: 0, count: 0 };
      if (r.status !== 'paid') acc.aCobrar += Number(r.balance);
      if (r.status === 'overdue') acc.mora += Number(r.balance);
      acc.cobrado += Number(r.paid_amount);
      acc.count += 1;
      map.set(label, acc);
    });

    return Array.from(map.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.aCobrar - a.aCobrar);
  };

  const porZona = groupBy('zona');
  const porCobrador = groupBy('cobrador');

  const handleExportCSV = () => {
    if (!filtered.length) return;

    const headers = [
      'Cliente',
      'Domicilio',
      'Teléfono',
      'Zona',
      'Cobrador',
      'Cuota',
      'Vencimiento',
      'Monto',
      'Pagado',
      'Saldo',
      'Estado',
    ];
    const csvRows = filtered.map(r =>
      [
        `"${r.client_name}"`,
        `"${(r.address || '').replace(/"/g, '""')}"`,
        `"${r.phone}"`,
        `"${r.zona || ''}"`,
        `"${r.cobrador || ''}"`,
        r.number,
        r.due_date,
        r.amount,
        r.paid_amount,
        r.balance,
        STATUS_LABELS[r.status],
      ].join(',')
    );

    const csv = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...csvRows].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', `cobranza_${hoy}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const selectClass =
    'px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-emerald-500';

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Cobranza Semanal</h2>
          <p className="text-xs text-slate-400">
            Semana del {formatDate(lunes)} al {formatDate(addWeeks(lunes, 1))} · control por zona y
            cobrador.
          </p>
        </div>

        <button
          onClick={handleExportCSV}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-xs font-medium border border-slate-700 transition-colors self-start"
          title="Exportar la hoja de ruta"
        >
          <Download className="w-4 h-4 text-emerald-400" />
          <span>Exportar hoja de ruta</span>
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/20 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-amber-400">A cobrar</span>
            <p className="text-2xl font-bold text-white mt-1">{formatMoney(totals.aCobrar)}</p>
            <span className="text-[11px] text-slate-500">
              {filtered.filter(r => r.status !== 'paid').length} cuotas
            </span>
          </div>
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/20 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-emerald-400">Cobrado</span>
            <p className="text-2xl font-bold text-white mt-1">{formatMoney(totals.cobrado)}</p>
            <span className="text-[11px] text-slate-500">sobre las cuotas filtradas</span>
          </div>
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-500/20 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-rose-400">En mora</span>
            <p className="text-2xl font-bold text-white mt-1">{formatMoney(totals.mora)}</p>
            <span className="text-[11px] text-slate-500">{totals.moraCount} cuotas vencidas</span>
          </div>
          <div className="p-3 rounded-xl bg-rose-500/10 text-rose-400">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Desglose por zona y cobrador */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { title: 'Por Zona', icon: MapIcon, data: porZona },
          { title: 'Por Cobrador', icon: UserCheck, data: porCobrador },
        ].map(block => {
          const Icon = block.icon;
          return (
            <div
              key={block.title}
              className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3"
            >
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <Icon className="w-4 h-4 text-blue-400" /> {block.title}
              </h3>

              {block.data.length === 0 && (
                <p className="text-xs text-slate-500">Sin cuotas en el período seleccionado.</p>
              )}

              <div className="space-y-2">
                {block.data.map(item => {
                  const total = item.aCobrar + item.cobrado;
                  const pct = total > 0 ? Math.round((item.cobrado / total) * 100) : 0;
                  return (
                    <div key={item.label} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-slate-200">{item.label}</span>
                        <span className="text-slate-400">
                          <span className="text-emerald-400 font-bold">
                            {formatMoney(item.cobrado)}
                          </span>{' '}
                          / {formatMoney(total)}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {item.mora > 0 && (
                        <p className="text-[10px] text-rose-400">
                          {formatMoney(item.mora)} en mora
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(PERIOD_LABELS) as PeriodFilter[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              period === p
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}

        <select value={zona} onChange={e => setZona(e.target.value)} className={selectClass}>
          <option value="all">Todas las zonas</option>
          {zonas.map(z => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>

        <select value={cobrador} onChange={e => setCobrador(e.target.value)} className={selectClass}>
          <option value="all">Todos los cobradores</option>
          {cobradores.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar cliente, domicilio o teléfono..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`${selectClass} w-full pl-9`}
          />
        </div>
      </div>

      {/* Listado */}
      {filtered.length === 0 ? (
        <div className="p-10 rounded-2xl bg-slate-900/60 border border-dashed border-slate-800 text-center space-y-3">
          <Wallet className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm font-semibold text-slate-300">No hay cuotas para cobrar</p>
          <p className="text-xs text-slate-500">
            {rows.length === 0
              ? 'Cargá un préstamo y el sistema arma el plan de cuotas semanales.'
              : 'Probá con otro período, zona o cobrador.'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3.5 px-4">Cliente / Domicilio</th>
                  <th className="py-3.5 px-4">Zona / Cobrador</th>
                  <th className="py-3.5 px-4">Cuota</th>
                  <th className="py-3.5 px-4">Vence</th>
                  <th className="py-3.5 px-4 text-right">Monto</th>
                  <th className="py-3.5 px-4 text-right">Saldo</th>
                  <th className="py-3.5 px-4">Estado</th>
                  <th className="py-3.5 px-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filtered.map(r => (
                  <tr key={r.installment_id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 max-w-xs">
                      <p className="font-semibold text-white">{r.client_name}</p>
                      <p className="text-[11px] text-slate-400 flex items-start gap-1">
                        <MapPin className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" /> {r.address}
                      </p>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1 font-mono">
                        <Phone className="w-3 h-3" /> {r.phone}
                      </p>
                    </td>

                    <td className="py-3.5 px-4 text-[11px]">
                      <p className="text-slate-300">{r.zona || 'Sin zona'}</p>
                      <p className="text-slate-500">{r.cobrador || 'Sin cobrador'}</p>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-slate-400">N° {r.number}</td>

                    <td className="py-3.5 px-4 text-slate-400">{formatDate(r.due_date)}</td>

                    <td className="py-3.5 px-4 text-right text-slate-300">
                      {formatMoney(r.amount)}
                      {r.paid_amount > 0 && r.status !== 'paid' && (
                        <span className="block text-[10px] text-emerald-400">
                          pagó {formatMoney(r.paid_amount)}
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right font-bold text-white">
                      {formatMoney(r.balance)}
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                          STATUS_STYLES[r.status]
                        }`}
                      >
                        {STATUS_LABELS[r.status]}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {conRecibo.has(r.installment_id) && (
                          <button
                            onClick={() => reimprimir(r)}
                            disabled={reimprimiendoId !== null}
                            className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700 text-slate-300 disabled:opacity-40 transition-colors"
                            title="Reimprimir el recibo de esta cuota"
                          >
                            {reimprimiendoId === r.installment_id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Printer className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                        {r.status === 'paid' ? (
                          <span className="text-[11px] text-slate-600">Saldada</span>
                        ) : (
                          <button
                            onClick={() => onCollect(r)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold shadow-md shadow-emerald-600/20 transition-all active:scale-95"
                          >
                            Cobrar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
