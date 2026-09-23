import { Loan } from '../types/database';

/** Redondeo a dos decimales, tolerante a strings que llegan de PostgREST. */
export function round2(value: number | string): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Total a devolver a partir del capital y el recargo porcentual. */
export function totalFromRate(principal: number, interestRate: number): number {
  return round2((Number(principal) || 0) * (1 + (Number(interestRate) || 0) / 100));
}

/** Recargo porcentual implícito en un total escrito a mano. */
export function rateFromTotal(principal: number, total: number): number {
  const p = Number(principal) || 0;
  if (p <= 0) return 0;
  return round2(((Number(total) || 0) / p - 1) * 100);
}

/** Valor de cada cuota; la última absorbe la diferencia por redondeo. */
export function installmentAmount(total: number, count: number): number {
  const n = Number(count) || 0;
  if (n <= 0) return 0;
  return round2((Number(total) || 0) / n);
}

/** Suma semanas a una fecha `YYYY-MM-DD` sin arrastrar la zona horaria. */
export function addWeeks(isoDate: string, weeks: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

/**
 * Plan de cuotas semanales. Replica exactamente lo que hace el trigger
 * `generate_loan_installments` en la base, para que el Modo Demo y Supabase
 * produzcan el mismo cronograma.
 */
export function buildSchedule(
  loan: Pick<Loan, 'total_amount' | 'installments_count' | 'installment_amount' | 'start_date'>
): { number: number; due_date: string; amount: number }[] {
  const rows: { number: number; due_date: string; amount: number }[] = [];
  let acumulado = 0;

  for (let i = 1; i <= loan.installments_count; i++) {
    const esUltima = i === loan.installments_count;
    const amount = esUltima ? round2(loan.total_amount - acumulado) : round2(loan.installment_amount);
    if (!esUltima) acumulado = round2(acumulado + amount);

    rows.push({ number: i, due_date: addWeeks(loan.start_date, i - 1), amount });
  }

  return rows;
}

/** Fecha de hoy en `YYYY-MM-DD`, en hora local. */
export function today(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function formatMoney(value: number | string): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

/** `2026-09-13` -> `13/09/2026`, sin pasar por Date para no correr un día. */
export function formatDate(isoDate?: string | null): string {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
