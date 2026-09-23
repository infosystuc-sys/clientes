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
// Recibos: por duplicado. Cada cuota sale dos veces (ORIGINAL y luego
// DUPLICADO), uno debajo del otro, cada uno ocupando el ancho de la hoja.
// ---------------------------------------------------------------------------

const RECIBO_CSS = `
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 8.5pt; }
  /*
   * 4 recibos de 65mm + 3 espacios de 4mm = 272mm, contra ~281mm imprimibles
   * de una A4 (297mm - 2×8mm de margen): mismo colchón de 9mm que ya se usaba
   * con 3 recibos de 88mm, para que el redondeo del motor de impresión no
   * empuje el último recibo a una hoja aparte.
   */
  .recibo {
    position: relative;
    height: 65mm; border: 1.2px solid #000; margin-bottom: 4mm;
    display: flex; flex-direction: column; page-break-inside: avoid;
  }
  .recibo.fin-de-hoja { margin-bottom: 0; page-break-after: always; }
  .recibo:last-of-type { page-break-after: auto; }
  .corte { border-bottom: 1px dashed #888; margin: -2mm 0 2mm; height: 0; }

  .etiqueta {
    position: absolute; top: 1.3mm; right: 1.3mm; z-index: 1;
    font-size: 6.5pt; font-weight: bold; letter-spacing: 0.4px;
    padding: 0.3mm 2mm; border: 1px solid #000; border-radius: 2.5mm; background: #fff;
  }

  .logo .texto { display: none; }
  .cabecera { display: flex; align-items: center; border-bottom: 1.2px solid #000; height: 15mm; }
  .cabecera .logo { width: 40mm; height: 100%; display: flex; align-items: center; justify-content: center; border-right: 1px solid #000; }
  .cabecera .logo img { max-width: 36mm; max-height: 12mm; }
  .cabecera .logo .texto { font-size: 11pt; font-weight: bold; color: #1e3a8a; }
  .cabecera .cliente { flex: 1; padding: 0 3mm; min-width: 0; }
  .cabecera .meta { display: flex; justify-content: space-between; padding-right: 19mm; font-size: 6.3pt; }
  .cabecera .nombre { font-size: 12pt; font-weight: bold; margin-top: 0.8mm; text-transform: uppercase; line-height: 1.15; }
  .datos { padding: 0.8mm 2.5mm; border-bottom: 1.2px solid #000; line-height: 1.3; font-size: 7.5pt; }
  .datos b { display: inline-block; min-width: 17mm; }
  .datos .fila span + span b { min-width: 0; margin-right: 1mm; }
  .datos .fila { display: flex; gap: 4mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 0.5mm 1mm; text-align: left; }
  th { font-size: 6.3pt; background: #f1f1f1; }
  .resumen td { font-size: 7.3pt; }
  .cuota { padding: 0.8mm 2.5mm; border-bottom: 1.2px solid #000; font-size: 7.8pt; }
  .cuota b { font-size: 8.8pt; }
  /* Firma e importes: espacio fijo y compacto, ya no se lleva la mitad del recibo. */
  .manual { height: 16mm; display: flex; }
  .manual div { flex: 1; border-right: 1px solid #000; padding: 0.8mm 2mm; font-weight: bold; font-size: 7.3pt; }
  .manual div:last-child { border-right: 0; }
  @media screen {
    body { background: #e5e7eb; padding: 10mm; }
    .recibo { background: #fff; max-width: 194mm; margin-left: auto; margin-right: auto; }
  }
`;

function reciboHtml(
  r: Rendicion,
  item: RendicionItem,
  logo: string,
  duplicado: boolean,
  finDeHoja: boolean
): string {
  const plan =
    item.cuotas_total && item.valor_cuota
      ? `${item.cuotas_total} cuotas semanales de ${money(item.valor_cuota)}`
      : '—';

  return `
  <section class="recibo${finDeHoja ? ' fin-de-hoja' : ''}">
    <span class="etiqueta">${duplicado ? 'DUPLICADO' : 'ORIGINAL'}</span>
    <div class="cabecera">
      <div class="logo">
        <img src="${esc(logo)}" alt="${esc(EMPRESA.nombre)}"
             onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
        <span class="texto">${esc(EMPRESA.nombre)}</span>
      </div>
      <div class="cliente">
        <div class="meta">
          <span>CLIENTE N° ${esc(clienteCredito(item))}</span>
          <span>PLANILLA ${esc(r.numero)} · RECIBO ${esc(item.numero_recibo)}</span>
        </div>
        <div class="nombre">${esc(item.cliente_nombre)}</div>
      </div>
    </div>

    <div class="datos">
      <div><b>DOMICILIO:</b> ${esc(item.domicilio)}</div>
      <div class="fila">
        <span><b>RUBRO:</b> ${esc(item.rubro || '—')}</span>
        <span><b>TELÉFONO:</b> ${esc(item.telefono)}</span>
      </div>
      <div class="fila">
        <span><b>PLAN:</b> ${esc(plan)}</span>
        <span><b>ZONA:</b> ${esc(item.zona || '—')}</span>
        <span><b>COBRADOR:</b> ${esc(item.cobrador || '—')}</span>
      </div>
    </div>

    <table class="resumen">
      <tr>
        <th>FECHA EMISIÓN</th><th>COMPRA</th><th>PAGADO</th><th>SALDO</th><th>ÚLT. PAGO</th><th>ATRASO</th>
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

    <div class="cuota">
      CUOTA N° <b>${esc(item.cuota_numero ?? '—')}</b> de ${esc(item.cuotas_total ?? '—')}
      &nbsp;·&nbsp; VENCE <b>${esc(formatDate(item.vencimiento))}</b>
      &nbsp;·&nbsp; A COBRAR <b>${esc(money(item.importe))}</b>
    </div>

    <!-- Espacio para completar a mano -->
    <div class="manual">
      <div>FECHA:</div>
      <div>IMPORTE:</div>
      <div>CANCELACIÓN:</div>
    </div>
  </section>`;
}

const RECIBOS_POR_HOJA = 4;

/** HTML de los recibos. Función pura: no toca `window`, se puede probar aparte. */
export function buildRecibosHtml(
  rendicion: Rendicion,
  items: RendicionItem[],
  logo: string,
  autoPrint = true
): string {
  // Cada cuota entra dos veces seguidas: primero el ORIGINAL, después el DUPLICADO.
  const entradas = items.flatMap(item => [
    { item, duplicado: false },
    { item, duplicado: true },
  ]);

  const body = entradas
    .map(({ item, duplicado }, idx) => {
      const finDeHoja = (idx + 1) % RECIBOS_POR_HOJA === 0;
      const html = reciboHtml(rendicion, item, logo, duplicado, finDeHoja);
      const esUltimo = idx === entradas.length - 1;
      // La línea de corte va sólo entre recibos de la misma hoja
      return finDeHoja || esUltimo ? html : `${html}\n  <div class="corte"></div>`;
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
