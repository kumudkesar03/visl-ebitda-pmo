'use strict';

const express = require('express');
const repo = require('../data');
const M = require('../domain/metrics');
const H = require('../domain/hierarchy');
const rbac = require('../domain/rbac');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/**
 * Reporting endpoints.
 *
 * Every response is built from the roll-up in src/domain/metrics.js over the
 * caller's own scope, so two users looking at "VISL" see the same arithmetic
 * and a user without VISL access simply cannot request it.
 */

/**
 * "Needs attention", defined once.
 *
 * The dashboard and the executive board must not disagree about which
 * initiatives are in trouble - a CEO shown ten and a PMO lead shown none, from
 * the same data on the same morning, destroys trust in both screens.
 *
 * An initiative qualifies when it is off track on health, flagged at risk by
 * its owner, or carrying an open risk WHILE also running behind plan. An open
 * risk on an initiative delivering ahead of plan is a risk being managed, not
 * one for a board pack.
 */
function needsAttention(inits) {
  return inits
    .filter((i) => {
      const achv = i.achievement_ptd.pct;
      const behind = achv !== null && achv < 90;
      return i.health === 'red' || i.status === 'at_risk' || (i.open_risks > 0 && behind);
    })
    .map((i) => ({
      ...i,
      // Exposure: money still to come, weighted up where health is worse.
      exposure: (i.target_savings_cr - i.booked_fy_cr) * (i.health === 'red' ? 2 : i.health === 'amber' ? 1.3 : 1),
    }))
    .sort((a, b) => b.exposure - a.exposure);
}

/** Resolve the requested node, refusing anything outside the caller's scope. */
function resolveNode(req) {
  const requested = String(req.query.bu || '').toUpperCase();
  if (requested && !H.exists(requested)) return { error: `Unknown business unit "${requested}".` };
  if (requested && !req.scope.includes(requested)) {
    return { error: `Your access does not extend to ${requested}.` };
  }
  // Default to the highest node the user can see, which is their own top level.
  return { code: requested || req.scope[0] };
}

async function buildRollup(req) {
  const ctx = await repo.reportingContext(req.scope);
  const roll = M.rollup({
    initiatives: ctx.initiatives,
    monthRows: ctx.monthRows,
    periods: ctx.periods,
    closedThrough: ctx.closedThrough,
  });
  return { ctx, roll };
}

/* --------------------------------------------------------------------- *
 * Dashboard
 * --------------------------------------------------------------------- */

