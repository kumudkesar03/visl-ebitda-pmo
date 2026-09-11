'use strict';

const M = require('../../domain/metrics');
const H = require('../../domain/hierarchy');
const C = require('./catalogue');

/**
 * Builds the complete synthetic dataset held in memory by the synthetic
 * repository.
 *
 * DETERMINISM IS A REQUIREMENT, NOT A CONVENIENCE. Every random-looking value
 * comes from a seeded generator, so the same figures appear on every restart.
 * A demonstration where the numbers move between a screenshot and the live
 * screen destroys confidence faster than any missing feature, and reconciliation
 * tests need a fixed dataset to assert against.
 */

/* Mulberry32 - small, fast, fully deterministic from a 32-bit seed. */
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable integer hash of a string, so per-row seeds do not depend on order. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];
const between = (r, lo, hi) => lo + r() * (hi - lo);

/**
 * Monthly plan weighting across the financial year.
 *
 * A cost-reduction drive ramps: initiatives are still being approved in the
 * first quarter and only reach full run rate in the second half. A flat 1/12
 * would make early-year achievement look like failure and late-year look like
 * heroics. Sums to exactly 1.000 so plan equals target at full-year level.
 */
const PLAN_WEIGHTS = [0.045, 0.055, 0.065, 0.075, 0.080, 0.085, 0.090, 0.090, 0.095, 0.105, 0.105, 0.110];

/**
 * Two different months, deliberately kept apart.
 *
 *   closedThrough    - the last month CLOSED for reporting. Everything up to
 *                      and including it is approved and counts as banked.
 *   submissionPeriod - the month currently being collected. Owners are
 *                      entering actuals, the PMO is approving them, and some
 *                      have been returned for revision.
 *
 * On 10 September a drive reports July as closed while August sits in the
 * approval cycle. Collapsing the two - treating the month still being
 * collected as if it were closed - is what makes every dashboard understate
 * delivery in the first fortnight of a month.
 */
