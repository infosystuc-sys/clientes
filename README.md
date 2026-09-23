# ClienteFlow — Préstamos y Cobranza

Sistema de otorgamiento de préstamos con **cuotas semanales** y gestión de cobranza
**por zona y por cobrador**. Frontend en React 19 + Vite + Tailwind 4, backend en
Supabase (PostgreSQL).

## Cómo funciona

0. **Configuración** — ABM de **zonas**, **rubros** y **cobradores**. Es el catálogo del
   que comen los demás formularios: no se tipea a mano, se elige. Renombrar acá actualiza
   solo a todos los clientes y préstamos asignados (`ON UPDATE CASCADE` en la base);
   eliminar deja los registros sin asignar, no los borra.
1. **Clientes** — alta con N° de cliente (opcional: si se deja vacío se asigna el siguiente;
   se puede cargar a mano para conservar la numeración en papel), nombre y apellido,
   domicilio y teléfono (obligatorios), más
   zona, cobrador y rubro elegidos del catálogo. Los tres selects tienen un **+** que da de
   alta el ítem sin salir del formulario. El **rubro también se edita desde la ficha del
   cliente**, y se guarda al elegirlo.
2. **Préstamos** — se carga la fecha de otorgamiento, el capital entregado y el recargo (o
   el total a devolver directamente) y la cantidad de cuotas semanales. Al guardar, **la base genera sola el
   plan de cuotas**, una cada 7 días a partir de la fecha elegida. La última cuota absorbe
   la diferencia de redondeo para que el total cierre exacto.
3. **Cobranza** — pantalla operativa con las cuotas de la semana, filtrables por zona,
   cobrador, período y búsqueda libre. Cada cobro se registra contra una cuota; se aceptan
   **pagos parciales** y la cuota queda con saldo. Cuando todas las cuotas quedan saldadas,
   el préstamo pasa a *completado* automáticamente. Las cuotas que ya tuvieron un recibo
   emitido (por cualquier planilla, esté rendida o no, y sin importar si la cuota ya está
   saldada) muestran un botón para **reimprimir ese recibo puntual** — sale por duplicado
   igual que al emitirlo, sin tener que reimprimir toda la planilla. Si la cuota pasó por
   más de una planilla (se emitió, no se cobró del todo y se volvió a emitir), reimprime
   siempre la más reciente.
4. **Recibos y Rendición** — se emite una **planilla** por cobrador y/o zona para un rango
   de fechas: un recibo por cada cuota impaga que vence en ese lapso (opcionalmente también
   las atrasadas). Se imprimen los recibos **por duplicado**: cada cuota sale dos veces
   seguidas (ORIGINAL para el cliente, DUPLICADO para la rendición), uno debajo del otro
   ocupando el ancho completo de la hoja A4 (4 por hoja — siempre 2 pares completos, el
   duplicado de una cuota nunca queda en la hoja siguiente), con guías de corte y espacio en
   blanco para anotar a mano fecha, importe y cancelación. También se imprime la planilla
   de ruta. Cuando el cobrador vuelve, se
   **rinde**: se carga lo cobrado en cada recibo y el sistema registra todos los pagos en una
   sola transacción. Lo no cobrado vuelve a quedar disponible para la próxima planilla. Una
   cuota que ya salió en una planilla sin rendir no se vuelve a imprimir, y una planilla
   rendida no se puede anular ni rendir dos veces.

   Los recibos guardan una **foto** de los datos al emitir: una reimpresión sale idéntica a
   la que se le entregó al cobrador. El logo sale de `public/logo.png`.
5. **Panel** — capital en la calle, por cobrar, cobrado, mora, avance de la semana y
   ranking de cobranza por zona y por cobrador.

Todos los totales los mantienen **triggers en la base**, no el frontend: no se descuadran
aunque se cargue un pago desde el SQL Editor.

## ✅ Estado: backend en producción

