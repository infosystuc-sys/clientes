import React, { useState } from 'react';
import {
  Map as MapIcon,
  UserCheck,
  Briefcase,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Users,
  AlertCircle,
} from 'lucide-react';
import {
  Client,
  Cobrador,
  CobradorInput,
  Rubro,
  RubroInput,
  Zona,
  ZonaInput,
} from '../types/database';

interface SettingsManagerProps {
  zonas: Zona[];
  cobradores: Cobrador[];
  rubros: Rubro[];
  clients: Client[];
  onCreateZona: (input: ZonaInput) => Promise<void>;
  onUpdateZona: (zona: Zona, input: ZonaInput) => Promise<void>;
  onDeleteZona: (zona: Zona) => Promise<void>;
  onCreateCobrador: (input: CobradorInput) => Promise<void>;
  onUpdateCobrador: (cobrador: Cobrador, input: CobradorInput) => Promise<void>;
  onDeleteCobrador: (cobrador: Cobrador) => Promise<void>;
  onCreateRubro: (input: RubroInput) => Promise<void>;
  onUpdateRubro: (rubro: Rubro, input: RubroInput) => Promise<void>;
  onDeleteRubro: (rubro: Rubro) => Promise<void>;
}

const inputClass =
  'w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-blue-500 transition-colors';

/** Deja sólo dígitos y corta en 10, igual que el teléfono del cliente. */
function normalizePhone(value: string): string {
  return value.replace(/\D/g, '').slice(0, 10);
}

/** Ítem mínimo que necesita el panel genérico: zonas y rubros lo cumplen. */
interface SimpleItem {
  id: string;
  nombre: string;
  descripcion?: string;
}

interface CatalogPanelProps<T extends SimpleItem> {
  title: string;
  icon: React.ElementType;
  accent: string;
  placeholder: string;
  items: T[];
  usageCount: (nombre: string) => number;
  onCreate: (input: { nombre: string; descripcion?: string }) => Promise<void>;
  onRename: (item: T, nombre: string) => Promise<void>;
  onDelete: (item: T) => Promise<void>;
}

