/**
 * Ajuste de impresión de los recibos para la impresora de esta computadora.
 *
 * Cada impresora tiene su propia zona sin imprimir y algunas además corren la
 * hoja unos milímetros. Como eso depende del equipo y no del negocio, se guarda
 * en el navegador (localStorage) y no en la base.
 */
export interface AjusteImpresion {
  /** Margen que se le pide al navegador, en mm por lado. */
  margenMm: number;
  /** Corre los recibos a la derecha (positivo) o a la izquierda (negativo), en mm. */
  desplazarXMm: number;
  /** Corre los recibos hacia abajo (positivo) o hacia arriba (negativo), en mm. */
  desplazarYMm: number;
  /** Tamaño de los recibos respecto del área imprimible, en %. */
  escala: number;
}

export const AJUSTE_POR_DEFECTO: AjusteImpresion = {
  margenMm: 18,
  desplazarXMm: 0,
  desplazarYMm: 0,
  escala: 100,
};

const KEY = 'novacred_ajuste_impresion';

const limitar = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Normaliza valores fuera de rango (o basura en localStorage). */
export function normalizarAjuste(a: Partial<AjusteImpresion>): AjusteImpresion {
  return {
    margenMm: limitar(a.margenMm, 0, 40, AJUSTE_POR_DEFECTO.margenMm),
    desplazarXMm: limitar(a.desplazarXMm, -30, 30, 0),
    desplazarYMm: limitar(a.desplazarYMm, -30, 30, 0),
    escala: limitar(a.escala, 50, 120, 100),
  };
}

export function getAjusteImpresion(): AjusteImpresion {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizarAjuste(JSON.parse(raw)) : { ...AJUSTE_POR_DEFECTO };
  } catch {
    return { ...AJUSTE_POR_DEFECTO };
  }
}

export function setAjusteImpresion(ajuste: AjusteImpresion): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizarAjuste(ajuste)));
  } catch {
    /* sin localStorage (modo privado): se usa el ajuste por defecto */
  }
}