El backend está creado y verificado en el proyecto
[`ubmgpxitpsnwddplsuqw`](https://supabase.com/dashboard/project/ubmgpxitpsnwddplsuqw)
("cobranzas", región `ca-central-1`). El proyecto anterior
(`hkqvcfwezbvdtumdrzhv`) quedó pausado sin usar y se reemplazó por este.

Se aplicó [`supabase/schema_completo.sql`](supabase/schema_completo.sql) completo sobre
una base vacía: las 10 tablas (`clients`, `interactions`, `loans`, `installments`,
`payments`, `zonas`, `cobradores`, `rubros`, `rendiciones`, `rendicion_items`) más la vista
`v_cobranza`, con RLS y las 7 funciones/triggers del circuito de préstamos y rendición.
Verificado con datos de [`supabase/seed.sql`](supabase/seed.sql) y un ciclo completo de
`emitir_rendicion` → `rendir_rendicion` contra la base real, incluyendo pago parcial y
recibo en $0, usando la clave anon del frontend.

`.env.local` ya tiene la URL y la clave anon de este proyecto cargadas — no hace falta
tocar nada para levantar la app apuntando a Supabase Live.

Si en algún momento hay que migrar un proyecto viejo (con el esquema de `clients` sin
`zona`/`cobrador`, o con `projects`/`invoices` de la plantilla original) a este mismo
esquema, usá [`supabase/aplicar_pendientes.sql`](supabase/aplicar_pendientes.sql) en su
lugar — ver la sección de scripts SQL más abajo.

## Puesta en marcha

**Requisitos:** Node.js

1. `npm install`
2. `VITE_SUPABASE_ANON_KEY` y `VITE_SUPABASE_URL` ya están cargadas en
   [.env.local](.env.local), apuntando al proyecto `ubmgpxitpsnwddplsuqw`. Si alguna vez
   hay que rotarlas: [Project Settings → API Keys](https://supabase.com/dashboard/project/ubmgpxitpsnwddplsuqw/settings/api-keys).

   > También se puede sobreescribir desde la app, en **Config Supabase & SQL**. Queda en
   > `localStorage` y tiene prioridad sobre `.env.local`.
3. `npm run dev`

Si la píldora del navbar dice **Supabase Live** (verde), la app escribe en la base remota.
Si dice **Modo Demo (Local)**, no hay credenciales y los datos viven sólo en el navegador.

## Scripts SQL

| Archivo | Qué hace | Cuándo usarlo |
|---|---|---|
| [supabase/schema_completo.sql](supabase/schema_completo.sql) | Todo el esquema de cero | **Ya aplicado** en `ubmgpxitpsnwddplsuqw`. Para otro proyecto Supabase nuevo y vacío |
| [supabase/seed.sql](supabase/seed.sql) | Datos de demostración | **Ya aplicado**. Opcional en otra base, después del esquema |
| [supabase/aplicar_pendientes.sql](supabase/aplicar_pendientes.sql) | 004 a 008 juntos, re-ejecutable | Migrar un proyecto viejo (esquema pre-préstamos) al esquema actual |
| [supabase/migrations/003_rls_per_user.sql](supabase/migrations/003_rls_per_user.sql) | Policies multiusuario | Antes de producción con plata real (ver abajo) |

El historial completo queda en [supabase/migrations/](supabase/migrations/): 001 y 002
(esquema original, ya aplicados), 004 (alta de cliente simplificada), 005 (préstamos y
cobranza), 006 (zonas y cobradores), 007 (rubros) y 008 (N° de cliente, fecha de
otorgamiento, recibos y rendiciones).

Todo el SQL está probado contra PostgreSQL 17 (la misma versión mayor que Supabase):
`aplicar_pendientes.sql` sobre una réplica del estado actual de la base, `schema_completo.sql`
sobre una base vacía, ambos ejecutados dos veces seguidas, más el circuito completo de
emisión y rendición con sus casos borde.

### ⚠️ Sobre las policies actuales

Las policies son las de **desarrollo**: acceso total de lectura y escritura para `anon` y
`authenticated`. Como la clave anon viaja en el bundle del frontend, **cualquiera que abra
la app puede leer y modificar todos los datos**, incluidos los montos de los préstamos.

Antes de operar con plata real, ejecutá
[003_rls_per_user.sql](supabase/migrations/003_rls_per_user.sql): restringe todo a usuarios
autenticados y cada uno ve sólo sus registros. El login ya está implementado en el botón
**Autenticación**.

> Ese script fue escrito para el esquema anterior: cubre `clients` pero todavía no
> préstamos, cuotas, pagos, catálogos ni rendiciones. Avisame y lo extiendo antes de que
> lo uses.

## Arquitectura del frontend

- [src/lib/supabase.ts](src/lib/supabase.ts) — credenciales (`.env` o `localStorage`) y cliente singleton.
- [src/lib/loanMath.ts](src/lib/loanMath.ts) — plata, fechas y armado del cronograma.
  `buildSchedule()` replica exactamente el trigger `generate_loan_installments` para que el
  Modo Demo y Supabase den el mismo plan de cuotas.
- [src/services/clientService.ts](src/services/clientService.ts) — clientes e historial de contactos.
- [src/services/loanService.ts](src/services/loanService.ts) — préstamos, cuotas, cobranza y pagos.
  En Modo Demo replica en TypeScript lo que hacen los triggers.
- [src/services/catalogService.ts](src/services/catalogService.ts) — zonas, cobradores y rubros.
  En Modo Demo replica el `ON UPDATE CASCADE` / `ON DELETE SET NULL` de las claves foráneas.
- [src/services/rendicionService.ts](src/services/rendicionService.ts) — emisión, rendición y
  anulación de planillas. En vivo llama a las funciones `emitir_rendicion` y
  `rendir_rendicion` de la base; en Modo Demo las replica con el mismo resultado. También
  resuelve, para una cuota puntual, cuál fue su último recibo emitido (para reimprimirlo
  desde Cobranza sin pasar por la planilla completa).
- [src/lib/printDocs.ts](src/lib/printDocs.ts) — HTML de recibos y planilla (funciones puras,
  con todo el texto escapado) y la ventana de impresión.
- [src/services/supabaseErrors.ts](src/services/supabaseErrors.ts) — traduce los errores de
  PostgREST/Postgres a mensajes accionables en español.

Con credenciales cargadas **todo va contra Supabase y los errores se propagan a la UI**;
`localStorage` se usa únicamente como Modo Demo explícito, nunca como respaldo silencioso
de una escritura remota fallida.

> ⚠️ El `tsconfig.json` no tiene `strict`, así que TypeScript **no** avisa de accesos a
> campos opcionales (`client.zona.toLowerCase()` compila y explota en runtime). Al tocar
> campos opcionales hay que revisar los usos a mano. Activar `strict` sería la mejora
> siguiente.

## Comandos

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo en http://localhost:3000 |
| `npm run build` | Build de producción en `dist/` |
| `npm run preview` | Sirve el build de producción |
| `npm run lint` | `tsc --noEmit` (chequeo de tipos) |
