import type { Person } from './types';

export const uid = (prefix: string) =>
  prefix + '_' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);

export const nowIso = () => new Date().toISOString();

/** Local date as YYYY-MM-DD */
export function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

export function addMonths(s: string, n: number): string {
  const d = parseDate(s);
  d.setMonth(d.getMonth() + n);
  return todayStr(d);
}

export function fmtDate(s: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!s) return '';
  return parseDate(s).toLocaleDateString(undefined, opts);
}

export function fmtDateTime(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function displayName(p: Pick<Person, 'firstName' | 'lastName' | 'description'>, order: 'first' | 'last' = 'first') {
  const f = p.firstName.trim();
  const l = p.lastName.trim();
  if (!f && !l) return p.description ? `(${p.description})` : '(no name)';
  if (order === 'last' && l) return f ? `${l}, ${f}` : l;
  return [f, l].filter(Boolean).join(' ');
}

export function sortKey(p: Person, order: 'first' | 'last') {
  const f = p.firstName.trim().toLowerCase();
  const l = p.lastName.trim().toLowerCase();
  const d = p.description.trim().toLowerCase();
  if (!f && !l) return 'zzzzz ' + d; // unnamed people sort last
  return order === 'last' ? `${l || 'zzzz'} ${f}` : `${f || 'zzzz'} ${l}`;
}

export function matchesSearch(p: Person, q: string) {
  if (!q) return true;
  const hay = `${p.firstName} ${p.lastName} ${p.description} ${p.phone} ${p.email} ${p.notes}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

export function pct(n: number, d: number) {
  if (!d) return '—';
  return Math.round((n / d) * 100) + '%';
}

export function downloadFile(name: string, content: string, type = 'text/csv') {
  const blob = new Blob([content], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c ?? '');
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

/** Minimal RFC-4180 CSV parser (handles quotes, commas, newlines in quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
