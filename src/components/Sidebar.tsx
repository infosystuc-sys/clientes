import React from 'react';
import { LayoutDashboard, Users, HandCoins, Wallet, Receipt, Settings2, SlidersHorizontal, Database, ShieldCheck } from 'lucide-react';

export type TabType =
  | 'dashboard'
  | 'clients'
  | 'loans'
  | 'collections'
  | 'rendiciones'
  | 'settings'
  | 'supabase-config';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  totalClients: number;
  totalLoans: number;
  /** Cuotas impagas: lo que queda por salir a cobrar. */
  pendingInstallments: number;
  /** Zonas + cobradores dados de alta. */
  catalogCount: number;
  /** Planillas emitidas que el cobrador todavía no rindió. */
  openRendiciones: number;
  isSupabaseConfigured: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  totalClients,
  totalLoans,
  pendingInstallments,
  catalogCount,
  openRendiciones,
  isSupabaseConfigured,
}) => {
  const menuItems = [
    {
      id: 'dashboard' as TabType,
      label: 'Dashboard',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      id: 'clients' as TabType,
      label: 'Clientes',
      icon: Users,
      badge: totalClients,
    },
    {
      id: 'loans' as TabType,
      label: 'Préstamos',
      icon: HandCoins,
      badge: totalLoans,
    },
    {
      id: 'collections' as TabType,
      label: 'Cobranza',
      icon: Wallet,
      badge: pendingInstallments,
    },
    {
      id: 'rendiciones' as TabType,
      label: 'Recibos y Rendición',
      icon: Receipt,
      badge: openRendiciones,
    },
    {
      id: 'settings' as TabType,
      label: 'Configuración',
      icon: SlidersHorizontal,
      badge: catalogCount,
    },
    {
      id: 'supabase-config' as TabType,
      label: 'Config Supabase & SQL',
      icon: Settings2,
      badge: isSupabaseConfigured ? 'LIVE' : 'SETUP',
      isSpecial: true,
    },
  ];

  return (
    <aside className="w-full md:w-64 border-r border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between shrink-0">
      <div className="space-y-6">
        <div>
          <p className="px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
            Navegación
          </p>
          <nav className="space-y-1">
            {menuItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== null && (
                    <span
                      className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : item.isSpecial
                          ? isSupabaseConfigured
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Supabase Status Banner Card */}
        <div className="p-3.5 rounded-2xl bg-gradient-to-b from-slate-800/80 to-slate-900 border border-slate-800 relative overflow-hidden">
          <div className="flex items-center gap-2 mb-1.5">
            <Database className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-xs text-slate-200">Backend Supabase</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {isSupabaseConfigured
              ? 'Conectado exitosamente a las tablas de PostgreSQL.'
              : 'Funcionando en modo local. Ingresa tus llaves para sincronizar.'}
          </p>
          <button
            onClick={() => setActiveTab('supabase-config')}
            className="mt-3 w-full py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-medium text-slate-300 flex items-center justify-center gap-1.5 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
            <span>{isSupabaseConfigured ? 'Ver Estado' : 'Configurar Supabase'}</span>
          </button>
        </div>
      </div>

      {/* Footer Info */}
      <div className="pt-4 border-t border-slate-800/80 text-center">
        <p className="text-[10px] text-slate-500 font-mono">ClienteFlow v2.0 • Préstamos y Cobranza</p>
      </div>
    </aside>
  );
};
