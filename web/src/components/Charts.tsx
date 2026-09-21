import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { moneyScales } from '../lib/chartSetup';
import { CHART } from '../lib/vocabulary';
import { cr, pct } from '../lib/format';
import type { MonthPoint } from '../types/api';

/**
 * Chart components.
 *
 * Every chart here answers one question and says which one in its own legend.
 * The recurring decision across all of them: PLAN IS GREY AND DELIVERY IS
 * COLOURED. Plan is a reference line, not an achievement, and colouring both
 * sides equally is what makes a monthly chart look like two competing results
 * rather than a result measured against a commitment.
 */

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span className="k" key={i.label}>
          <i className={`sw ${i.line ? 'line' : ''}`} style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/* ====================================================================== *
 * Monthly plan versus booked
 * ====================================================================== */

/**
 * The operational chart: how each month landed against its plan.
 *
 * Months still open are drawn at reduced opacity so the eye does not read a
 * zero bar in a future month as a miss. Pipeline (submitted, not yet approved)
 * is stacked on top of booked in amber, which lets a PMO see instantly whether
 * a weak month is genuinely weak or simply sitting in their own approval queue.
 */
export function MonthlyDelivery({ series, closedThrough, height = 260 }: {
  series: MonthPoint[]; closedThrough?: string | null; height?: number;
}) {
  const closedIdx = closedThrough ? series.findIndex((s) => s.period === closedThrough) : series.length - 1;
  const isOpen = (i: number) => i > closedIdx;

  return (
    <>
      <div className="chart-box" style={{ height }}>
        <Bar
          data={{
            labels: series.map((s) => s.label),
            datasets: [
              {
                label: 'Plan',
                data: series.map((s) => s.plan_cr),
                backgroundColor: series.map((_, i) => (isOpen(i) ? 'rgba(151,156,161,.28)' : CHART.plan)),
                borderRadius: 3,
                barPercentage: 0.92,
                categoryPercentage: 0.62,
                order: 2,
              },
              {
                label: 'Booked',
                data: series.map((s) => s.booked_cr),
                backgroundColor: CHART.booked,
                borderRadius: 3,
                barPercentage: 0.92,
                categoryPercentage: 0.62,
                stack: 'delivery',
                order: 1,
              },
              {
                label: 'Awaiting approval',
                data: series.map((s) => s.submitted_cr),
                backgroundColor: CHART.pipeline,
                borderRadius: 3,
                barPercentage: 0.92,
                categoryPercentage: 0.62,
                stack: 'delivery',
                order: 1,
              },
            ],
          }}
          options={{ scales: moneyScales(), plugins: { tooltip: { mode: 'index', intersect: false } } as any }}
        />
      </div>
      <Legend items={[
        { label: 'Plan', color: CHART.plan },
        { label: 'Booked (approved)', color: CHART.booked },
        { label: 'Awaiting approval', color: CHART.pipeline },
      ]} />
    </>
  );
}

/* ====================================================================== *
 * Cumulative delivery
 * ====================================================================== */

/**
 * The board chart: are we on the curve?
 *
 * Cumulative plan is a filled grey area; cumulative booked is a solid line
 * that stops at the last closed month rather than dropping to zero across the
 * open months. A line that falls off a cliff in the middle of the year reads
 * as collapse; stopping it reads as "we have not measured that yet", which is
 * the truth.
 */
export function CumulativeDelivery({ series, closedThrough, target, height = 260 }: {
  series: MonthPoint[]; closedThrough?: string | null; target?: number; height?: number;
}) {
  const closedIdx = closedThrough ? series.findIndex((s) => s.period === closedThrough) : series.length - 1;

  return (
    <>
      <div className="chart-box" style={{ height }}>
        <Line
          data={{
            labels: series.map((s) => s.label),
            datasets: [
              {
                label: 'Cumulative plan',
                data: series.map((s) => s.cum_plan_cr),
                borderColor: CHART.plan,
                backgroundColor: CHART.planFill,
                borderWidth: 1.6,
                fill: true,
                tension: 0.25,
                pointRadius: 0,
              },
              {
                label: 'Cumulative booked',
                data: series.map((s, i) => (i <= closedIdx ? s.cum_booked_cr : null)),
                borderColor: CHART.booked,
                backgroundColor: CHART.bookedFill,
                borderWidth: 2.4,
                fill: true,
                tension: 0.25,
                pointRadius: 2.5,
                pointBackgroundColor: CHART.booked,
                spanGaps: false,
              },
              ...(target ? [{
                label: 'Full-year target',
                data: series.map(() => target),
                borderColor: CHART.target,
                borderWidth: 1.4,
                borderDash: [5, 4],
                fill: false,
                pointRadius: 0,
              }] : []),
            ],
          }}
          options={{ scales: moneyScales(), plugins: { tooltip: { mode: 'index', intersect: false } } as any }}
        />
      </div>
      <Legend items={[
        { label: 'Cumulative plan', color: CHART.plan, line: true },
        { label: 'Cumulative booked', color: CHART.booked, line: true },
        ...(target ? [{ label: 'Full-year target', color: CHART.target, line: true }] : []),
      ]} />
    </>
  );
}