function generate({
  fyStart = '2026-04-01',
  today = new Date('2026-09-10T00:00:00Z'),
  closedThrough = '2026-07-01',
  submissionPeriod = '2026-08-01',
} = {}) {
  const periods = M.fyPeriods(fyStart, 12);
  const weightSum = PLAN_WEIGHTS.reduce((a, b) => a + b, 0);
  if (Math.abs(weightSum - 1) > 1e-9) {
    throw new Error(`PLAN_WEIGHTS must sum to 1.000, got ${weightSum}`);
  }

  /* ---------------------------- business units --------------------------- */
  const businessUnits = H.displayOrder().map((u, idx) => ({
    id: idx + 1,
    code: u.code,
    name: u.name,
    short_name: u.shortName,
    parent_code: u.parent,
    is_consolidated: u.consolidated,
    depth: u.depth,
    accent: u.accent,
    is_active: true,
  }));
  const buId = new Map(businessUnits.map((b) => [b.code, b.id]));

  /* ----------------------------- departments ----------------------------- */
  const departments = C.DEPARTMENTS.map((d, i) => ({
    id: i + 1,
    code: d.code,
    name: d.name,
    bu_code: d.bu,
    business_unit_id: buId.get(d.bu),
    sort_order: (i + 1) * 10,
    is_active: true,
  }));
  const depByCode = new Map(departments.map((d) => [d.code, d]));

  /* -------------------------------- users -------------------------------- */
  const users = C.USERS.map((u, i) => ({
    id: i + 1,
    employee_id: u.employee_id,
    name: u.name,
    email: `${u.employee_id}@vedanta.co.in`,
    role: u.role,
    home_bu: u.home_bu,
    business_unit_id: buId.get(u.home_bu),
    designation: u.designation,
    department: null,
    phone: null,
    ad_user: false,
    is_active: true,
    // Demo credential. Real deployments run AUTH_MODE=ad or seed a hashed
    // bootstrap admin only; see docs/01-SETUP.md.
    password_plain: 'demo1234',
    last_login: null,
    created_at: `${fyStart}T00:00:00.000Z`,
  }));
  const userByEmp = new Map(users.map((u) => [u.employee_id, u]));

  /* ----------------------------- initiatives ----------------------------- */
  const initiatives = [];
  const initiativeMonths = [];
  const tasks = [];
  const milestones = [];
  const risks = [];
  const comments = [];
  const auditLog = [];

  const perBuCount = {};
  let taskId = 1;
  let msId = 1;
  let riskId = 1;
  let commentId = 1;
  let monthId = 1;
  let auditId = 1;

  C.INITIATIVES.forEach((spec, idx) => {
    const id = idx + 1;
    const r = rng(hash(`init:${spec.bu}:${spec.title}`));
    perBuCount[spec.bu] = (perBuCount[spec.bu] || 0) + 1;
    const code = `${spec.bu}-${String(perBuCount[spec.bu]).padStart(3, '0')}`;
    const owner = userByEmp.get(spec.own);
    const dept = depByCode.get(spec.dep);

    // Start dates cluster in Q1 with a tail; due dates land inside the FY.
    const startOffset = Math.floor(between(r, 0, 3));
    const dueOffset = Math.floor(between(r, 8, 12));
    const start = periods[startOffset];
    const due = M.addMonths(periods[Math.min(dueOffset, 11)], 1);

    /* ------------------------- monthly plan grid ------------------------- */
    // Plan starts the month the initiative starts; earlier months carry zero
    // and the released weight is redistributed proportionally over the rest,
    // so every initiative's plan still totals exactly its target.
    const activeWeights = PLAN_WEIGHTS.map((w, i) => (i >= startOffset ? w : 0));
    const activeSum = activeWeights.reduce((a, b) => a + b, 0);
    const normalised = activeWeights.map((w) => (activeSum > 0 ? w / activeSum : 0));

    // Rounding each month independently leaves the year short or long by a
    // paisa or two, and a finance system that does not foot exactly invites
    // the wrong argument in a review. The residual is carried onto the last
    // planned month so the twelve months sum to the target precisely.
    const monthPlan = normalised.map((w) => M.round(spec.t * w, 4));
    const lastPlanned = monthPlan.reduce((acc, v, i) => (v > 0 ? i : acc), -1);
    if (lastPlanned >= 0) {
      const drift = M.round(spec.t - monthPlan.reduce((a, b) => a + b, 0), 4);
      monthPlan[lastPlanned] = M.round(monthPlan[lastPlanned] + drift, 4);
    }

    const closedIdx = periods.indexOf(closedThrough);
    const submitIdx = periods.indexOf(submissionPeriod);
    let bookedPtd = 0;

    periods.forEach((period, i) => {
      const plan = monthPlan[i];
      const isClosed = i <= closedIdx;
      const isSubmissionMonth = i === submitIdx;

      let actual = null;
      let status = 'draft';
      let submittedBy = null;
      let submittedAt = null;
      let approvedBy = null;
      let approvedAt = null;
      let remarks = null;
      let rejectionNote = null;

      if (plan > 0 && (isClosed || isSubmissionMonth)) {
        // Performance band. A small deterministic slice of initiatives is
        // pushed into genuine underperformance so the red/amber states on the
        // dashboard are real rather than cosmetic.
        const struggling = r() < 0.18;
        const band = struggling ? between(r, 0.42, 0.74) : between(r, 0.86, 1.16);
        actual = M.round(plan * band, 4);

        if (isSubmissionMonth) {
          // The closed month is mid-cycle: most submitted and awaiting
          // approval, a few already approved, a couple returned, a couple not
          // yet entered. This is what gives the approvals queue real work.
          const dice = r();
          if (dice < 0.12) {
            status = 'draft';
            submittedBy = owner.id;
          } else if (dice < 0.22) {
            status = 'rejected';
            submittedBy = owner.id;
            submittedAt = isoAt(period, 4);
            rejectionNote = 'Benefit basis not agreed with Finance. Please attach the reconciliation and resubmit.';
          } else if (dice < 0.42) {
            status = 'approved';
            submittedBy = owner.id;
            submittedAt = isoAt(period, 3);
            approvedBy = approverFor(spec.bu, users).id;
            approvedAt = isoAt(period, 6);
          } else {
            status = 'submitted';
            submittedBy = owner.id;
            submittedAt = isoAt(period, 5);
          }
        } else {
          status = 'approved';
          submittedBy = owner.id;
          submittedAt = isoAt(period, 3);
          approvedBy = approverFor(spec.bu, users).id;
          approvedAt = isoAt(period, 6);
        }

        if (status === 'approved' || status === 'submitted') {
          remarks = pick([
            'Booked against the agreed baseline; reconciliation attached.',
            'Verified with the plant finance controller.',
            'Includes one-off benefit from the contract reset.',
            'Run rate achieved from the second fortnight.',
            'Partial month - full benefit expected from next month.',
          ], r);
        }
        if (status === 'approved' && isClosed) bookedPtd += actual;
      }

      initiativeMonths.push({
        id: monthId++,
        initiative_id: id,
        period,
        plan_cr: plan,
        actual_cr: actual,
        actual_status: status,
        remarks,
        submitted_by: submittedBy,
        submitted_at: submittedAt,
        approved_by: approvedBy,
        approved_at: approvedAt,
        rejection_note: rejectionNote,
        updated_at: isoAt(period, 6),
      });
    });

    /* --------------------------- derived state --------------------------- */
    const planClosed = monthPlan.slice(0, closedIdx + 1).reduce((a, b) => a + b, 0);
    const achievement = planClosed > 0 ? (bookedPtd / planClosed) * 100 : null;

    let status;
    if (startOffset > 0 && r() < 0.10) status = 'not_started';
    else if (r() < 0.08) status = 'on_hold';
    else if (achievement !== null && achievement < 60) status = 'at_risk';
    else if (r() < 0.10) status = 'completed';
    else status = 'in_progress';

    const health = M.computedHealth({
      achievementPct: achievement,
      dueDate: due,
      status,
      today,
    });

    const progress = status === 'completed'
      ? 100
      : M.round(Math.min(96, Math.max(4, (achievement || 40) * 0.72 + between(r, -6, 10))), 0);

    const priority = spec.t >= 3 ? 'critical' : spec.t >= 2.2 ? 'high' : spec.t >= 1.5 ? 'medium' : 'low';

    initiatives.push({
      id,
      code,
      title: spec.title,
      description: `${spec.desc} [SYNTHETIC]`,
      bu_code: spec.bu,
      business_unit_id: buId.get(spec.bu),
      department_id: dept.id,
      department_name: dept.name,
      owner_id: owner.id,
      owner_name: owner.name,
      owner_name_raw: owner.name,
      category: spec.cat,
      category_name: (C.CATEGORIES.find((c) => c.code === spec.cat) || {}).name || spec.cat,
      status,
      priority,
      health,
      health_computed: health,
      progress_pct: progress,
      target_savings_cr: spec.t,
      start_date: start,
      due_date: due,
      is_active: true,
      created_by: userByEmp.get('visl.pmo1').id,
      updated_by: owner.id,
      created_at: `${periods[0]}T04:30:00.000Z`,
      updated_at: isoAt(closedThrough, 8),
    });

    /* ------------------------------- tasks ------------------------------- */
    const taskCount = 4 + Math.floor(r() * 4);
    const contributors = users.filter((u) => u.home_bu === spec.bu && ['contributor', 'owner'].includes(u.role));
    for (let t = 0; t < taskCount; t += 1) {
      const doneShare = progress / 100;
      const tRoll = r();
      let tStatus;
      if (t / taskCount < doneShare - 0.15) tStatus = 'done';
      else if (t / taskCount < doneShare) tStatus = tRoll < 0.6 ? 'in_progress' : 'review';
      else if (tRoll < 0.08) tStatus = 'blocked';
      else tStatus = 'todo';

      const plannedStart = periods[Math.min(11, startOffset + Math.floor(t * 1.2))];
      const plannedEnd = M.addMonths(plannedStart, 1 + Math.floor(r() * 2));
      tasks.push({
        id: taskId++,
        initiative_id: id,
        bu_code: spec.bu,
        code: `${code}-T${String(t + 1).padStart(2, '0')}`,
        title: C.TASK_TEMPLATES[t % C.TASK_TEMPLATES.length],
        description: null,
        assignee_id: (contributors.length ? pick(contributors, r) : owner).id,
        status: tStatus,
        priority: t === 0 ? 'high' : pick(['low', 'medium', 'medium', 'high'], r),
        weight: 1,
        progress_pct: tStatus === 'done' ? 100 : tStatus === 'in_progress' ? Math.round(between(r, 25, 80)) : tStatus === 'review' ? 90 : 0,
        planned_start: plannedStart,
        planned_end: plannedEnd,
        actual_start: tStatus === 'todo' ? null : plannedStart,
        actual_end: tStatus === 'done' ? plannedEnd : null,
        estimated_savings_cr: M.round(spec.t / taskCount, 3),
        created_by: owner.id,
        created_at: `${plannedStart}T05:00:00.000Z`,
        updated_at: isoAt(closedThrough, 12),
      });
    }

    /* ---------------------------- milestones ----------------------------- */
    const msCount = 3 + Math.floor(r() * 3);
    for (let m = 0; m < msCount; m += 1) {
      const dueP = M.addMonths(periods[startOffset], 2 + m * 2);
      const past = dueP <= closedThrough;
      milestones.push({
        id: msId++,
        initiative_id: id,
        bu_code: spec.bu,
        title: C.MILESTONE_TEMPLATES[m % C.MILESTONE_TEMPLATES.length],
        due_date: dueP,
        completed_at: past && r() < 0.78 ? dueP : null,
        status: past ? (r() < 0.78 ? 'achieved' : 'missed') : 'open',
        sort_order: (m + 1) * 10,
        created_at: `${periods[startOffset]}T05:00:00.000Z`,
      });
    }

    /* ------------------------------- risks ------------------------------- */
    const riskCount = health === 'red' ? 2 + Math.floor(r() * 2) : Math.floor(r() * 3);
    for (let k = 0; k < riskCount; k += 1) {
      const tpl = C.RISK_TEMPLATES[(idx + k) % C.RISK_TEMPLATES.length];
      const impact = health === 'red' ? 'high' : pick(['low', 'medium', 'medium', 'high'], r);
      risks.push({
        id: riskId++,
        initiative_id: id,
        bu_code: spec.bu,
        title: tpl.title,
        description: null,
        impact,
        likelihood: pick(['low', 'medium', 'high'], r),
        mitigation: tpl.mitigation,
        owner_id: owner.id,
        status: r() < 0.25 ? 'mitigating' : r() < 0.15 ? 'closed' : 'open',
        due_date: M.addMonths(closedThrough, 1 + Math.floor(r() * 3)),
        created_by: owner.id,
        created_at: isoAt(periods[Math.min(11, startOffset + 1)], 10),
      });
    }

    /* ------------------------------ comments ----------------------------- */
    if (r() < 0.55) {
      const pmo = approverFor(spec.bu, users);
      comments.push({
        id: commentId++,
        entity_type: 'initiative',
        entity_id: id,
        user_id: pmo.id,
        user_name: pmo.name,
        body: pick([
          'Please attach the Finance-signed baseline before the next booking.',
          'Booking methodology agreed in the monthly review. Continue on this basis.',
          'Trending below plan for two consecutive months - flag the recovery actions.',
          'Good recovery this month. Hold the run rate through the quarter.',
          'Raised at the VISL review. Additional support agreed on vendor mobilisation.',
        ], r),
        created_at: isoAt(closedThrough, 9),
      });
    }
  });

  /* --------------------------- audit trail sample -------------------------- */
  initiativeMonths
    .filter((m) => m.actual_status === 'approved')
    .slice(-60)
    .forEach((m) => {
      auditLog.push({
        id: auditId++,
        user_id: m.approved_by,
        actor_name: (users.find((u) => u.id === m.approved_by) || {}).name || 'System',
        action: 'actual.approve',
        entity_type: 'initiative_month',
        entity_id: m.id,
        details: `Approved ${m.actual_cr} Cr for ${M.periodLabel(m.period)}`,
        ip: '10.42.0.0',
        created_at: m.approved_at,
      });
    });

  /* ----------------------------- notifications ---------------------------- */
  const notifications = [];
  let notifId = 1;
  initiativeMonths
    .filter((m) => m.actual_status === 'submitted')
    .slice(0, 40)
    .forEach((m) => {
      const init = initiatives.find((i) => i.id === m.initiative_id);
      const approver = approverFor(init.bu_code, users);
      notifications.push({
        id: notifId++,
        user_id: approver.id,
        type: 'approval_pending',
        title: `Approval pending: ${init.code}`,
        body: `${init.title} - ${M.periodLabel(m.period)} actual of Rs ${m.actual_cr} Cr is awaiting your approval.`,
        link: `/approvals?initiative=${init.id}`,
        is_read: false,
        created_at: m.submitted_at,
      });
    });
  initiativeMonths
    .filter((m) => m.actual_status === 'rejected')
    .forEach((m) => {
      const init = initiatives.find((i) => i.id === m.initiative_id);
      notifications.push({
        id: notifId++,
        user_id: init.owner_id,
        type: 'actual_returned',
        title: `Returned for revision: ${init.code}`,
        body: m.rejection_note,
        link: `/initiatives/${init.id}`,
        is_read: false,
        created_at: m.submitted_at,
      });
    });

  const settings = {
    'reporting.fy_label': 'FY 2026-27',
    'reporting.fy_start': fyStart,
    'reporting.closed_through': closedThrough,
    'reporting.submission_period': submissionPeriod,
    'approval.mode': 'central',
    'approval.self_approval_allowed': 'false',
    'display.currency': 'INR_CR',
    'display.default_basis': 'plan_to_date',
    'mail.digest_enabled': 'true',
    'mail.reminder_day': '5',
    'dataset.kind': 'synthetic',
  };

  return {
    generatedAt: new Date().toISOString(),
    today: today.toISOString(),
    periods,
    closedThrough,
    submissionPeriod,
    fyStart,
    businessUnits,
    departments,
    users,
    categories: C.CATEGORIES,
    initiatives,
    initiativeMonths,
    tasks,
    milestones,
    risks,
    comments,
    notifications,
    auditLog,
    settings,
  };
}

/** The PMO account that owns approvals for a unit under the default policy. */
function approverFor(buCode, users) {
  const unit = H.get(buCode);
  const parent = unit && unit.parent ? unit.parent : 'VISL';
  return (
    users.find((u) => u.role === 'bu_pmo' && u.home_bu === parent)
    || users.find((u) => u.role === 'bu_pmo' && u.home_bu === buCode)
    || users.find((u) => u.role === 'visl_pmo')
  );
}

function isoAt(period, dayOffset) {
  const [y, m] = String(period).split('-').map(Number);
  // Bookings and approvals happen in the month FOLLOWING the reporting period.
  const d = new Date(Date.UTC(y, m, 1 + dayOffset, 6, 30, 0));
  return d.toISOString();
}

module.exports = { generate, PLAN_WEIGHTS };
