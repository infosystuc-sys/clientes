import React, { useState } from 'react';
import { Printer, RotateCcw } from 'lucide-react';
import {
  AJUSTE_POR_DEFECTO,
  AjusteImpresion,
  getAjusteImpresion,
  normalizarAjuste,
  setAjusteImpresion,
} from '../lib/printConfig';
import { printPrueba } from '../lib/printDocs';

interface ImpresionPanelProps {
  onError: (message: string) => void;
}

const CAMPOS: { key: keyof AjusteImpresion; label: string; ayuda: string; unidad: string; paso: number }[] = [
  { key: 'margenMm', label: 'Margen', ayuda: 'Por lado, en toda la hoja', unidad: 'mm', paso: 1 },
  { key: 'desplazarXMm', label: 'Horizontal', ayuda: '+ derecha · − izquierda', unidad: 'mm', paso: 1 },
  { key: 'desplazarYMm', label: 'Vertical', ayuda: '+ abajo · − arriba', unidad: 'mm', paso: 1 },
  { key: 'escala', label: 'Tamaño', ayuda: 'De los recibos', unidad: '%', paso: 1 },
];

/**
 * Calibración de la impresora de esta computadora para los recibos. Se guarda
 * en el navegador: cada equipo puede tener una impresora distinta.
 */
export const ImpresionPanel: React.FC<ImpresionPanelProps> = ({ onError }) => {
  const [ajuste, setAjuste] = useState<AjusteImpresion>(getAjusteImpresion);

  const cambiar = (key: keyof AjusteImpresion, valor: string) => {
    const siguiente = normalizarAjuste({ ...ajuste, [key]: valor === '' ? 0 : Number(valor) });
    setAjuste(siguiente);
    setAjusteImpresion(siguiente);
  };

  const restablecer = () => {
    setAjuste({ ...AJUSTE_POR_DEFECTO });
    setAjusteImpresion({ ...AJUSTE_POR_DEFECTO });
  };

  const probar = () => {
    try {
      printPrueba(ajuste);
    } catch (err: any) {
      onError(err?.message || 'No se pudo abrir la hoja de prueba.');
    }
  };

  return (
    <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/40 flex items-center gap-2">
        <div className="p-2 rounded-xl border bg-sky-600/20 border-sky-500/30 text-sky-400">
          <Printer className="w-4 h-4" />
        </div>
        <div>
          <h3 className="font-bold text-sm text-white">Impresión de recibos</h3>
          <p className="text-[11px] text-slate-400">Ajuste para la impresora de esta computadora</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CAMPOS.map(c => (
            <label key={c.key} className="space-y-1 block">
              <span className="text-xs font-semibold text-slate-300">{c.label}</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step={c.paso}
                  value={ajuste[c.key]}
                  onChange={e => cambiar(c.key, e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                />
                <span className="text-[11px] text-slate-500">{c.unidad}</span>
              </div>
              <span className="text-[10px] text-slate-500">{c.ayuda}</span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={probar}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors"
          >
            <Printer className="w-3.5 h-3.5" /> Imprimir hoja de prueba
          </button>
          <button
            onClick={restablecer}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Restablecer
          </button>
        </div>

        <ol className="text-[11px] text-slate-400 space-y-1 list-decimal list-inside">
          <li>
            Imprimí la hoja de prueba con escala <b className="text-slate-200">Tamaño real (100%)</b>,
            márgenes <b className="text-slate-200">Predeterminados</b> y sin encabezados ni pies.
          </li>
          <li>
            En cada borde hay marcas cada 3 mm. El primer número que se ve impreso es cuánto se
            cortó de ese lado.
          </li>
          <li>
            Si se cortó la izquierda, poné <b className="text-slate-200">Horizontal</b> en positivo;
            si se cortó abajo, <b className="text-slate-200">Vertical</b> en negativo. Si se cortan
            dos lados opuestos, subí el <b className="text-slate-200">Margen</b> o bajá el
            <b className="text-slate-200"> Tamaño</b>.
          </li>
          <li>Repetí hasta que el 0 se vea en los cuatro bordes. Se guarda solo.</li>
        </ol>
      </div>
    </div>
  );
};
