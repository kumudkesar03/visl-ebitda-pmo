import type { ReactNode, CSSProperties } from 'react';
import { Icon } from './Icons';
import { cr, pct, achievementTone, varianceTone, crSigned } from '../lib/format';
import { statusLabel, statusTone, PRIORITY_TONE, PRIORITY_LABELS, HEALTH_LABELS } from '../lib/vocabulary';
import type { Ratio, Priority, Health } from '../types/api';

/* ====================================================================== *
 * Card
 * ====================================================================== */

export function Card({ title, hint, actions, children, footer, className = '', bodyClass = '', style }: {
  title?: ReactNode; hint?: ReactNode; actions?: ReactNode;
  children: ReactNode; footer?: ReactNode;
  className?: string; bodyClass?: string; style?: CSSProperties;
}) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || actions) && (
        <div className="card-head">
          <div className="grow">
            {title && <h2>{title}</h2>}
            {hint && <div className="hint">{hint}</div>}
          </div>
          {actions}
        </div>
      )}
      <div className={`card-body ${bodyClass}`}>{children}</div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

/* ====================================================================== *
 * KPI tile
 * ====================================================================== */

/**
 * A headline figure.
 *
 * `basis` is not optional decoration. Any tile showing a percentage must say
 * what the percentage is measured against, because the alternative is the
 * defect recorded in text.txt 13.5 - a dashboard reading 396.8% because three
 * months of delivery were divided by one month of plan. The basis line is
 * rendered in the tile itself, not in a tooltip nobody opens.
 */
export function Kpi({ label, value, unit, sub, basis, accent = 'navy', delta }: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  basis?: string;
  accent?: 'navy' | 'blue' | 'green' | 'amber' | 'red';
  delta?: { value: number; suffix?: string };
}) {
  return (
    <div className={`kpi accent-${accent}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {value}{unit && <span className="unit">{unit}</span>}
      </div>
      {(sub || delta) && (
        <div className="kpi-sub">
          {delta && (
            <span className={`delta ${varianceTone(delta.value)}`}>
              {crSigned(delta.value)}{delta.suffix || ''}
            </span>
          )}
          {sub}
        </div>
      )}
      {basis && <div className="kpi-basis">{basis}</div>}
    </div>
  );
}

/** A KPI whose value is a ratio - renders the pct and its basis together. */
export function RatioKpi({ label, ratio, accent, sub }: {
  label: string; ratio: Ratio | null | undefined;
  accent?: 'navy' | 'blue' | 'green' | 'amber' | 'red'; sub?: ReactNode;
}) {
  const tone = achievementTone(ratio?.pct);
  const resolved = accent || (tone === 'green' ? 'green' : tone === 'amber' ? 'amber' : tone === 'red' ? 'red' : 'navy');
  return (
    <Kpi
      label={label}
      value={ratio?.pct === null || ratio?.pct === undefined ? '--' : pct(ratio.pct)}
      accent={resolved}
      sub={sub ?? (ratio ? <span className="muted">{cr(ratio.numerator)} of {cr(ratio.denominator)} Cr</span> : null)}
      basis={ratio ? `${ratio.basis} · ${ratio.window}` : undefined}
    />
  );
}

/* ====================================================================== *
 * Badges
 * ====================================================================== */

export function StatusBadge({ status }: { status: string | null | undefined }) {
  return <span className={`badge ${statusTone(status)}`}>{statusLabel(status)}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`badge ${PRIORITY_TONE[priority] || ''}`}>{PRIORITY_LABELS[priority] || priority}</span>;
}

export function HealthDot({ health, label = true }: { health: Health | string; label?: boolean }) {
  return (
    <span className="row gap-6 nowrap">
      <i className={`dot ${health}`} />
      {label && <span className="small">{HEALTH_LABELS[health] || health}</span>}
    </span>
  );
}

export function BuTag({ code, accent }: { code: string; accent?: string }) {
  return (
    <span className="bu-tag">
      {accent && <i className="dot" style={{ background: accent, width: 6, height: 6, flex: '0 0 6px' }} />}
      {code}
    </span>
  );
}

/* ====================================================================== *
 * Bars
 * ====================================================================== */

export function ProgressBar({ value, tone }: { value: number; tone?: string }) {
  const clamped = Math.max(0, Math.min(100, value || 0));
  return (
    <span className="row gap-8 nowrap">
      <span className={`bar ${tone || ''}`} style={{ width: 72 }}>
        <span style={{ width: `${clamped}%` }} />
      </span>
      <span className="small num" style={{ width: 30, textAlign: 'right' }}>{Math.round(clamped)}%</span>
    </span>
  );
}

/**
 * Plan and delivery drawn as two stacked rules against a shared scale.
 *
 * A row in a table can then be read without a chart: the grey rule is what was
 * planned to date, the coloured one what has actually been banked. Both are
 * scaled to the same maximum, so short-vs-long is a real comparison rather
 * than two independently normalised bars.
 */
export function DualBar({ plan, actual, max }: { plan: number; actual: number; max: number }) {
  const scale = max > 0 ? max : 1;
  const ratio = plan > 0 ? (actual / plan) * 100 : null;
  const tone = ratio === null ? '' : ratio >= 90 ? '' : ratio >= 70 ? 'under' : 'poor';
  return (
    <span className="dual-bar" title={`Plan ${cr(plan)} · Booked ${cr(actual)} Cr`}>
      <span className="plan" style={{ width: `${Math.min(100, (plan / scale) * 100)}%` }} />
      <span className={`act ${tone}`} style={{ width: `${Math.min(100, (actual / scale) * 100)}%` }} />
    </span>
  );
}

/* ====================================================================== *
 * States
 * ====================================================================== */

export function Empty({ title, children, icon = 'info' }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="empty">
      <Icon name={icon} style={{ width: 26, height: 26, color: 'var(--ink-300)', marginBottom: 10 }} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Alert({ tone = 'info', icon, children }: { tone?: 'info' | 'green' | 'amber' | 'red' | 'neutral'; icon?: string; children: ReactNode }) {
  const defaultIcon = tone === 'red' || tone === 'amber' ? 'alert' : 'info';
  return (
    <div className={`alert ${tone}`}>
      <Icon name={icon || defaultIcon} />
      <div className="grow">{children}</div>
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack gap-8" style={{ padding: 4 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 15, width: `${94 - i * 9}%` }} />
      ))}
    </div>
  );
}

export function KpiSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="kpi-band">
      {Array.from({ length: count }).map((_, i) => (
        <div className="kpi" key={i}>
          <div className="skeleton" style={{ height: 10, width: '55%' }} />
          <div className="skeleton" style={{ height: 26, width: '72%', marginTop: 9 }} />
          <div className="skeleton" style={{ height: 10, width: '44%', marginTop: 9 }} />
        </div>
      ))}
    </div>
  );
}

/* ====================================================================== *
 * Section heading used inside pages
 * ====================================================================== */

export function SectionTitle({ children, hint, actions }: { children: ReactNode; hint?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="row gap-12" style={{ marginBottom: 12 }}>
      <div className="grow">
        <h2>{children}</h2>
        {hint && <div className="small muted" style={{ marginTop: 2 }}>{hint}</div>}
      </div>
      {actions}
    </div>
  );
}