/* ====================================================================== *
 * Category / unit comparison
 * ====================================================================== */

export function ComparisonBars({ rows, height = 250 }: {
  rows: { name: string; plan: number; booked: number; accent?: string }[]; height?: number;
}) {
  return (
    <>
      <div className="chart-box" style={{ height }}>
        <Bar
          data={{
            labels: rows.map((r) => r.name),
            datasets: [
              { label: 'Plan to date', data: rows.map((r) => r.plan), backgroundColor: CHART.plan, borderRadius: 3, barPercentage: 0.88, categoryPercentage: 0.66 },
              { label: 'Booked to date', data: rows.map((r) => r.booked), backgroundColor: rows.map((r) => r.accent || CHART.booked), borderRadius: 3, barPercentage: 0.88, categoryPercentage: 0.66 },
            ],
          }}
          options={{
            indexAxis: 'y' as const,
            scales: {
              x: { beginAtZero: true, grid: { color: CHART.grid }, border: { display: false }, ticks: { color: CHART.axis } },
              y: { grid: { display: false }, border: { color: CHART.grid }, ticks: { color: '#3d434a', font: { size: 11.5 } } },
            },
            plugins: { tooltip: { mode: 'index', intersect: false } } as any,
          }}
        />
      </div>
      <Legend items={[{ label: 'Plan to date', color: CHART.plan }, { label: 'Booked to date', color: CHART.booked }]} />
    </>
  );
}

/* ====================================================================== *
 * Mix
 * ====================================================================== */

export function MixDoughnut({ rows, height = 210 }: {
  rows: { name: string; value: number; accent?: string }[]; height?: number;
}) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="row gap-16" style={{ alignItems: 'center' }}>
      <div className="chart-box" style={{ height, width: height, flex: `0 0 ${height}px` }}>
        <Doughnut
          data={{
            labels: rows.map((r) => r.name),
            datasets: [{
              data: rows.map((r) => r.value),
              backgroundColor: rows.map((r, i) => r.accent || CHART.series[i % CHART.series.length]),
              borderWidth: 2,
              borderColor: '#fff',
            }],
          }}
          options={{ cutout: '66%', plugins: { tooltip: { callbacks: {
            label: (c: any) => `${c.label}: ${cr(c.parsed)} Cr (${pct(total > 0 ? (c.parsed / total) * 100 : 0, 0)})`,
          } } } as any }}
        />
      </div>
      <div className="stack gap-6 grow" style={{ minWidth: 0 }}>
        {rows.slice(0, 8).map((r, i) => (
          <div className="row gap-8" key={r.name}>
            <i className="sw" style={{ width: 9, height: 9, borderRadius: 2, flex: '0 0 9px', background: r.accent || CHART.series[i % CHART.series.length] }} />
            <span className="small truncate grow">{r.name}</span>
            <span className="small num strong nowrap">{cr(r.value)}</span>
            <span className="tiny muted num nowrap" style={{ width: 34, textAlign: 'right' }}>
              {pct(total > 0 ? (r.value / total) * 100 : 0, 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ====================================================================== *
 * Concentration curve
 * ====================================================================== */

/**
 * How much of the year's commitment rests on how few initiatives.
 *
 * A steep early curve means the drive is carried by a handful of big bets and
 * one of them slipping moves the whole number; a shallow curve means risk is
 * spread. Leadership asks this question constantly and usually has to have it
 * worked out by hand.
 */
export function ConcentrationCurve({ points, height = 200 }: {
  points: { rank: number; code: string; cumulative_pct: number }[]; height?: number;
}) {
  return (
    <div className="chart-box" style={{ height }}>
      <Line
        data={{
          labels: points.map((p) => String(p.rank)),
          datasets: [{
            label: 'Cumulative share of target',
            data: points.map((p) => p.cumulative_pct),
            borderColor: CHART.series[3],
            backgroundColor: 'rgba(0,98,174,.08)',
            borderWidth: 2.2,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          }],
        }}
        options={{
          scales: {
            x: { grid: { display: false }, border: { color: CHART.grid }, ticks: { color: CHART.axis } },
            y: { beginAtZero: true, max: 100, grid: { color: CHART.grid }, border: { display: false }, ticks: { color: CHART.axis, callback: (v: any) => `${v}%` } },
          },
          plugins: { tooltip: { callbacks: {
            title: (c: any) => `Top ${c[0].label} initiatives`,
            label: (c: any) => `${c.parsed.y.toFixed(1)}% of the full-year target`,
          } } } as any,
        }}
      />
    </div>
  );
}
