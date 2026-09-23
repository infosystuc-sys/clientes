import React, { useState } from 'react';
import { Database, Copy, Check, Server, ShieldCheck, Key, ExternalLink, Code2, Sparkles, RefreshCw } from 'lucide-react';
import { SupabaseCredentials } from '../types/database';
import { saveSupabaseCredentials } from '../lib/supabase';
// El script se lee del archivo real del repo para que no se desincronice.
import sqlCode from '../../supabase/schema_completo.sql?raw';

interface SupabaseConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  credentials: SupabaseCredentials;
  onCredentialsUpdated: () => void;
}

export const SupabaseConfigModal: React.FC<SupabaseConfigModalProps> = ({
  isOpen,
  onClose,
  credentials,
  onCredentialsUpdated,
}) => {
  const [url, setUrl] = useState(credentials.url || '');
  const [anonKey, setAnonKey] = useState(credentials.anonKey || '');
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'sql'>('config');

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveSupabaseCredentials(url.trim(), anonKey.trim());
    onCredentialsUpdated();
  };

  const handleClear = () => {
    saveSupabaseCredentials('', '');
    setUrl('');
    setAnonKey('');
    onCredentialsUpdated();
  };

  const handleCopySQL = () => {
    navigator.clipboard.writeText(sqlCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Configuración del Backend Supabase</h3>
              <p className="text-xs text-slate-400">Conecta tu base de datos de PostgreSQL en minutos</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        {/* Tab Buttons */}
        <div className="flex border-b border-slate-800 bg-slate-950/30 px-6">
          <button
            onClick={() => setActiveTab('config')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'config'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>Credenciales API</span>
          </button>
          <button
            onClick={() => setActiveTab('sql')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'sql'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>Script SQL Inicializador</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {activeTab === 'config' ? (
            <form onSubmit={handleSave} className="space-y-4">
              {/* Status Banner */}
              <div
                className={`p-4 rounded-xl border flex items-start gap-3 ${
                  credentials.isConfigured
                    ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                    : 'bg-amber-950/30 border-amber-500/30 text-amber-300'
                }`}
              >
                <Server className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="font-bold">
                    {credentials.isConfigured
                      ? '✓ Conexión Supabase Activa'
                      : '⚠️ Modo Demo Activo (Persistencia Local)'}
                  </p>
                  <p className="text-slate-400 leading-relaxed">
                    {credentials.isConfigured
                      ? 'Las consultas CRUD se ejecutan directamente en la nube de Supabase.'
                      : 'Ingresa tu Supabase URL y Anon Key a continuación para sincronizar tus datos reales.'}
                  </p>
                </div>
              </div>

              {/* URL */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Supabase Project URL (VITE_SUPABASE_URL)
                </label>
                <input
                  type="text"
                  placeholder="https://xyzxyz.supabase.co"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Anon Key */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Supabase Anon Key (VITE_SUPABASE_ANON_KEY)
                </label>
                <input
                  type="password"
                  placeholder="eyJhY2Nlc3N... (Anon Public Key)"
                  value={anonKey}
                  onChange={e => setAnonKey(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-xs text-rose-400 hover:underline"
                >
                  Restablecer a Modo Local
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-lg shadow-emerald-500/20 flex items-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Guardar y Conectar</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  Copia este script y pégalo en el{' '}
                  <a
                    href="https://supabase.com/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 underline inline-flex items-center gap-1"
                  >
                    SQL Editor de tu proyecto Supabase <ExternalLink className="w-3 h-3" />
                  </a>
                </p>
                <button
                  onClick={handleCopySQL}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? '¡Copiado!' : 'Copiar SQL'}</span>
                </button>
              </div>

              <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300/90 overflow-x-auto max-h-80 leading-relaxed">
                {sqlCode}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
