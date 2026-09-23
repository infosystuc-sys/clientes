import React, { useState } from 'react';
import { X, LogIn, UserPlus, Mail, Lock, CheckCircle, AlertCircle } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: string | null;
  onUserChanged: (email: string | null) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUserChanged,
}) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setIsLoading(true);

    const supabase = getSupabaseClient();

    if (!supabase) {
      // Demo local auth fallback
      onUserChanged(email);
      setMessage({ text: 'Iniciaste sesión en Modo Demo (Local).', isError: false });
      setIsLoading(false);
      setTimeout(() => onClose(), 1200);
      return;
    }

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage({ text: '¡Registro exitoso! Revisa tu email para confirmar.', isError: false });
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onUserChanged(data.user?.email || email);
        setMessage({ text: '¡Sesión iniciada correctamente!', isError: false });
        setTimeout(() => onClose(), 1200);
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Ocurrió un error en la autenticación.', isError: true });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    onUserChanged(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/10 border border-blue-500/30 text-blue-400 flex items-center justify-center">
              <LogIn className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">
                {currentUser ? 'Perfil de Usuario' : isSignUp ? 'Crear Cuenta' : 'Iniciar Sesión'}
              </h3>
              <p className="text-xs text-slate-400">Autenticación de Supabase Auth</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {currentUser ? (
            <div className="space-y-4 text-center">
              <div className="w-16 h-16 rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-400 mx-auto flex items-center justify-center font-bold text-xl">
                {currentUser.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-xs text-slate-400">Sesión Activa como:</p>
                <p className="text-sm font-bold text-white mt-0.5">{currentUser}</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full py-2.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-colors"
              >
                Cerrar Sesión
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {message && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                    message.isError
                      ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                      : 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                  }`}
                >
                  {message.isError ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle className="w-4 h-4 shrink-0" />}
                  <span>{message.text}</span>
                </div>
              )}

              {/* Email */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Correo Electrónico</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    placeholder="tu@correo.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Contraseña</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/25 transition-all"
              >
                {isLoading ? 'Cargando...' : isSignUp ? 'Crear Cuenta Supabase' : 'Ingresar'}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => setIsSignUp(!isSignUp)}
                  className="text-xs text-slate-400 hover:text-blue-400 transition-colors"
                >
                  {isSignUp ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate gratis'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
