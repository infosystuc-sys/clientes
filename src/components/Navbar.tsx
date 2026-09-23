import React from 'react';
import { Database, Plus, Server, UserCheck, LogIn, Sparkles } from 'lucide-react';
import { SupabaseCredentials } from '../types/database';

interface NavbarProps {
  credentials: SupabaseCredentials;
  onOpenSupabaseConfig: () => void;
  onOpenAuth: () => void;
  onNewClient: () => void;
  currentUser: string | null;
}

export const Navbar: React.FC<NavbarProps> = ({
  credentials,
  onOpenSupabaseConfig,
  onOpenAuth,
  onNewClient,
  currentUser,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-4 lg:px-8 py-3.5 flex items-center justify-between transition-all">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-500 to-cyan-400 p-0.5 shadow-lg shadow-blue-500/20">
          <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
            <Database className="w-5 h-5 text-cyan-400" />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              ClienteFlow CRM
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5" /> Supabase
            </span>
          </div>
          <p className="text-xs text-slate-400">Plataforma de Gestión de Clientes</p>
        </div>
      </div>

      {/* Actions & Connection Badge */}
      <div className="flex items-center gap-3">
        {/* Supabase Status Pill */}
        <button
          onClick={onOpenSupabaseConfig}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
            credentials.isConfigured
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/40 shadow-sm shadow-emerald-900/20'
              : 'bg-amber-950/40 border-amber-500/30 text-amber-300 hover:bg-amber-900/40'
          }`}
          title="Haz clic para configurar tu backend de Supabase"
        >
          <span className="relative flex h-2 w-2">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                credentials.isConfigured ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            ></span>
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                credentials.isConfigured ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            ></span>
          </span>
          <Server className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            {credentials.isConfigured ? 'Supabase Live' : 'Modo Demo (Local)'}
          </span>
        </button>

        {/* Auth Button */}
        <button
          onClick={onOpenAuth}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 text-xs font-medium transition-colors"
        >
          {currentUser ? (
            <>
              <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="max-w-[100px] truncate">{currentUser}</span>
            </>
          ) : (
            <>
              <LogIn className="w-3.5 h-3.5 text-blue-400" />
              <span>Autenticación</span>
            </>
          )}
        </button>

        {/* Primary CTA */}
        <button
          onClick={onNewClient}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium text-xs shadow-lg shadow-blue-600/25 transition-all active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo Cliente</span>
        </button>
      </div>
    </header>
  );
};
