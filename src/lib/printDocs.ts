import { Rendicion, RendicionItem } from '../types/database';
import { formatDate } from './loanMath';

/** Datos de la empresa que salen en los recibos. */
export const EMPRESA = {
  nombre: 'D&B Soluciones',
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
// lado a lado; se completa la hoja con tantas filas como entren.
// ---------------------------------------------------------------------------

/**
 * Filas por hoja y su alto. 5 filas de 52mm + 4 espacios de 3mm = 272mm,
 * contra ~281mm imprimibles de una A4 (297mm - 2×8mm de margen): colchón de
 * 9mm para que el redondeo del motor de impresión no empuje la última fila a
 * una hoja aparte (el mismo margen que ya funcionó en los diseños previos).
 */
const FILAS_POR_HOJA = 5;
const ALTO_FILA_MM = 52;
const GAP_FILA_MM = 3;

const RECIBO_CSS = `
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }

  .fila {
    position: relative;
    display: grid; grid-template-columns: 1fr 1fr; column-gap: 3mm;
    height: ${ALTO_FILA_MM}mm; margin-bottom: ${GAP_FILA_MM}mm;
    page-break-inside: avoid;
  }
  .fila.fin-de-hoja { margin-bottom: 0; page-break-after: always; }
  .fila:last-of-type { page-break-after: auto; }
  /* Guía de corte vertical, centrada en el espacio entre columnas */
  .fila::before {
    content: ''; position: absolute; top: 0; bottom: 0; left: 50%;
    border-left: 1px dashed #999;
  }
  /* Guía de corte horizontal entre filas de la misma hoja */
  .corte-h { border-bottom: 1px dashed #999; margin: -1.5mm 0 1.5mm; height: 0; }

  .recibo {
    position: relative; border: 1px solid #000; overflow: hidden;
    display: flex; flex-direction: column; font-size: 6.8pt;
  }
  .etiqueta {
    position: absolute; top: 1mm; right: 1mm; z-index: 1;
    font-size: 5.8pt; font-weight: bold; letter-spacing: 0.3px;
    padding: 0.2mm 1.5mm; border: 1px solid #000; border-radius: 2mm; background: #fff;
  }

  .cabecera { display: flex; justify-content: space-between; align-items: flex-start; padding: 1.2mm 2mm 1mm; border-bottom: 1px solid #000; }
  .cabecera .empresa { display: flex; align-items: center; gap: 1.3mm; min-width: 0; }
  .cabecera .empresa img { max-width: 20mm; max-height: 7mm; }
  .cabecera .empresa .texto { display: none; font-size: 8pt; font-weight: bold; color: #1e3a8a; }
  .cabecera .info-der { text-align: right; padding-right: 17mm; line-height: 1.35; white-space: nowrap; }
  .cabecera .vence { font-size: 7.6pt; font-weight: bold; }
  .cabecera .zona, .cabecera .tel { font-size: 6.2pt; color: #222; }

  /* El nombre siempre en una sola línea (con puntos suspensivos si es muy largo):
     dejarlo wrapear a 2 líneas empuja el resto del recibo y desborda la altura fija. */
  .cliente-row { display: flex; align-items: baseline; gap: 2mm; padding: 0.8mm 2mm; border-bottom: 1px solid #000; }
  .cliente-row .num { font-size: 6.2pt; color: #333; white-space: nowrap; flex-shrink: 0; }
  .cliente-row .nombre {
    font-size: 9pt; font-weight: bold; text-transform: uppercase; line-height: 1.1;
    flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .direccion { padding: 0.8mm 2mm; border-bottom: 1px solid #000; line-height: 1.35; }
  .direccion b { font-weight: bold; }

  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 0.4mm 0.8mm; text-align: left; }
  th { font-size: 5.6pt; background: #f1f1f1; font-weight: 600; }
  td { font-size: 6.3pt; }

  .plan-row { display: flex; justify-content: space-between; gap: 2mm; padding: 0.8mm 2mm; border-bottom: 1px solid #000; line-height: 1.4; }
  .plan-row .der { text-align: right; white-space: nowrap; }

  /* Firma e importe: espacio fijo para completar a mano. */
  .manual { flex: 1; display: flex; }
  .manual div { flex: 1; border-right: 1px solid #000; padding: 1mm 1.5mm; font-weight: bold; font-size: 6.3pt; display: flex; align-items: center; }
  .manual div:last-child { border-right: 0; }

  @media screen {
    body { background: #e5e7eb; padding: 10mm; }
    .fila { max-width: 194mm; margin-left: auto; margin-right: auto; }
    .recibo { background: #fff; }
  }
`;

function reciboHtml(r: Rendicion, item: RendicionItem, logo: string, duplicado: boolean): string {
  const credito =
    !item.credito_numero || item.credito_numero === 0
      ? 'Plan original'
      : `Renovación N° ${item.credito_numero}`;

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
            <div class="vence">VENCE ${esc(formatDate(item.vencimiento))}</div>
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
            <th>Fecha</th><th>Compra</th><th>Pagado</th><th>Saldo</th><th>Últ. pago</th><th>Atraso</th>
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

        <div class="plan-row">
          <div>
            Plan: <b>${esc(item.cuotas_total ?? '—')} semanas: ${esc(money(item.valor_cuota))}</b><br>
            A cobrar: <b>${esc(money(item.importe))}</b>
          </div>
          <div class="der">
            ${esc(credito)}<br>
            Cancelación: <b>${esc(formatDate(item.vencimiento))}</b>
          </div>
        </div>

        <!-- Espacio para completar a mano -->
        <div class="manual">
          <div>FECHA: ___/___/___</div>
          <div>IMPORTE: $__________</div>
        </div>
      </section>`;
}

/** Una fila = un recibo por duplicado: ORIGINAL a la izquierda, DUPLICADO a la derecha. */
function filaHtml(r: Rendicion, item: RendicionItem, logo: string, finDeHoja: boolean): string {
  return `
  <div class="fila${finDeHoja ? ' fin-de-hoja' : ''}">${reciboHtml(r, item, logo, false)}
${reciboHtml(r, item, logo, true)}
  </div>`;
}

/** HTML de los recibos. Función pura: no toca `window`, se puede probar aparte. */
export function buildRecibosHtml(
  rendicion: Rendicion,
  items: RendicionItem[],
  logo: string,
  autoPrint = true
): string {
  const body = items
    .map((item, idx) => {
      const finDeHoja = (idx + 1) % FILAS_POR_HOJA === 0;
      const html = filaHtml(rendicion, item, logo, finDeHoja);
      const esUltimo = idx === items.length - 1;
      // La línea de corte horizontal va sólo entre filas de la misma hoja
      return finDeHoja || esUltimo ? html : `${html}\n  <div class="corte-h"></div>`;
    })
    .join('\n');
  return buildDocument(`Recibos - Planilla ${rendicion.numero}`, body, RECIBO_CSS, autoPrint);
}

export function printRecibos(rendicion: Rendicion, items: RendicionItem[]): void {
  openPrintWindow(buildRecibosHtml(rendicion, items, logoUrl()));
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
  .firmas { display: flex; gap: 20mm; margin-top: 16mm; }
  .firmas div { flex: 1; border-top: 1px solid #000; padding-top: 1.5mm; text-align: center; font-size: 8.5pt; }
  @media screen { body { background: #e5e7eb; padding: 10mm; } main { background: #fff; padding: 8mm; } }
`;

/** HTML de la planilla de rendición. Función pura, igual que los recibos. */
export function buildPlanillaHtml(
  rendicion: Rendicion,
  items: RendicionItem[],
  logo: string,
  autoPrint = true
): string {
  const rendida = rendicion.estado === 'rendida';
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

    <div class="firmas">
      <div>Firma del cobrador</div>
      <div>Recibió (administración)</div>
    </div>
  </main>`;

  return buildDocument(`Planilla ${rendicion.numero}`, body, PLANILLA_CSS, autoPrint);
}

export function printPlanilla(rendicion: Rendicion, items: RendicionItem[]): void {
  openPrintWindow(buildPlanillaHtml(rendicion, items, logoUrl()));
}