/** Panel de alta/baja/modificación para un catálogo de nombre + descripción. */
function CatalogPanel<T extends SimpleItem>({
  title,
  icon: Icon,
  accent,
  placeholder,
  items,
  usageCount,
  onCreate,
  onRename,
  onDelete,
}: CatalogPanelProps<T>) {
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevaDescripcion, setNuevaDescripcion] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoNombre.trim()) return;
    await onCreate({
      nombre: nuevoNombre.trim(),
      descripcion: nuevaDescripcion.trim() || undefined,
    });
    setNuevoNombre('');
    setNuevaDescripcion('');
  };

  return (
    <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/40 flex items-center gap-2">
        <div className={`p-2 rounded-xl border ${accent}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <h3 className="font-bold text-sm text-white">{title}</h3>
          <p className="text-[11px] text-slate-400">{items.length} cargados</p>
        </div>
      </div>

      <form onSubmit={handleCreate} className="p-4 space-y-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={nuevoNombre}
            onChange={e => setNuevoNombre(e.target.value)}
            placeholder={placeholder}
            className={inputClass}
          />
          <button
            type="submit"
            disabled={!nuevoNombre.trim()}
            className="p-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors shrink-0"
            title="Agregar"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <input
          type="text"
          value={nuevaDescripcion}
          onChange={e => setNuevaDescripcion(e.target.value)}
          placeholder="Descripción (opcional)"
          className={inputClass}
        />
      </form>

      <div className="divide-y divide-slate-800/60 max-h-96 overflow-y-auto">
        {items.length === 0 && (
          <p className="p-5 text-xs text-slate-500 text-center">Todavía no cargaste ninguno.</p>
        )}

        {items.map(item => {
          const enUso = usageCount(item.nombre);
          const editando = editId === item.id;

          return (
            <div key={item.id} className="p-4 flex items-center gap-3">
              {editando ? (
                <>
                  <input
                    type="text"
                    autoFocus
                    value={editNombre}
                    onChange={e => setEditNombre(e.target.value)}
                    className={inputClass}
                  />
                  <button
                    onClick={async () => {
                      await onRename(item, editNombre);
                      setEditId(null);
                    }}
                    disabled={!editNombre.trim()}
                    className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white">{item.nombre}</p>
                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {enUso} {enUso === 1 ? 'cliente' : 'clientes'}
                      {item.descripcion && ` · ${item.descripcion}`}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setEditId(item.id);
                      setEditNombre(item.nombre);
                    }}
                    className="p-2 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700 text-slate-300 transition-colors"
                    title="Renombrar"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(item)}
                    className="p-2 rounded-lg bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/30 text-rose-300 transition-colors"
                    title="Eliminar"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const SettingsManager: React.FC<SettingsManagerProps> = ({
  zonas,
  cobradores,
  rubros,
  clients,
  onCreateZona,
  onUpdateZona,
  onDeleteZona,
  onCreateCobrador,
  onUpdateCobrador,
  onDeleteCobrador,
  onCreateRubro,
  onUpdateRubro,
  onDeleteRubro,
}) => {
  const [nuevoCobrador, setNuevoCobrador] = useState('');
  const [nuevoTelefono, setNuevoTelefono] = useState('');
  const [nuevaZonaCobrador, setNuevaZonaCobrador] = useState('');
  const [editCobradorId, setEditCobradorId] = useState<string | null>(null);
  const [editCobradorNombre, setEditCobradorNombre] = useState('');
  const [editCobradorTelefono, setEditCobradorTelefono] = useState('');
  const [editCobradorZona, setEditCobradorZona] = useState('');

  const handleCreateCobrador = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoCobrador.trim()) return;
    await onCreateCobrador({
      nombre: nuevoCobrador.trim(),
      telefono: nuevoTelefono || undefined,
      zona: nuevaZonaCobrador || undefined,
    });
    setNuevoCobrador('');
    setNuevoTelefono('');
    setNuevaZonaCobrador('');
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Configuración</h2>
        <p className="text-xs text-slate-400">
          Zonas de cobranza, cobradores y rubros. Renombrar acá actualiza a todos los clientes
          y préstamos asignados.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <CatalogPanel
          title="Zonas"
          icon={MapIcon}
          accent="bg-blue-600/20 border-blue-500/30 text-blue-400"
          placeholder="Nombre de la zona (ej. Centro)"
          items={zonas}
          usageCount={nombre => clients.filter(c => c.zona === nombre).length}
          onCreate={onCreateZona}
          onRename={(zona, nombre) => onUpdateZona(zona, { nombre })}
          onDelete={onDeleteZona}
        />

        <CatalogPanel
          title="Rubros"
          icon={Briefcase}
          accent="bg-amber-600/20 border-amber-500/30 text-amber-400"
          placeholder="Nombre del rubro (ej. Kiosco)"
          items={rubros}
          usageCount={nombre => clients.filter(c => c.rubro === nombre).length}
          onCreate={onCreateRubro}
          onRename={(rubro, nombre) => onUpdateRubro(rubro, { nombre })}
          onDelete={onDeleteRubro}
        />

        {/* Cobradores tiene campos propios, no entra en el panel genérico */}
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/40 flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400">
              <UserCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Cobradores</h3>
              <p className="text-[11px] text-slate-400">{cobradores.length} cargados</p>
            </div>
          </div>

          <form onSubmit={handleCreateCobrador} className="p-4 space-y-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={nuevoCobrador}
                onChange={e => setNuevoCobrador(e.target.value)}
                placeholder="Nombre y apellido"
                className={inputClass}
              />
              <button
                type="submit"
                disabled={!nuevoCobrador.trim()}
                className="p-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors shrink-0"
                title="Agregar cobrador"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <input
              type="tel"
              inputMode="numeric"
              value={nuevoTelefono}
              onChange={e => setNuevoTelefono(normalizePhone(e.target.value))}
              placeholder="Teléfono (3813045236)"
              className={`${inputClass} font-mono`}
            />
            <select
              value={nuevaZonaCobrador}
              onChange={e => setNuevaZonaCobrador(e.target.value)}
              className={inputClass}
            >
              <option value="">Zona principal (opcional)</option>
              {zonas.map(z => (
                <option key={z.id} value={z.nombre}>
                  {z.nombre}
                </option>
              ))}
            </select>
          </form>

          <div className="divide-y divide-slate-800/60 max-h-96 overflow-y-auto">
            {cobradores.length === 0 && (
              <p className="p-5 text-xs text-slate-500 text-center">
                Todavía no cargaste ningún cobrador.
              </p>
            )}

            {cobradores.map(cobrador => {
              const enUso = clients.filter(c => c.cobrador === cobrador.nombre).length;
              const editando = editCobradorId === cobrador.id;

              return (
                <div key={cobrador.id} className="p-4 space-y-2">
                  {editando ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        autoFocus
                        value={editCobradorNombre}
                        onChange={e => setEditCobradorNombre(e.target.value)}
                        className={inputClass}
                      />
                      <input
                        type="tel"
                        inputMode="numeric"
                        value={editCobradorTelefono}
                        onChange={e => setEditCobradorTelefono(normalizePhone(e.target.value))}
                        placeholder="Teléfono"
                        className={`${inputClass} font-mono`}
                      />
                      <select
                        value={editCobradorZona}
                        onChange={e => setEditCobradorZona(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">Sin zona principal</option>
                        {zonas.map(z => (
                          <option key={z.id} value={z.nombre}>
                            {z.nombre}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={async () => {
                            await onUpdateCobrador(cobrador, {
                              nombre: editCobradorNombre,
                              telefono: editCobradorTelefono || undefined,
                              zona: editCobradorZona || undefined,
                            });
                            setEditCobradorId(null);
                          }}
                          disabled={!editCobradorNombre.trim()}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-semibold transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" /> Guardar
                        </button>
                        <button
                          onClick={() => setEditCobradorId(null)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 text-[11px] transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white">{cobrador.nombre}</p>
                        <p className="text-[11px] text-slate-500 flex items-center gap-1 flex-wrap">
                          <Users className="w-3 h-3" />
                          {enUso} {enUso === 1 ? 'cliente' : 'clientes'}
                          {cobrador.zona && ` · ${cobrador.zona}`}
                          {cobrador.telefono && ` · ${cobrador.telefono}`}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setEditCobradorId(cobrador.id);
                          setEditCobradorNombre(cobrador.nombre);
                          setEditCobradorTelefono(cobrador.telefono || '');
                          setEditCobradorZona(cobrador.zona || '');
                        }}
                        className="p-2 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700 text-slate-300 transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDeleteCobrador(cobrador)}
                        className="p-2 rounded-lg bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/30 text-rose-300 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 flex items-start gap-3">
        <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p>
            <strong className="text-slate-200">Renombrar</strong> propaga el cambio a todos los
            clientes y préstamos asignados.
          </p>
          <p>
            <strong className="text-slate-200">Eliminar</strong> no borra clientes: los deja sin
            zona, sin cobrador o sin rubro asignado. Los cobros ya registrados conservan el
            nombre de quien los cobró.
          </p>
        </div>
      </div>
    </div>
  );
};
