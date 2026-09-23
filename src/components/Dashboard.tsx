import React, { useMemo } from 'react';
import {
  HandCoins,
  Wallet,
  AlertTriangle,
  Users,
  Plus,
  ArrowRight,
  Map as MapIcon,
  UserCheck,
  TrendingUp,
} from 'lucide-react';
import { Client, CollectionRow, Loan } from '../types/database';
import { TabType } from './Sidebar';
import { addWeeks, formatDate, formatMoney, round2, today } from '../lib/loanMath';

interface DashboardProps {
  clients: Client[];
  loans: Loan[];
  collection: CollectionRow[];
  onNewClient: () => void;
  onNewLoan: () => void;
  onSelectClient: (client: Client) => void;
  onNavigateTab: (tab: TabType) => void;
}

/** Lunes de la semana de `isoDate`. */
function startOfWeek(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

export const Dashboard: React.FC<DashboardProps> = ({
  clients,
  loans,
  collection,
  onNewClient,
  onNewLoan,
  onSelectClient,
  onNavigateTab,
}) => {
  const hoy = today();
  const lunes = startOfWeek(hoy);
  const domingo = addWeeks(lunes, 1);

  const vigentes = useMemo(
    () => collection.filter(r => r.loan_status !== 'cancelled'),
    [collection]
  );

  const kpis = useMemo(() => {
    const activos = loans.filter(l => l.status === 'active');
    const capitalEnCalle = round2(activos.reduce((a, l) => a + Number(l.principal), 0));
    const porCobrar = round2(
      vigentes.filter(r => r.status !== 'paid').reduce((a, r) => a + Number(r.balance), 0)
    );
    const cobrado = round2(vigentes.reduce((a, r) => a + Number(r.paid_amount), 0));
    const morosas = vigentes.filter(r => r.status === 'overdue');
    const mora = round2(morosas.reduce((a, r) => a + Number(r.balance), 0));

    return {
      capitalEnCalle,
      porCobrar,
      cobrado,
      mora,
      prestamosActivos: activos.length,
      clientesEnMora: new Set(morosas.map(r => r.client_id)).size,
    };
  }, [loans, vigentes]);

  const semana = useMemo(() => {
    const rows = vigentes.filter(r => r.due_date >= lunes && r.due_date < domingo);
    const aCobrar = round2(
      rows.filter(r => r.status !== 'paid').reduce((a, r) => a + Number(r.balance), 0)
    );
    const cobrado = round2(rows.reduce((a, r) => a + Number(r.paid_amount), 0));
    const total = round2(aCobrar + cobrado);
    return { rows, aCobrar, cobrado, total, pct: total > 0 ? Math.round((cobrado / total) * 100) : 0 };
  }, [vigentes, lunes, domingo]);

  /** Rendimiento de la semana agrupado por zona o por cobrador. */
  const groupBy = (key: 'zona' | 'cobrador') => {
    const map = new Map<string, { aCobrar: number; cobrado: number; mora: number }>();

    semana.rows.forEach(r => {
      const label = r[key] || 'Sin asignar';
      const acc = map.get(label) || { aCobrar: 0, cobrado: 0, mora: 0 };
      if (r.status !== 'paid') acc.aCobrar += Number(r.balance);
      if (r.status === 'overdue') acc.mora += Number(r.balance);
      acc.cobrado += Number(r.paid_amount);
      map.set(label, acc);
    });

    return Array.from(map.entries())
      .map(([label, v]) => ({ label, ...v, total: v.aCobrar + v.cobrado }))
      .sort((a, b) => b.total - a.total);
  };

  const morosos = useMemo(() => {
    const map = new Map<string, { client: Client; deuda: number; cuotas: number }>();

    vigentes
      .filter(r => r.status === 'overdue')
      .forEach(r => {
        const client = clients.find(c => c.id === r.client_id);
        if (!client) return;
        const acc = map.get(r.client_id) || { client, deuda: 0, cuotas: 0 };
        acc.deuda += Number(r.balance);
        acc.cuotas += 1;
        map.set(r.client_id, acc);
      });

    return Array.from(map.values())
      .sort((a, b) => b.deuda - a.deuda)
      .slice(0, 6);
  }, [vigentes, clients]);

  const cards = [
    {
      label: 'Capital en la calle',
      value: formatMoney(kpis.capitalEnCalle),
      hint: `${kpis.prestamosActivos} préstamos activos`,
      icon: HandCoins,
      color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    },
    {
      label: 'Por cobrar',
      value: formatMoney(kpis.porCobrar),
      hint: `${vigentes.filter(r => r.status !== 'paid').length} cuotas impagas`,
      icon: Wallet,
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    },
    {
      label: 'Cobrado acumulado',
      value: formatMoney(kpis.cobrado),
      hint: 'sobre todos los préstamos',
      icon: TrendingUp,
      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    },
    {
      label: 'En mora',
      value: formatMoney(kpis.mora),
      hint: `${kpis.clientesEnMora} clientes atrasados`,
      icon: AlertTriangle,
      color: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Panel de Control</h2>
          <p className="text-xs text-slate-400">
            {clients.length} clientes · semana del {formatDate(lunes)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onNewClient}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium transition-colors"
          >
            <Users className="w-4 h-4 text-blue-400" />
            <span>Nuevo Cliente</span>
          </button>
          <button
            onClick={onNewLoan}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-medium shadow-lg shadow-emerald-600/25 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Préstamo</span>
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map(card => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2"
            >
              <div className="flex items-start justify-between">
                <span className="text-xs font-medium text-slate-400">{card.label}</span>
                <div className={`p-2 rounded-xl border ${card.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-bold text-white">{card.value}</p>
              <p className="text-[11px] text-slate-500">{card.hint}</p>
            </div>
          );
        })}
      </div>

      {/* Cobranza de la semana */}
      <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-white">Cobranza de esta semana</h3>
            <p className="text-[11px] text-slate-400">
              {formatDate(lunes)} al {formatDate(domingo)} · {semana.rows.length} cuotas
            </p>
          </div>
          <button
            onClick={() => onNavigateTab('collections')}
            className="flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            Ir a cobrar <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">
              Cobrado{' '}
              <span className="text-emerald-400 font-bold">{formatMoney(semana.cobrado)}</span> de{' '}
              {formatMoney(semana.total)}
            </span>
            <span className="text-white font-bold">{semana.pct}%</span>
          </div>
          <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all"
              style={{ width: `${semana.pct}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500">
            Falta cobrar {formatMoney(semana.aCobrar)} esta semana.
          </p>
        </div>
      </div>

      {/* Zona y cobrador */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { title: 'Cobranza por Zona', icon: MapIcon, data: groupBy('zona') },
          { title: 'Cobranza por Cobrador', icon: UserCheck, data: groupBy('cobrador') },
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

              {block.data.length === 0 ? (
                <p className="text-xs text-slate-500">Sin cuotas esta semana.</p>
              ) : (
                <div className="space-y-2.5">
                  {block.data.map(item => {
                    const pct = item.total > 0 ? Math.round((item.cobrado / item.total) * 100) : 0;
                    return (
                      <div key={item.label} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-slate-200">{item.label}</span>
                          <span className="text-slate-400">
                            <span className="text-emerald-400 font-bold">
                              {formatMoney(item.cobrado)}
                            </span>{' '}
                            / {formatMoney(item.total)}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Morosos */}
      <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400" /> Clientes en mora
          </h3>
          <button
            onClick={() => onNavigateTab('collections')}
            className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
          >
            Ver cobranza <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {morosos.length === 0 ? (
          <p className="text-xs text-slate-500">
            Nadie atrasado. Toda la cartera está al día. 👌
          </p>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {morosos.map(m => (
              <button
                key={m.client.id}
                onClick={() => onSelectClient(m.client)}
                className="w-full flex items-center justify-between py-2.5 text-left hover:bg-slate-800/40 transition-colors px-2 rounded-lg"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{m.client.name}</p>
                  <p className="text-[11px] text-slate-400">
                    {m.client.zona || 'Sin zona'} · {m.client.cobrador || 'Sin cobrador'} ·{' '}
                    {m.cuotas} {m.cuotas === 1 ? 'cuota' : 'cuotas'}
                  </p>
                </div>
                <span className="text-xs font-bold text-rose-400 shrink-0">
                  {formatMoney(m.deuda)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
