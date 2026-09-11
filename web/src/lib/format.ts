import type { Ratio } from '../types/api';

/**
 * Presentation formatting.
 *
 * This is the ONLY place money is rounded for display. Everything upstream -
 * the API, the metrics layer, the database views - carries four decimal
 * places, so that adding four business units together and comparing the
 * result with their parent gives the same answer to the paisa. Round here,
 * once, at the very edge.
 */

const CR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CR0 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** Rs Cr, the unit this business talks in. */
export function cr(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '--';
  return (dp === 0 ? CR0 : CR).format(Number(v));
}

export function crSigned(v: number | null | undefined): string {
  if (v === null || v === undefined) return '--';
  const n = Number(v);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${CR.format(Math.abs(n))}`;
}

export function pct(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '--';
  return `${Number(v).toFixed(dp)}%`;
}

/** A ratio rendered with the window it was measured over. */
export function ratioLabel(r: Ratio | null | undefined): string {
  if (!r) return '--';
  if (r.pct === null) return `-- · no ${r.basis} to measure against`;
  return `${r.basis} · ${r.window}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return '--';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '--';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return dateShort(iso);
}

/** Tone for a variance figure. Under plan is not automatically bad early in
 *  the year, so this is used for colour, never for a verdict. */
export function varianceTone(v: number | null | undefined): 'up' | 'down' | 'flat' {
  if (v === null || v === undefined) return 'flat';
  if (v > 0.005) return 'up';
  if (v < -0.005) return 'down';
  return 'flat';
}

export function achievementTone(p: number | null | undefined): 'green' | 'amber' | 'red' | '' {
  if (p === null || p === undefined) return '';
  if (p >= 90) return 'green';
  if (p >= 70) return 'amber';
  return 'red';
}
