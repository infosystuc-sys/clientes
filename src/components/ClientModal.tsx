import React, { useState, useEffect } from 'react';
import {
  X,
  UserPlus,
  MapPin,
  Phone,
  Map as MapIcon,
  UserCheck,
  Briefcase,
  AlertCircle,
} from 'lucide-react';
import { Client, ClientInput } from '../types/database';
import { CatalogSelect } from './CatalogSelect';

interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (clientData: ClientInput) => Promise<void>;
  initialClient?: Client | null;
  /** Catálogo de zonas y cobradores dados de alta en Configuración. */
  zonas: string[];
  cobradores: string[];
  rubros: string[];
  /** Alta al vuelo desde el propio formulario; devuelve el nombre creado. */
  onCreateZona: (nombre: string) => Promise<string>;
  onCreateCobrador: (nombre: string) => Promise<string>;
  onCreateRubro: (nombre: string) => Promise<string>;
}

/** Deja sólo dígitos y corta en 10: el teléfono se guarda como 3813045236. */
function normalizePhone(value: string): string {
  return value.replace(/\D/g, '').slice(0, 10);
}

const PHONE_LENGTH = 10;

export const ClientModal: React.FC<ClientModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialClient,
  zonas,
  cobradores,
  rubros,
  onCreateZona,
  onCreateCobrador,
  onCreateRubro,
}) => {
  const [numero, setNumero] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [zona, setZona] = useState('');
  const [cobrador, setCobrador] = useState('');
  const [rubro, setRubro] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (initialClient) {
      setNumero(initialClient.numero ? String(initialClient.numero) : '');
      setName(initialClient.name || '');
      setAddress(initialClient.address || '');
      setPhone(normalizePhone(initialClient.phone || ''));
      setZona(initialClient.zona || '');
      setCobrador(initialClient.cobrador || '');
      setRubro(initialClient.rubro || '');
    } else {
      setNumero('');
      setName('');
      setAddress('');
      setPhone('');
      setZona('');
      setCobrador('');
      setRubro('');
    }
  }, [initialClient, isOpen]);

  if (!isOpen) return null;

  const isPhoneValid = phone.length === PHONE_LENGTH;
  const canSubmit = Boolean(name.trim() && address.trim() && isPhoneValid);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      setError('Completá nombre y apellido, domicilio y un teléfono de 10 dígitos.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSave({
        // Vacío en un alta: la base asigna el siguiente número libre
        ...(numero ? { numero: Number(numero) } : {}),
        name: name.trim(),
        address: address.trim(),
        phone,
        // Los opcionales van como undefined si quedaron vacíos, no como '' .
        zona: zona.trim() || undefined,
        cobrador: cobrador.trim() || undefined,
        rubro: rubro.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar el cliente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-blue-500 transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">
                {initialClient ? 'Editar Cliente' : 'Nuevo Cliente'}
              </h3>
              <p className="text-xs text-slate-400">
                Los campos con <span className="text-rose-400">*</span> son obligatorios
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-950/40 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* N° de cliente y Nombre */}
          <div className="grid grid-cols-[7rem_1fr] gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">N° cliente</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder={initialClient ? '' : 'Auto'}
              value={numero}
              onChange={e => setNumero(e.target.value.replace(/\D/g, '').slice(0, 7))}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono focus:outline-none focus:border-blue-500 transition-colors"
              title="Dejalo vacío para asignar el siguiente número libre. Cargalo a mano para conservar la numeración que ya usabas."
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">
              Nombre y Apellido <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <UserPlus className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                autoFocus
                placeholder="Ej. Carlos Mendoza"
                value={name}
                onChange={e => setName(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          </div>

          {/* Domicilio */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">
              Domicilio Completo <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <MapPin className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <textarea
                required
                rows={2}
                placeholder="Calle, número, piso/depto, barrio y localidad"
                value={address}
                onChange={e => setAddress(e.target.value)}
                className={`${inputClass} resize-none`}
              />
            </div>
          </div>

          {/* Teléfono */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">
              Teléfono <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="tel"
                required
                inputMode="numeric"
                placeholder="3813045236"
                value={phone}
                onChange={e => setPhone(normalizePhone(e.target.value))}
                className={`${inputClass} font-mono tracking-wider ${
                  phone && !isPhoneValid ? 'border-amber-500/60' : ''
                }`}
              />
              <span
                className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono ${
                  isPhoneValid ? 'text-emerald-400' : 'text-slate-500'
                }`}
              >
                {phone.length}/{PHONE_LENGTH}
              </span>
            </div>
            <p className={`text-[11px] ${phone && !isPhoneValid ? 'text-amber-400' : 'text-slate-500'}`}>
              10 dígitos, sin 0 ni 15, sin espacios ni guiones. Ej. 3813045236
            </p>
          </div>

          {/* Zona y Cobrador, contra el catálogo de Configuración */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
            <CatalogSelect
              label="Zona"
              value={zona}
              onChange={setZona}
              options={zonas}
              onCreate={onCreateZona}
              icon={MapIcon}
              emptyLabel="Sin zona asignada"
              createLabel="Nueva zona"
            />

            <CatalogSelect
              label="Cobrador Asignado"
              value={cobrador}
              onChange={setCobrador}
              options={cobradores}
              onCreate={onCreateCobrador}
              icon={UserCheck}
              emptyLabel="Sin cobrador asignado"
              createLabel="Nuevo cobrador"
            />
          </div>

          <CatalogSelect
            label="Rubro"
            value={rubro}
            onChange={setRubro}
            options={rubros}
            onCreate={onCreateRubro}
            icon={Briefcase}
            emptyLabel="Sin rubro asignado"
            createLabel="Nuevo rubro"
          />

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800/60 text-slate-300 text-xs font-semibold hover:bg-slate-700/60 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !canSubmit}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-lg shadow-blue-600/25 transition-all"
            >
              {isSubmitting ? 'Guardando...' : initialClient ? 'Guardar Cambios' : 'Crear Cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
