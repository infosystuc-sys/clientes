import React, { useState } from 'react';
import { Plus, Check, X, Loader2 } from 'lucide-react';

interface CatalogSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  /** Crea el ítem en el catálogo y devuelve el nombre ya normalizado. */
  onCreate: (nombre: string) => Promise<string>;
  icon: React.ElementType;
  emptyLabel: string;
  createLabel: string;
  required?: boolean;
  disabled?: boolean;
}

/**
 * Select contra el catálogo (zonas o cobradores) con alta al vuelo: el operador
 * no tiene que abandonar el alta del cliente para dar de alta una zona nueva.
 */
export const CatalogSelect: React.FC<CatalogSelectProps> = ({
  label,
  value,
  onChange,
  options,
  onCreate,
  icon: Icon,
  emptyLabel,
  createLabel,
  required = false,
  disabled = false,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    const nombre = draft.trim();
    if (!nombre) return;

    setIsSaving(true);
    setError(null);
    try {
      const creado = await onCreate(nombre);
      onChange(creado);
      setDraft('');
      setIsCreating(false);
    } catch (err: any) {
      setError(err?.message || 'No se pudo crear.');
    } finally {
      setIsSaving(false);
    }
  };

  const inputClass =
    'w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-blue-500 transition-colors';

  return (
    <div className="space-y-1">
      {label && (
        <label className="text-xs font-semibold text-slate-300">
          {label} {required && <span className="text-rose-400">*</span>}
        </label>
      )}

      {isCreating ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Icon className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  // Enter dentro de un formulario enviaría el alta del cliente.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreate();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsCreating(false);
                    setError(null);
                  }
                }}
                placeholder={createLabel}
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={handleCreate}
              disabled={isSaving || !draft.trim()}
              className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors"
              title="Guardar"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setError(null);
                setDraft('');
              }}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 transition-colors"
              title="Cancelar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {error && <p className="text-[11px] text-rose-400">{error}</p>}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Icon className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <select
              required={required}
              disabled={disabled}
              value={value}
              onChange={e => onChange(e.target.value)}
              className={`${inputClass} disabled:opacity-50`}
            >
              <option value="">{emptyLabel}</option>
              {options.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              {/* Un valor viejo que ya no está en el catálogo sigue visible */}
              {value && !options.includes(value) && (
                <option value={value}>{value} (fuera de catálogo)</option>
              )}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-blue-400 transition-colors"
            title={createLabel}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
