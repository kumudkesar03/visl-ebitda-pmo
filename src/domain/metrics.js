'use strict';

/**
 * THE FORMULA LAYER.
 *
 * Every savings figure the application shows - dashboard tile, chart axis,
 * exported cell, board pack, mail digest - is produced here. Nothing else in
 * the codebase divides one money column by another.
 *
 * Two defects recorded in text.txt drove this design, and both are structurally
 * prevented rather than patched:
 *
 * 1. FAN-OUT (section 8). The old vw_visl_bu_summary joined initiatives to the
 *    aggregated month figures in one query, so each month total repeated once
 *    per initiative - IOK showed 207.55 Cr, exactly 29.65 x 7 initiatives.
 *    Here counts and money are reduced in separate passes and joined 1:1 per
 *    business unit. See rollup(). The SQL side does the same with two CTEs.
 *
 * 2. MISMATCHED WINDOWS (section 13.5). The ESL dashboard displayed "plan
 *    achievement 396.8%" because it compared three months of booked actuals
 *    against one month of plan. Here every ratio is produced by ratio(), which
 *    takes a numerator and denominator computed over THE SAME explicit month
 *    window, and every result carries the basis and the window that produced
 *    it so the UI can label it honestly. A percentage without a stated basis
 *    cannot be constructed through this module.
 */

const H = require('./hierarchy');

/* --------------------------------------------------------------------- *
 * Period helpers. A period is the first day of a month, ISO 'YYYY-MM-01'.
 * --------------------------------------------------------------------- */

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function periodOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function periodLabel(period) {
  const [y, m] = String(period).split('-');
  return `${MONTH_SHORT[Number(m) - 1]} ${String(y).slice(2)}`;
}

function addMonths(period, n) {
  const [y, m] = String(period).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return periodOf(d);
}

/** The 12 periods of a financial year beginning at `startISO`. */
function fyPeriods(startISO, count = 12) {
  const start = periodOf(startISO);
  return Array.from({ length: count }, (_, i) => addMonths(start, i));
}

/* --------------------------------------------------------------------- *
 * Reporting window
 * --------------------------------------------------------------------- */

/**
 * The reporting window is the single most important governance decision in
 * this module, because it decides what "to date" means.
 *
 * `closedThrough` is the last month the business considers CLOSED for
 * reporting - not today's month. A drive reviewed on 10 September reports on
 * August. Comparing booked-to-date against a plan that includes the month
 * still in progress understates delivery every single month; that is what a
 * closing calendar is for, and it is held in settings as reporting.closed_through.
 */
function buildWindow({ periods, closedThrough }) {
  const all = periods.slice();
  const closedIdx = all.indexOf(closedThrough);
  const closed = closedIdx >= 0 ? all.slice(0, closedIdx + 1) : [];
  const open = closedIdx >= 0 ? all.slice(closedIdx + 1) : all.slice();
  return {
    all,
    closed,
    open,
    first: all[0] || null,
    last: all[all.length - 1] || null,
    closedThrough: closedIdx >= 0 ? closedThrough : null,
    closedCount: closed.length,
    totalCount: all.length,
    label: closed.length
      ? `${periodLabel(all[0])} to ${periodLabel(closedThrough)}`
      : 'no closed period',
  };
}

/* --------------------------------------------------------------------- *
 * Safe ratio
 * --------------------------------------------------------------------- */

/**
 * The only place a percentage is produced.
 *
 * Returns null - never Infinity, never a misleading number - when the
 * denominator is zero or absent, so the UI renders an em dash rather than
 * inventing performance. `basis` and `window` travel with the value.
 */
function ratio(numerator, denominator, basis, windowLabel) {
  const n = Number(numerator) || 0;
  const d = Number(denominator) || 0;
  if (d <= 0) {
    return { pct: null, numerator: round(n, MONEY_DP), denominator: round(d, MONEY_DP), basis, window: windowLabel };
  }
  return {
    pct: round((n / d) * 100, 1),
    numerator: round(n, MONEY_DP),
    denominator: round(d, MONEY_DP),
    basis,
    window: windowLabel,
  };
}

/**
 * Money is carried at 4 decimal places everywhere inside the application and
 * rounded to 2 only by the display formatters in web/src/lib/format.ts.
 *
 * The reason is additive consistency. Round a business unit to paise, then add
 * four of them, and the parent disagrees with its own children by a paisa or
 * two - which is exactly the signature of the fan-out defect and will be read
 * as one in a review. Round once, at the edge, after every addition is done.
 */
const MONEY_DP = 4;

