import React, { useMemo, useState } from 'react';
import { HandCoins, Plus, Pencil, Trash2, Search, AlertTriangle, Map as MapIcon, UserCheck } from 'lucide-react';
import { Client, CollectionRow, Loan } from '../types/database';
import { formatDate, formatMoney, round2 } from '../lib/loanMath';

interface LoansManagerProps {
  loans: Loan[];
  clients: Client[];
  collection: CollectionRow[];
  onNewLoan: () => void;
  onEditLoan: (loan: Loan) => void;
  onDeleteLoan: (loan: Loan) => void;
}

type LoanFilter = 'active' | 'overdue' | 'completed' | 'all';

const FILTER_LABELS: Record<LoanFilter, string> = {
  active: 'Activos',
  overdue: 'Con mora',
  completed: 'Saldados',
  all: 'Todos',
};

export const LoansManager: React.FC<LoansManagerProps> = ({
  loans,
  clients,
  collection,
  onNewLoan,
  onEditLoan,
  onDeleteLoan,
}) => {
  const [filter, setFilter] = useState<LoanFilter>('active');
  const [search, setSearch] = useState('');

  /** Totales por préstamo, calculados sobre las cuotas reales. */
  const stats = useMemo(() => {
    const map = new Map<
      string,
      { pagado: number; saldo: number; cuotasPagas: number; cuotas: number; mora: number }
    >();

    collection.forEach(r => {
      const acc = map.get(r.loan_id) || {
        pagado: 0,
        saldo: 0,
        cuotasPagas: 0,
        cuotas: 0,
        mora: 0,
      };
      acc.pagado += Number(r.paid_amount);
      acc.saldo += Number(r.balance);
      acc.cuotas += 1;
      if (r.status === 'paid') acc.cuotasPagas += 1;
      if (r.status === 'overdue') acc.mora += Number(r.balance);
      map.set(r.loan_id, acc);
    });

    return map;
  }, [collection]);

  const getClient = (clientId: string) => clients.find(c => c.id === clientId);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();

    return loans.filter(l => {
      const stat = stats.get(l.id);

      if (filter === 'active' && l.status !== 'active') return false;
      if (filter === 'completed' && l.status !== 'completed') return false;
      if (filter === 'overdue' && !(stat && stat.mora > 0)) return false;

      if (term) {
        const client = getClient(l.client_id);
        const haystack = [client?.name, client?.address, client?.zona, l.cobrador || client?.cobrador]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loans, clients, stats, filter, search]);

  const totales = useMemo(() => {
    const activos = loans.filter(l => l.status === 'active');
    const prestado = round2(activos.reduce((a, l) => a + Number(l.principal), 0));
    const aCobrar = round2(
      activos.reduce((a, l) => a + (stats.get(l.id)?.saldo || 0), 0)
    );
    return { cantidad: activos.length, prestado, aCobrar };
  }, [loans, stats]);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Préstamos</h2>
          <p className="text-xs text-slate-400">
            {totales.cantidad} préstamos activos · {formatMoney(totales.prestado)} en la calle ·{' '}
            {formatMoney(totales.aCobrar)} por cobrar.
          </p>
        </div>

        <button
          onClick={onNewLoan}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-xs shadow-lg shadow-emerald-600/25 transition-all active:scale-95 self-start"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo Préstamo</span>
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(FILTER_LABELS) as LoanFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}

        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por cliente, zona o cobrador..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="p-10 rounded-2xl bg-slate-900/60 border border-dashed border-slate-800 text-center space-y-3">
          <HandCoins className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm font-semibold text-slate-300">No hay préstamos para mostrar</p>
          <p className="text-xs text-slate-500">
            {loans.length === 0
              ? 'Otorgá el primer préstamo y el sistema arma las cuotas semanales solo.'
              : 'Ningún préstamo coincide con este filtro.'}
          </p>
        </div>
      )}

      {/* Grid de préstamos */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(loan => {
          const client = getClient(loan.client_id);
          const stat = stats.get(loan.id);
          const cuotas = stat?.cuotas || loan.installments_count;
          const cuotasPagas = stat?.cuotasPagas || 0;
          const pct = cuotas > 0 ? Math.round((cuotasPagas / cuotas) * 100) : 0;
          const enMora = (stat?.mora || 0) > 0;

          return (
            <div
              key={loan.id}
              className={`p-5 rounded-2xl bg-slate-900/80 border transition-all space-y-4 ${
                enMora ? 'border-rose-500/30' : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold text-base text-white truncate">
                    {client?.name || 'Cliente eliminado'}
                  </h3>
                  <p className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                    <span className="flex items-center gap-1">
                      <MapIcon className="w-3 h-3 text-slate-500" />
                      {client?.zona || 'Sin zona'}
                    </span>
                    <span className="flex items-center gap-1">
                      <UserCheck className="w-3 h-3 text-slate-500" />
                      {loan.cobrador || client?.cobrador || 'Sin cobrador'}
                    </span>
                  </p>
                </div>

                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${
                    loan.status === 'completed'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : loan.status === 'cancelled'
                      ? 'bg-slate-700/40 text-slate-400 border-slate-600/40'
                      : enMora
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                      : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                  }`}
                >
                  {loan.status === 'completed'
                    ? 'Saldado'
                    : loan.status === 'cancelled'
                    ? 'Cancelado'
                    : enMora
                    ? 'En mora'
                    : 'Activo'}
                </span>
              </div>

              {/* Números del préstamo */}
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-500 block">Capital</span>
                  <span className="text-slate-200 font-bold">{formatMoney(loan.principal)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Total</span>
                  <span className="text-slate-200 font-bold">{formatMoney(loan.total_amount)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Saldo</span>
                  <span className="text-white font-bold">{formatMoney(stat?.saldo || 0)}</span>
                </div>
              </div>

              {/* Avance de cuotas */}
              <div className="space-y-1.5 pt-2 border-t border-slate-800">
                <div className="flex justify-between text-[11px] font-medium">
                  <span className="text-slate-400">
                    {cuotasPagas} de {cuotas} cuotas de {formatMoney(loan.installment_amount)}
                  </span>
                  <span className="text-white font-bold">{pct}%</span>
                </div>
                <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-500">
                  Otorgado {formatDate(loan.fecha_otorgamiento || loan.created_at.slice(0, 10))} ·
                  1ª cuota {formatDate(loan.start_date)} · recargo {Number(loan.interest_rate)}%
                </p>
              </div>

              {enMora && (
                <p className="text-[11px] text-rose-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {formatMoney(stat?.mora || 0)} vencido sin cobrar
                </p>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                <button
                  onClick={() => onEditLoan(loan)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700 text-slate-300 text-[11px] font-semibold transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" /> Editar
                </button>
                <button
                  onClick={() => onDeleteLoan(loan)}
                  className="px-3 py-1.5 rounded-lg bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/30 text-rose-300 text-[11px] font-semibold transition-colors"
                  title="Eliminar préstamo y sus cuotas"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
