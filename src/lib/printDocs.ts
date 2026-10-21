import { MovimientoRendicion, Rendicion, RendicionItem } from '../types/database';
import { formatDate } from './loanMath';
import { AjusteImpresion, getAjusteImpresion } from './printConfig';

/** Datos de la empresa que salen en los recibos. */
export const EMPRESA = {
  nombre: 'Nova Cred',
  // Servido desde /public. Para cambiar el logo, reemplazá public/logo.png.
  logo: 'logo.png',
};

/** Escapa texto de usuario antes de meterlo en el HTML impreso. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const numero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const n = (value: number | string | null | undefined) =>
  value === null || value === undefined || value === '' ? '—' : numero.format(Number(value));
const money = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '—' : `$ ${n(value)}`;

/** "1202/0": N° de cliente y N° de crédito, como en la planilla en papel. */
export function clienteCredito(item: Pick<RendicionItem, 'cliente_numero' | 'credito_numero'>) {
  return `${item.cliente_numero ?? '—'}/${item.credito_numero ?? 0}`;
}

function logoUrl(): string {
  return new URL(EMPRESA.logo, window.location.origin + import.meta.env.BASE_URL).href;
}

function descripcionPlanilla(r: Rendicion): string {
  const partes = [
    r.zona ? `Zona ${r.zona}` : 'Todas las zonas',
    r.cobrador ? `Cobrador ${r.cobrador}` : 'Todos los cobradores',
    `del ${formatDate(r.desde)} al ${formatDate(r.hasta)}`,
  ];
  if (r.incluye_vencidas) partes.push('incluye atrasadas');
  return partes.join(' · ');
}