function round(v, dp = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/* --------------------------------------------------------------------- *
 * Month-level aggregation
 * --------------------------------------------------------------------- */

/**
 * Reduce raw initiative_months rows into one record per period.
 *
 * booked_cr counts APPROVED rows only. This is the governance rule expressed
 * as arithmetic, carried forward from text.txt 7.2: a saving does not count
 * until the PMO office has approved it. `submitted_cr` is shown separately as
 * pipeline so nobody has to choose between honesty and completeness.
 */
function monthSeries(monthRows, periods) {
  const byPeriod = new Map(periods.map((p) => [p, {
    period: p,
    label: periodLabel(p),
    plan_cr: 0,
    actual_cr: 0,
    booked_cr: 0,
    submitted_cr: 0,
    rejected_cr: 0,
    entries: 0,
  }]));

  for (const row of monthRows) {
    const slot = byPeriod.get(row.period);
    if (!slot) continue;
    const actual = Number(row.actual_cr) || 0;
    slot.plan_cr += Number(row.plan_cr) || 0;
    slot.entries += 1;
    if (row.actual_cr !== null && row.actual_cr !== undefined) {
      slot.actual_cr += actual;
      if (row.actual_status === 'approved') slot.booked_cr += actual;
      else if (row.actual_status === 'submitted') slot.submitted_cr += actual;
      else if (row.actual_status === 'rejected') slot.rejected_cr += actual;
    }
  }

  // Series values are carried at 4dp, not 2dp, and rounded to presentation
  // precision once at the very end by headline() and the formatters.
  //
  // Rounding a month total to paise here and then adding twelve of them makes
  // the year miss its own target by a couple of lakh - small enough to look
  // like a bug in the data and large enough to derail a review. Round once, at
  // the boundary, never in the middle of an aggregation.
  const DP = 4;
  let cumPlan = 0;
  let cumBooked = 0;
  return periods.map((p) => {
    const s = byPeriod.get(p);
    cumPlan += s.plan_cr;
    cumBooked += s.booked_cr;
    return {
      ...s,
      plan_cr: round(s.plan_cr, DP),
      actual_cr: round(s.actual_cr, DP),
      booked_cr: round(s.booked_cr, DP),
      submitted_cr: round(s.submitted_cr, DP),
      rejected_cr: round(s.rejected_cr, DP),
      variance_cr: round(s.booked_cr - s.plan_cr, DP),
      cum_plan_cr: round(cumPlan, DP),
      cum_booked_cr: round(cumBooked, DP),
      cum_variance_cr: round(cumBooked - cumPlan, DP),
    };
  });
}

function sumOver(series, periods, field) {
  const wanted = new Set(periods);
  return series.reduce((acc, s) => (wanted.has(s.period) ? acc + (s[field] || 0) : acc), 0);
}

/* --------------------------------------------------------------------- *
 * Headline figures for one scope
 * --------------------------------------------------------------------- */

/**
 * The executive headline block. Every ratio here states its basis, and the two
 * that leadership habitually confuse are deliberately reported side by side:
 *
 *   achievement_ptd  - booked vs plan, CLOSED MONTHS ONLY. Answers "are we
 *                      hitting the run rate we committed to?" Moves month to
 *                      month and is the operational number.
 *   target_delivered - booked vs the FULL-YEAR commitment. Answers "how much of
 *                      the year's promise is banked?" Rises monotonically and
 *                      is the number for the board.
 *
 * Reporting either one without its label is how 396.8% reached a dashboard.
 */
function headline({ initiatives, series, window: win }) {
  const target_cr = initiatives.reduce((a, i) => a + (Number(i.target_savings_cr) || 0), 0);

  const plan_fy_cr = sumOver(series, win.all, 'plan_cr');
  const plan_ptd_cr = sumOver(series, win.closed, 'plan_cr');
  const booked_ptd_cr = sumOver(series, win.closed, 'booked_cr');
  const booked_fy_cr = sumOver(series, win.all, 'booked_cr');
  const submitted_cr = sumOver(series, win.all, 'submitted_cr');
  const open_plan_cr = sumOver(series, win.open, 'plan_cr');

  const active = initiatives.filter((i) => i.is_active !== false);
  const byStatus = countBy(active, 'status');
  const byHealth = countBy(active, 'health');

  return {
    target_cr: round(target_cr, MONEY_DP),
    plan_fy_cr: round(plan_fy_cr, MONEY_DP),
    plan_ptd_cr: round(plan_ptd_cr, MONEY_DP),
    booked_ptd_cr: round(booked_ptd_cr, MONEY_DP),
    booked_fy_cr: round(booked_fy_cr, MONEY_DP),
    submitted_cr: round(submitted_cr, MONEY_DP),
    open_plan_cr: round(open_plan_cr, MONEY_DP),

    variance_ptd_cr: round(booked_ptd_cr - plan_ptd_cr, MONEY_DP),
    // Plan not yet covered by an approved actual, for the closed window.
    gap_to_target_cr: round(target_cr - booked_fy_cr, MONEY_DP),
    // What the year lands at if the remaining plan is delivered in full.
    forecast_fy_cr: round(booked_fy_cr + open_plan_cr, MONEY_DP),

    achievement_ptd: ratio(booked_ptd_cr, plan_ptd_cr, 'plan-to-date', win.label),
    target_delivered: ratio(booked_fy_cr, target_cr, 'full-year target', `${win.totalCount} months`),
    plan_coverage: ratio(plan_fy_cr, target_cr, 'plan vs target', `${win.totalCount} months`),
    forecast_vs_target: ratio(booked_fy_cr + open_plan_cr, target_cr, 'forecast vs target', `${win.totalCount} months`),

    initiative_count: active.length,
    status_counts: byStatus,
    health_counts: byHealth,
    elapsed_share: ratio(plan_ptd_cr, plan_fy_cr, 'plan weighting elapsed', win.label),
  };
}

function countBy(rows, field) {
  return rows.reduce((acc, r) => {
    const k = r[field] || 'unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

/* --------------------------------------------------------------------- *
 * Hierarchical roll-up
 * --------------------------------------------------------------------- */

/**
 * Produce a headline block for every node in the tree.
 *
 * FAN-OUT SAFETY: initiatives and month rows are bucketed by leaf BU in two
 * separate passes, then each node sums the buckets of its own leaves. A month
 * total is therefore added exactly once per node no matter how many
 * initiatives that unit carries. The reconciliation script asserts that every
 * parent equals the sum of its children.
 */
function rollup({ initiatives, monthRows, periods, closedThrough }) {
  const win = buildWindow({ periods, closedThrough });

  const initsByLeaf = new Map();
  const monthsByLeaf = new Map();
  for (const code of H.LEAF_CODES) {
    initsByLeaf.set(code, []);
    monthsByLeaf.set(code, []);
  }

  // Pass 1: initiatives -> leaf bucket.
  const initBu = new Map();
  for (const i of initiatives) {
    const bu = String(i.bu_code || '').toUpperCase();
    if (!initsByLeaf.has(bu)) continue; // consolidated nodes never hold rows
    initsByLeaf.get(bu).push(i);
    initBu.set(i.id, bu);
  }

  // Pass 2: month rows -> leaf bucket, via their initiative.
  for (const m of monthRows) {
    const bu = initBu.get(m.initiative_id);
    if (!bu) continue;
    monthsByLeaf.get(bu).push(m);
  }

  const nodes = {};
  for (const unit of H.displayOrder()) {
    const leaves = H.leavesOf(unit.code);
    const inits = leaves.flatMap((c) => initsByLeaf.get(c) || []);
    const months = leaves.flatMap((c) => monthsByLeaf.get(c) || []);
    const series = monthSeries(months, periods);
    nodes[unit.code] = {
      bu: { ...unit, leaves },
      series,
      ...headline({ initiatives: inits, series, window: win }),
    };
  }

  return { window: win, nodes, order: H.displayOrder().map((u) => u.code) };
}

/* --------------------------------------------------------------------- *
 * Initiative-level derived figures
 * --------------------------------------------------------------------- */

function initiativeRollup(initiative, monthRows, periods, closedThrough) {
  const win = buildWindow({ periods, closedThrough });
  const rows = monthRows.filter((m) => m.initiative_id === initiative.id);
  const series = monthSeries(rows, periods);
  const head = headline({ initiatives: [initiative], series, window: win });
  return { ...head, series, window: win };
}

/**
 * Schedule-adjusted health, so "green" is a computed position rather than an
 * optimistic self-assessment. The owner may still override; the computed value
 * is shown alongside so a divergence is visible to the PMO.
 */
function computedHealth({ achievementPct, dueDate, status, today }) {
  if (status === 'completed') return 'green';
  if (status === 'cancelled' || status === 'on_hold') return 'amber';
  const overdue = dueDate && new Date(dueDate) < (today || new Date()) && status !== 'completed';
  if (overdue) return 'red';
  if (achievementPct === null || achievementPct === undefined) return 'amber';
  if (achievementPct >= 90) return 'green';
  if (achievementPct >= 70) return 'amber';
  return 'red';
}

module.exports = {
  periodOf, periodLabel, addMonths, fyPeriods,
  buildWindow, ratio, round, monthSeries, sumOver,
  headline, rollup, initiativeRollup, computedHealth,
  MONTH_SHORT,
};
