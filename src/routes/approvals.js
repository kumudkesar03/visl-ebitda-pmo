'use strict';

const express = require('express');
const repo = require('../data');
const rbac = require('../domain/rbac');
const M = require('../domain/metrics');
const notify = require('../services/notifications');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermission(rbac.PERMISSIONS.ACTUAL_APPROVE));

/**
 * Approvals.
 *
 * This is the route text.txt section 13.1 calls out as the most serious
 * instance of the missing scope filter: in the ESL build an ESL PMO user could
 * approve IOB monthly actuals, with the approval recorded in the audit trail
 * under their name. It is a governance failure, not a cosmetic one.
 *
 * Three checks stand between a request and an approval here, and every one of
 * them is applied per row rather than once for the request:
 *
 *   1. the row is inside the caller's readable business units,
 *   2. the caller holds approval authority over that unit under the configured
 *      approval policy (local / central / visl),
 *   3. the caller is not the person who submitted it.
 */

async function policy() {
  const s = await repo.settings();
  return {
    mode: s['approval.mode'] || 'local',
    selfAllowed: s['approval.self_approval_allowed'] === 'true',
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { mode, selfAllowed } = await policy();
    const rows = await repo.approvalQueue(req.scope, req.query);

    const decorated = rows.map((row) => {
      const authorised = rbac.canApprove(req.user, row.bu_code, mode);
      const isSelf = rbac.isSelfApproval(req.user, row);
      return {
        ...row,
        can_approve: authorised && (selfAllowed || !isSelf),
        blocked_reason: !authorised
          ? `Approval for ${row.bu_code} rests with ${rbac.approvalAuthorityFor(row.bu_code, mode)} under the current policy.`
          : (!selfAllowed && isSelf ? 'You submitted this entry. It must be approved by someone else.' : null),
      };
    });

    res.json({
      rows: decorated,
      mine: decorated.filter((r) => r.can_approve).length,
      policy: { mode, self_approval_allowed: selfAllowed },
      totals: {
        count: decorated.length,
        value_cr: M.round(decorated.reduce((a, r) => a + (r.actual_cr || 0), 0), 4),
        approvable_cr: M.round(decorated.filter((r) => r.can_approve).reduce((a, r) => a + (r.actual_cr || 0), 0), 4),
      },
    });
  } catch (err) { next(err); }
});

/** Decide one entry. `decision` is approve | reject | reopen. */
// \d+ so that /bulk/:decision below is not swallowed with monthId = 'bulk'.
router.post('/:monthId(\\d+)/:decision', async (req, res, next) => {
  try {
    const { decision } = req.params;
    if (!['approve', 'reject', 'reopen'].includes(decision)) {
      return res.status(400).json({ error: 'Unknown decision.' });
    }
    if (decision === 'reopen' && !rbac.can(req.user, rbac.PERMISSIONS.ACTUAL_REOPEN)) {
      return res.status(403).json({ error: 'Your role cannot reopen an approved month.' });
    }

    const result = await decide(req, Number(req.params.monthId), decision, req.body.note);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ month: result.month });
  } catch (err) { next(err); }
});

/**
 * Bulk decision.
 *
 * Each row is authorised individually and the response reports per row. A
 * caller who selects thirty rows including four they may not approve gets
 * twenty-six approvals and four explicit refusals - never a silent partial
 * success, and never all-or-nothing on a queue this size.
 */
router.post('/bulk/:decision', async (req, res, next) => {
  try {
    const { decision } = req.params;
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: 'Bulk action must be approve or reject.' });
    }
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
    if (!ids.length) return res.status(400).json({ error: 'Select at least one entry.' });
    if (decision === 'reject' && !String(req.body.note || '').trim()) {
      return res.status(400).json({ error: 'A reason is required when returning entries for revision.' });
    }

    const results = [];
    for (const id of ids) {
      const r = await decide(req, id, decision, req.body.note);
      results.push({ id, ok: !r.error, error: r.error || null });
    }
    res.json({
      results,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    });
  } catch (err) { next(err); }
});

/** Shared decision path, so single and bulk cannot diverge in their checks. */
async function decide(req, monthId, decision, note) {
  const { mode, selfAllowed } = await policy();
  const queue = await repo.approvalQueue(req.scope);
  let row = queue.find((q) => q.id === monthId);

  // Reopen acts on an already-approved row, which is not in the queue.
  if (!row && decision === 'reopen') {
    const ctx = await repo.reportingContext(req.scope);
    const raw = ctx.monthRows.find((m) => m.id === monthId);
    if (raw) {
      const init = ctx.initiatives.find((i) => i.id === raw.initiative_id);
      row = { ...raw, bu_code: init.bu_code, initiative_id: init.id };
    }
  }
  if (!row) return { error: 'Entry not found, or outside your access.', status: 404 };

  if (!rbac.canApprove(req.user, row.bu_code, mode)) {
    return {
      status: 403,
      error: `You do not hold approval authority for ${row.bu_code}. Under the "${mode}" policy that rests with ${rbac.approvalAuthorityFor(row.bu_code, mode)}.`,
    };
  }
  if (!selfAllowed && rbac.isSelfApproval(req.user, row)) {
    return { status: 403, error: 'You submitted this entry. It must be approved by someone else.' };
  }

  const month = await repo.decideActual(monthId, decision, req.user, note);
  const initiative = await repo.getInitiative(row.initiative_id, req.scope);
  if (initiative) notify.onActualDecided(initiative, month, req.user, decision, note);
  return { month: { ...month, label: M.periodLabel(month.period) } };
}

module.exports = router;