router.get('/dashboard', async (req, res, next) => {
  try {
    const node = resolveNode(req);
    if (node.error) return res.status(403).json({ error: node.error });

    const { ctx, roll } = await buildRollup(req);
    const selected = roll.nodes[node.code];
    if (!selected) return res.status(404).json({ error: 'No data for that unit.' });

    const inits = await repo.listInitiatives(req.scope, { bu: node.code });

    // Children of the selected node, for the league table. A leaf shows its
    // own departments instead, so the table is never empty.
    const children = H.childrenOf(node.code);
    const breakdown = children.length
      ? children.map((c) => summarise(roll.nodes[c.code], c.code, c.name, c.accent))
      : departmentBreakdown(inits);

    const byCategory = groupBy(inits, 'category').map(([code, rows]) => {
      const cat = (ctx.categories || []).find((c) => c.code === code) || {};
      return {
        code,
        name: rows[0].category_name || code,
        accent: cat.accent,
        target_cr: sum(rows, 'target_savings_cr'),
        booked_ptd_cr: sum(rows, 'booked_ptd_cr'),
        plan_ptd_cr: sum(rows, 'plan_ptd_cr'),
        count: rows.length,
      };
    }).sort((a, b) => b.target_cr - a.target_cr);

    res.json({
      node: selected.bu,
      window: roll.window,
      headline: strip(selected),
      series: selected.series,
      breakdown,
      byCategory,
      atRisk: needsAttention(inits).slice(0, 8),
      topDelivering: inits
        .filter((i) => i.booked_ptd_cr > 0)
        .sort((a, b) => b.booked_ptd_cr - a.booked_ptd_cr)
        .slice(0, 8),
      counts: {
        initiatives: selected.initiative_count,
        status: selected.status_counts,
        health: selected.health_counts,
        awaitingApproval: (await repo.approvalQueue(req.scope, { bu: node.code })).length,
      },
    });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------- *
 * Executive board
 * --------------------------------------------------------------------- */

/**
 * The CEO/CFO view. Deliberately a different endpoint from /dashboard rather
 * than a flag on it, because the questions differ: the dashboard asks "what is
 * my team doing this month", the board asks "will the year land, and where is
 * the risk concentrated".
 */
router.get('/exec/board', requirePermission(rbac.PERMISSIONS.EXEC_BOARD_VIEW), async (req, res, next) => {
  try {
    const node = resolveNode(req);
    if (node.error) return res.status(403).json({ error: node.error });

    const { roll } = await buildRollup(req);
    const selected = roll.nodes[node.code];
    const inits = await repo.listInitiatives(req.scope, { bu: node.code });

    // Full hierarchy table, indented, every visible node.
    const hierarchy = roll.order
      .filter((c) => H.descendantsOf(node.code).includes(c))
      .map((c) => {
        const n = roll.nodes[c];
        return { ...summarise(n, c, n.bu.name, n.bu.accent), depth: n.bu.depth - selected.bu.depth, is_consolidated: n.bu.consolidated };
      });

    /**
     * Target-to-booked bridge. Each step is a real movement, so the bars add
     * to the endpoint rather than being an illustration: the year's commitment
     * less what is already banked, less what is submitted and awaiting
     * approval, less the plan still ahead of us, leaves the unplanned gap.
     */
    const bridge = [
      { key: 'target', label: 'Full-year target', value: selected.target_cr, kind: 'total' },
      { key: 'booked', label: 'Banked (approved)', value: -selected.booked_fy_cr, kind: 'positive' },
      { key: 'pipeline', label: 'Awaiting approval', value: -selected.submitted_cr, kind: 'pipeline' },
      { key: 'planned', label: 'Planned, months ahead', value: -selected.open_plan_cr, kind: 'planned' },
      { key: 'gap', label: 'Unplanned gap', kind: 'gap' },
    ];
    const consumed = selected.booked_fy_cr + selected.submitted_cr + selected.open_plan_cr;
    bridge[4].value = M.round(Math.max(0, selected.target_cr - consumed), 4);

    const attention = needsAttention(inits).slice(0, 10);

    res.json({
      node: selected.bu,
      window: roll.window,
      headline: strip(selected),
      series: selected.series,
      hierarchy,
      bridge,
      concentration: concentration(inits),
      risks: attention,
      laggards: hierarchy
        .filter((h) => !h.is_consolidated && h.achievement_pct !== null)
        .sort((a, b) => a.achievement_pct - b.achievement_pct)
        .slice(0, 4),
      generated_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------- *
 * Savings matrix - the month-by-month grid
 * --------------------------------------------------------------------- */

router.get('/matrix', async (req, res, next) => {
  try {
    const node = resolveNode(req);
    if (node.error) return res.status(403).json({ error: node.error });
    const { ctx, roll } = await buildRollup(req);
    const inits = await repo.listInitiatives(req.scope, { bu: node.code });
    const ids = new Set(inits.map((i) => i.id));

    const byInit = new Map(inits.map((i) => [i.id, {
      id: i.id, code: i.code, title: i.title, bu_code: i.bu_code,
      owner_name: i.owner_name, department_name: i.department_name,
      target_savings_cr: i.target_savings_cr,
      cells: {},
    }]));

    for (const m of ctx.monthRows) {
      if (!ids.has(m.initiative_id)) continue;
      byInit.get(m.initiative_id).cells[m.period] = {
        plan_cr: m.plan_cr,
        actual_cr: m.actual_cr,
        status: m.actual_status,
      };
    }

    res.json({
      node: roll.nodes[node.code].bu,
      periods: ctx.periods.map((p) => ({ period: p, label: M.periodLabel(p) })),
      window: roll.window,
      rows: [...byInit.values()].sort((a, b) => a.code.localeCompare(b.code)),
      totals: roll.nodes[node.code].series,
    });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------- *
 * Leaderboard
 * --------------------------------------------------------------------- */

router.get('/leaderboard', async (req, res, next) => {
  try {
    const node = resolveNode(req);
    if (node.error) return res.status(403).json({ error: node.error });
    const inits = await repo.listInitiatives(req.scope, { bu: node.code });

    const byOwner = groupBy(inits, 'owner_id').map(([ownerId, rows]) => ({
      owner_id: Number(ownerId),
      owner_name: rows[0].owner_name,
      bu_code: rows[0].bu_code,
      initiatives: rows.length,
      target_cr: sum(rows, 'target_savings_cr'),
      plan_ptd_cr: sum(rows, 'plan_ptd_cr'),
      booked_ptd_cr: sum(rows, 'booked_ptd_cr'),
      red: rows.filter((r) => r.health === 'red').length,
      overdue_tasks: sum(rows, 'task_overdue'),
    })).map((o) => ({
      ...o,
      achievement: M.ratio(o.booked_ptd_cr, o.plan_ptd_cr, 'plan-to-date', 'closed months'),
    })).sort((a, b) => {
      const ap = a.achievement.pct === null ? -1 : a.achievement.pct;
      const bp = b.achievement.pct === null ? -1 : b.achievement.pct;
      return bp - ap || b.booked_ptd_cr - a.booked_ptd_cr;
    });

    const byDepartment = departmentBreakdown(inits);
    res.json({ byOwner, byDepartment });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------- *
 * helpers
 * --------------------------------------------------------------------- */

function summarise(n, code, name, accent) {
  return {
    code,
    name,
    accent,
    initiative_count: n.initiative_count,
    target_cr: n.target_cr,
    plan_fy_cr: n.plan_fy_cr,
    plan_ptd_cr: n.plan_ptd_cr,
    booked_ptd_cr: n.booked_ptd_cr,
    booked_fy_cr: n.booked_fy_cr,
    submitted_cr: n.submitted_cr,
    variance_ptd_cr: n.variance_ptd_cr,
    achievement_pct: n.achievement_ptd.pct,
    target_delivered_pct: n.target_delivered.pct,
    health_counts: n.health_counts,
  };
}

/** Only the scalar fields - the month series is returned separately. */
function strip(n) {
  const { series, bu, ...rest } = n;
  return rest;
}

function departmentBreakdown(inits) {
  return groupBy(inits, 'department_name').map(([name, rows]) => {
    const plan = sum(rows, 'plan_ptd_cr');
    const booked = sum(rows, 'booked_ptd_cr');
    return {
      code: name,
      name,
      initiative_count: rows.length,
      target_cr: sum(rows, 'target_savings_cr'),
      plan_ptd_cr: plan,
      booked_ptd_cr: booked,
      booked_fy_cr: sum(rows, 'booked_fy_cr'),
      submitted_cr: sum(rows, 'submitted_cr'),
      variance_ptd_cr: M.round(booked - plan, 4),
      achievement_pct: M.ratio(booked, plan, 'plan-to-date', 'closed months').pct,
      health_counts: rows.reduce((a, r) => ({ ...a, [r.health]: (a[r.health] || 0) + 1 }), {}),
    };
  }).sort((a, b) => b.target_cr - a.target_cr);
}

/**
 * How much of the year's commitment rests on how few initiatives. A drive
 * where five initiatives carry sixty per cent of the target has a different
 * risk profile from one where fifty carry it evenly, and the board should be
 * told which one it is looking at.
 */
function concentration(inits) {
  const sorted = inits.slice().sort((a, b) => b.target_savings_cr - a.target_savings_cr);
  const total = sum(sorted, 'target_savings_cr');
  let running = 0;
  const points = sorted.map((i, idx) => {
    running += i.target_savings_cr;
    return {
      rank: idx + 1,
      code: i.code,
      title: i.title,
      target_cr: i.target_savings_cr,
      cumulative_pct: total > 0 ? M.round((running / total) * 100, 1) : 0,
    };
  });
  const top5 = points[4] ? points[4].cumulative_pct : (points[points.length - 1] || {}).cumulative_pct || 0;
  const top10 = points[9] ? points[9].cumulative_pct : (points[points.length - 1] || {}).cumulative_pct || 0;
  return { points: points.slice(0, 20), top5_pct: top5, top10_pct: top10, total_cr: M.round(total, 4) };
}

function groupBy(rows, field) {
  const map = new Map();
  for (const r of rows) {
    const k = r[field] === null || r[field] === undefined ? 'unassigned' : r[field];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.entries()];
}

function sum(rows, field) {
  return M.round(rows.reduce((a, r) => a + (Number(r[field]) || 0), 0), 4);
}

module.exports = router;