/** Documento HTML completo, con su CSS de impresión y el disparo del diálogo. */
function buildDocument(title: string, bodyHtml: string, css: string, autoPrint: boolean): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>
${bodyHtml}
${
  autoPrint
    ? `<script>
  window.addEventListener('load', function () {
    window.focus();
    window.print();
  });
</script>`
    : ''
}
</body>
</html>`;
}

/**
 * Abre una ventana con el documento; el diálogo de impresión se dispara cuando
 * cargaron las imágenes (el logo). Si el navegador bloquea la ventana, se avisa.
 */
function openPrintWindow(html: string): void {
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error(
      'El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes para este sitio y volvé a intentar.'
    );
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ---------------------------------------------------------------------------
// Recibos: por duplicado. Cada cuota sale dos veces (ORIGINAL y DUPLICADO)
// lado a lado, en A4 apaisada: 3 filas por hoja (6 recibos por hoja).
// ---------------------------------------------------------------------------

/**
 * Las medidas NO van fijas en mm: cada navegador e impresora termina usando
 * márgenes distintos (los de la hoja, los que elige el usuario en el diálogo,
 * los encabezados y pies que agrega el navegador...) y un recibo con medidas
 * fijas se cortaba cuando el área imprimible real era más chica. Por eso la
 * hoja ocupa el 100% del área imprimible que quede (100vh en impresión es el
 * alto de esa área) y cada fila mide un tercio.
 *
 * Encima de eso va el ajuste de la impresora de cada computadora (margen,
 * desplazamiento y escala), que se calibra desde Configuración con una hoja de
 * prueba: hay impresoras que además corren la hoja y cortan un borde.
 */
const FILAS_POR_HOJA = 3;
const SEPARACION_MM = 4;

/** Alto de una fila: un tercio del área imprimible, por la escala. */
const altoFila = (a: AjusteImpresion) =>
  `calc((100vh - 2mm) / ${FILAS_POR_HOJA} * ${a.escala / 100})`;

const reciboCss = (a: AjusteImpresion) => `
  @page { size: A4 landscape; margin: ${a.margenMm}mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: 100%; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; }

  .hoja {
    position: relative; left: ${a.desplazarXMm}mm; top: ${a.desplazarYMm}mm;
    width: ${a.escala}%; break-after: page; page-break-after: always;
  }
  .hoja:last-of-type { break-after: auto; page-break-after: auto; }
  .fila {
    position: relative;
    display: grid; grid-template-columns: 1fr 1fr; column-gap: ${SEPARACION_MM}mm;
    /* 2mm de colchón para que el redondeo no empuje la última fila a otra hoja */
    height: ${altoFila(a)};
    overflow: hidden;
  }
  /* Guía de corte vertical, centrada en el espacio entre columnas */
  .fila::before {
    content: ''; position: absolute; top: 0; bottom: 0; left: 50%;
    border-left: 1px dashed #999;
  }

  .recibo {
    position: relative; border: 1px solid #000; overflow: hidden;
    display: flex; flex-direction: column; 
    /* Toda la letra y los espacios del recibo van en em: escalan con el alto de
       la fila (8,5pt en una fila de 57mm), así entra en cualquier área imprimible. */
    font-size: calc(${altoFila(a)} * 0.0526);
  }
  .etiqueta {
    position: absolute; top: 0.333em; right: 0.333em; z-index: 1;
    font-size: 0.847em; font-weight: bold; letter-spacing: 0.3px;
    padding: 0.067em 0.5em; border: 1px solid #000; border-radius: 0.667em; background: #fff;
  }

  .cabecera { display: flex; justify-content: space-between; align-items: flex-start; padding: 0.4em 0.667em 0.333em; border-bottom: 1px solid #000; }
  .cabecera .empresa { display: flex; align-items: center; gap: 0.434em; min-width: 0; }
  .cabecera .empresa img { max-width: 8.003em; max-height: 3.001em; }
  .cabecera .empresa .texto { display: none; font-size: 1.165em; font-weight: bold; color: #1e3a8a; }
  .cabecera .info-der { text-align: right; padding-right: 7.336em; line-height: 1.35; white-space: nowrap; }
  .cabecera .vence { font-size: 1.118em; font-weight: bold; }
  .cabecera .zona, .cabecera .tel { font-size: 0.906em; color: #222; }

  /* El nombre siempre en una sola línea (con puntos suspensivos si es muy largo):
     dejarlo wrapear a 2 líneas empuja el resto del recibo y desborda la altura fija. */
  .cliente-row { display: flex; align-items: baseline; gap: 0.667em; padding: 0.267em 0.667em; border-bottom: 1px solid #000; }
  .cliente-row .num { font-size: 0.906em; color: #333; white-space: nowrap; flex-shrink: 0; }
  .cliente-row .nombre {
    font-size: 1.318em; font-weight: bold; text-transform: uppercase; line-height: 1.1;
    flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .direccion { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 0.2em 0.667em; border-bottom: 1px solid #000; line-height: 1.4; }
  .direccion b { font-weight: bold; }

  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 0.2em 0.333em; text-align: left; }
  th { font-size: 0.824em; background: #f1f1f1; font-weight: 600; }
  td { font-size: 0.918em; }

  .plan-row { flex: 1; display: flex; justify-content: space-between; align-items: center; gap: 0.667em; padding: 0.2em 0.667em; border-bottom: 1px solid #000; line-height: 1.45; }
  .plan-row .der { text-align: right; white-space: nowrap; }

  /* Firma e importe: espacio fijo para completar a mano. */
  .manual { flex: 0 0 2.668em; display: flex; }
  .manual div { flex: 1; border-right: 1px solid #000; padding: 0.333em 0.5em; font-weight: bold; font-size: 0.918em; display: flex; align-items: center; }
  .manual div:last-child { border-right: 0; }

  @media screen {
    body { background: #e5e7eb; padding: 10mm; }
    .hoja { background: #fff; margin: 0 auto 10mm; max-width: 261mm; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
    .fila { height: 57mm; }
    .recibo { font-size: 8.5pt; }
  }
`;

function reciboHtml(r: Rendicion, item: RendicionItem, logo: string, duplicado: boolean): string {
  const credito =
    !item.credito_numero || item.credito_numero === 0
      ? 'Plan original'
      : `Renovación N° ${item.credito_numero}`;

  // Recibo ya rendido: pasa a ser el comprobante de lo que se cobró
  const rendido = item.monto_cobrado !== null && item.monto_cobrado !== undefined;
  const cobrado = Number(item.monto_cobrado) || 0;
  const imputaciones = item.imputaciones || [];
  const fechaCobro = imputaciones[0]?.fecha || r.fecha_rendicion;
  // Fecha de cancelación: vence la última cuota del préstamo
  const cancelacion = item.vencimiento_final || item.vencimiento;

  const titulo = !rendido
    ? `VENCE ${esc(formatDate(item.vencimiento))}`
    : cobrado > 0
      ? `COBRADO ${esc(formatDate(fechaCobro))}`
      : 'NO COBRADO';

  const planRow = !rendido
    ? `
          <div>
            Plan: <b>${esc(item.cuotas_total ?? '—')} semanas: ${esc(money(item.valor_cuota))}</b><br>
            A cobrar: <b>${esc(money(item.importe))}</b>
          </div>
          <div class="der">
            ${esc(credito)}<br>
            Cancelación: <b>${esc(formatDate(cancelacion))}</b>
          </div>`
    : `
          <div>
            Cobrado: <b>${esc(money(cobrado))}</b><br>
            Cancelación: <b>${esc(formatDate(cancelacion))}</b>
          </div>
          <div class="der">
            ${esc(credito)}<br>
            Plan: <b>${esc(item.cuotas_total ?? '—')} x ${esc(money(item.valor_cuota))}</b>
          </div>`;

  const pie = !rendido
    ? `
          <div>FECHA: ___/___/___</div>
          <div>IMPORTE: $__________</div>`
    : `
          <div>FECHA: ___/___/___</div>
          <div>SALDO PENDIENTE: $__________</div>`;

  return `
      <section class="recibo">
        <span class="etiqueta">${duplicado ? 'DUPLICADO' : 'ORIGINAL'}</span>
        <div class="cabecera">
          <div class="empresa">
            <img src="${esc(logo)}" alt="${esc(EMPRESA.nombre)}"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
            <span class="texto">${esc(EMPRESA.nombre)}</span>
          </div>
          <div class="info-der">
            <div class="vence">${titulo}</div>
            <div class="zona">${esc(item.zona || 'Sin zona')}</div>
            <div class="tel">Tel: ${esc(item.telefono || '—')}</div>
          </div>
        </div>

        <div class="cliente-row">
          <span class="num">Cliente: ${esc(clienteCredito(item))}</span>
          <span class="nombre">${esc(item.cliente_nombre)}</span>
        </div>

        <div class="direccion">
          <div><b>Direc. comercial:</b> ${esc(item.domicilio)}</div>
          <div><b>Producto:</b> ${esc(item.rubro || '—')}</div>
        </div>

        <table>
          <tr>
            <th>Fecha</th><th>Compra</th><th>${rendido ? 'Cobrado' : 'Pagado'}</th><th>${rendido ? 'Saldo pend.' : 'Saldo'}</th><th>Últ. pago</th><th>Atraso</th>
          </tr>
          <tr>
            <td>${esc(formatDate(item.fecha_otorgamiento))}</td>
            <td>${esc(money(item.prestamo_total))}</td>
            <td>${esc(money(item.prestamo_pagado))}</td>
            <td>${esc(money(item.prestamo_saldo))}</td>
            <td>${esc(formatDate(item.ultimo_pago))}</td>
            <td>${esc(Number(item.atraso) > 0 ? money(item.atraso) : '—')}</td>
          </tr>
        </table>

        <div class="plan-row">${planRow}
        </div>

        <!-- Espacio para completar a mano -->
        <div class="manual">${pie}
        </div>
      </section>`;
}

/** Una fila = un recibo por duplicado: ORIGINAL a la izquierda, DUPLICADO a la derecha. */
function filaHtml(r: Rendicion, item: RendicionItem, logo: string): string {
  return `
    <div class="fila">${reciboHtml(r, item, logo, false)}
${reciboHtml(r, item, logo, true)}
    </div>`;
}

/** HTML de los recibos. Función pura: no toca `window`, se puede probar aparte. */
export function buildRecibosHtml(
  rendicion: Rendicion,
  items: RendicionItem[],
  logo: string,
  autoPrint = true,
  ajuste: AjusteImpresion = getAjusteImpresion()
): string {
  const hojas: string[] = [];
  for (let i = 0; i < items.length; i += FILAS_POR_HOJA) {
    const filas = items.slice(i, i + FILAS_POR_HOJA).map(item => filaHtml(rendicion, item, logo));
    hojas.push(`  <div class="hoja">${filas.join('')}\n  </div>`);
  }
  const body = hojas.join('\n');
  return buildDocument(
    `Recibos - Planilla ${rendicion.numero}`,
    body,
    reciboCss(ajuste),
    autoPrint
  );
}

export function printRecibos(rendicion: Rendicion, items: RendicionItem[]): void {
  openPrintWindow(buildRecibosHtml(rendicion, items, logoUrl()));
}

/**
 * Hoja de prueba para calibrar la impresora: el marco ocupa exactamente lo que
 * ocuparían los recibos, y en cada borde hay una regla con marcas cada 3mm hacia
 * adentro. El número más chico que se ve impreso en un borde es cuántos mm se
 * cortaron de ese lado.
 */
export function buildPruebaHtml(ajuste: AjusteImpresion, autoPrint = true): string {
  const marcas = [0, 3, 6, 9, 12, 15];
  const regla = (lado: 'izq' | 'der' | 'arr' | 'aba') =>
    marcas
      .map(mm => `<div class="marca ${lado}" style="--d:${mm}mm"><span>${mm}</span></div>`)
      .join('');
  const css =
    reciboCss(ajuste) +
    `
  .marco { position: relative; height: calc(${altoFila(ajuste)} * ${FILAS_POR_HOJA}); border: 1px solid #000; overflow: hidden; }
  .marca { position: absolute; font-size: 8pt; }
  .marca.izq, .marca.der { top: 0; bottom: 0; border-left: 1px solid #000; }
  .marca.izq { left: var(--d); }
  .marca.der { right: var(--d); }
  .marca.arr, .marca.aba { left: 0; right: 0; border-top: 1px solid #000; }
  .marca.arr { top: var(--d); }
  .marca.aba { bottom: var(--d); }
  .marca.izq span { position: absolute; top: 30%; left: 0.4mm; }
  .marca.der span { position: absolute; top: 30%; right: 0.4mm; }
  .marca.arr span { position: absolute; left: 30%; top: 0.2mm; }
  .marca.aba span { position: absolute; left: 30%; bottom: 0.2mm; }
  .texto-prueba { position: absolute; inset: 22mm 22mm; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center; font-size: 11pt; line-height: 1.5; }
  .texto-prueba h2 { margin: 0 0 3mm; font-size: 16pt; }
`;
  const body = `
  <div class="hoja">
    <div class="marco">
      ${regla('izq')}${regla('der')}${regla('arr')}${regla('aba')}
      <div class="texto-prueba">
        <h2>Hoja de prueba de impresión</h2>
        <div>Este marco ocupa lo mismo que los recibos. En cada borde hay marcas cada 3 mm.</div>
        <div>Si de un lado se ve completo el <b>0</b>, ese borde no se corta.</div>
        <div>Si el primer número que se ve es, por ejemplo, <b>6</b>, ese borde se cortó 6 mm:</div>
        <div>corré los recibos 6 mm hacia el lado contrario, o subí el margen, y volvé a probar.</div>
        <div style="margin-top:3mm;font-size:9pt">Margen ${ajuste.margenMm} mm · Horizontal ${ajuste.desplazarXMm} mm · Vertical ${ajuste.desplazarYMm} mm · Escala ${ajuste.escala}%</div>
      </div>
    </div>
  </div>`;
  return buildDocument('Prueba de impresión', body, css, autoPrint);
}

export function printPrueba(ajuste: AjusteImpresion): void {
  openPrintWindow(buildPruebaHtml(ajuste));
}

// ---------------------------------------------------------------------------
// Planilla de rendición: hoja apaisada con la lista de recibos
// ---------------------------------------------------------------------------

const PLANILLA_CSS = `
  @page { size: A4 landscape; margin: 9mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 9pt; }
  header { display: flex; align-items: center; gap: 6mm; margin-bottom: 3mm; }
  header img { max-height: 16mm; }
  header h1 { font-size: 15pt; margin: 0; }
  header p { margin: 1mm 0 0; font-size: 9pt; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 1.2mm 1.5mm; text-align: left; vertical-align: top; }
  th { background: #e5e5e5; font-size: 8pt; text-transform: uppercase; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .num { text-align: right; white-space: nowrap; }
  .cobrado { width: 26mm; }
  tfoot td { font-weight: bold; background: #f3f3f3; }
  .resumen { display: flex; gap: 6mm; margin-top: 5mm; align-items: flex-start; page-break-inside: avoid; }
  .resumen .movs { flex: 2; }
  .resumen .totales { flex: 1; }
  .totales td { font-size: 9pt; }
  .totales .resultado td { font-weight: bold; font-size: 10.5pt; background: #f3f3f3; }
  .firmas { display: flex; gap: 20mm; margin-top: 16mm; }
  .firmas div { flex: 1; border-top: 1px solid #000; padding-top: 1.5mm; text-align: center; font-size: 8.5pt; }
  @media screen { body { background: #e5e7eb; padding: 10mm; } main { background: #fff; padding: 8mm; } }
`;

/** HTML de la planilla de rendición. Función pura, igual que los recibos. */
export function buildPlanillaHtml(
  rendicion: Rendicion,
  items: RendicionItem[],
  logo: string,
  autoPrint = true,
  movimientos: MovimientoRendicion[] = []
): string {
  const rendida = rendicion.estado === 'rendida';
  const ingresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.importe), 0);
  const egresos = movimientos.filter(m => m.tipo === 'egreso').reduce((a, m) => a + Number(m.importe), 0);
  const cobrados = items.filter(i => Number(i.monto_cobrado) > 0).length;
  const totalCuotas = items.reduce((a, i) => a + Number(i.importe), 0);
  const totalCobrado = items.reduce((a, i) => a + Number(i.monto_cobrado || 0), 0);

  const filas = items
    .map(
      i => `
      <tr>
        <td>${esc(i.numero_recibo)}</td>
        <td>${esc(clienteCredito(i))}</td>
        <td class="num">${esc(n(i.importe))}</td>
        <td>${esc(i.cliente_nombre)}</td>
        <td>${esc(i.domicilio)}</td>
        <td>${esc(i.zona || '')}</td>
        <td>${esc(i.rubro || '')}</td>
        <td>${esc(i.cuota_numero ?? '')}/${esc(i.cuotas_total ?? '')} · ${esc(formatDate(i.vencimiento))}</td>
        <td class="num">${esc(n(i.prestamo_total))}</td>
        <td class="num">${esc(n(i.prestamo_pagado))}</td>
        <td class="num">${esc(n(i.prestamo_saldo))}</td>
        <td class="num cobrado">${rendida ? esc(n(i.monto_cobrado ?? 0)) : ''}</td>
      </tr>`
    )
    .join('');

  const body = `
  <main>
    <header>
      <img src="${esc(logo)}" alt="${esc(EMPRESA.nombre)}" onerror="this.remove()">
      <div>
        <h1>PLANILLA DE COBRANZA N° ${esc(rendicion.numero)}${rendida ? ' — RENDIDA' : ''}</h1>
        <p>${esc(descripcionPlanilla(rendicion))}</p>
        <p>Emitida el ${esc(
          new Date(rendicion.fecha_emision).toLocaleDateString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })
        )}${
          rendida ? ` · Rendida el ${esc(formatDate(rendicion.fecha_rendicion))}` : ''
        }</p>
      </div>
    </header>

    <table>
      <thead>
        <tr>
          <th>Rec.</th><th>N° Cliente</th><th class="num">Cuota</th><th>N. y Apellido</th>
          <th>Dirección</th><th>Zona</th><th>Rubro</th><th>Cuota N° · Vence</th>
          <th class="num">Monto</th><th class="num">Pagado</th><th class="num">Saldo</th>
          <th class="cobrado">Cobrado</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
      <tfoot>
        <tr>
          <td colspan="2">TOTAL</td>
          <td class="num">${esc(n(totalCuotas))}</td>
          <td colspan="8">RECIBOS ${esc(items.length)}</td>
          <td class="num">${rendida ? esc(n(totalCobrado)) : ''}</td>
        </tr>
      </tfoot>
    </table>

    ${
      rendida || movimientos.length
        ? `
    <div class="resumen">
      <table class="movs">
        <thead>
          <tr><th>Concepto</th><th>Detalle</th><th class="num">Ingresos</th><th class="num">Egresos</th></tr>
        </thead>
        <tbody>${
          movimientos.length
            ? movimientos
                .map(
                  m => `
          <tr>
            <td>${esc(m.concepto)}</td>
            <td>${esc(m.detalle || '')}</td>
            <td class="num">${m.tipo === 'ingreso' ? esc(n(m.importe)) : ''}</td>
            <td class="num">${m.tipo === 'egreso' ? esc(n(m.importe)) : ''}</td>
          </tr>`
                )
                .join('')
            : '<tr><td colspan="4">Sin ingresos ni egresos</td></tr>'
        }</tbody>
        <tfoot>
          <tr><td colspan="2">TOTAL</td><td class="num">${esc(n(ingresos))}</td><td class="num">${esc(n(egresos))}</td></tr>
        </tfoot>
      </table>
      <table class="totales">
        <tr><td>Recibos a cobrar (${esc(items.length)})</td><td class="num">${esc(money(totalCuotas))}</td></tr>
        <tr><td>Recibos cobrados (${esc(cobrados)})</td><td class="num">${esc(money(totalCobrado))}</td></tr>
        <tr><td>+ Ingresos</td><td class="num">${esc(money(ingresos))}</td></tr>
        <tr><td>− Egresos</td><td class="num">${esc(money(egresos))}</td></tr>
        <tr class="resultado"><td>RESULTADO</td><td class="num">${esc(money(totalCobrado + ingresos - egresos))}</td></tr>
      </table>
    </div>`
        : ''
    }

    <div class="firmas">
      <div>Firma del cobrador</div>
      <div>Recibió (administración)</div>
    </div>
  </main>`;

  return buildDocument(`Planilla ${rendicion.numero}`, body, PLANILLA_CSS, autoPrint);
}

export function printPlanilla(
  rendicion: Rendicion,
  items: RendicionItem[],
  movimientos: MovimientoRendicion[] = []
): void {
  openPrintWindow(buildPlanillaHtml(rendicion, items, logoUrl(), true, movimientos));
}
