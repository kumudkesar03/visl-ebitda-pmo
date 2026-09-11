'use strict';

const express = require('express');
const repo = require('../data');
const rbac = require('../domain/rbac');
const H = require('../domain/hierarchy');
const M = require('../domain/metrics');
const notify = require('../services/notifications');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const P = rbac.PERMISSIONS;

/* --------------------------------------------------------------------- *
 * Authorisation helpers
 * --------------------------------------------------------------------- */

/**
 * Load an initiative the caller may see, or null.
 * Scope is applied inside the repository, so a record outside the caller's
 * business units is indistinguishable from one that does not exist.
 */
async function load(req) {
  return repo.getInitiative(req.params.id, req.scope);
}

/**
 * May this user change this initiative?
 *
 * Three gates, all of which must pass:
 *   1. the initiative is inside their writable business units,
 *   2. they hold either edit-any, or edit-own and they are the owner,
 *   3. read-only roles never reach here because they hold neither permission.
 */
function canEdit(user, initiative) {
  if (!rbac.canWriteBu(user, initiative.bu_code)) return false;
  if (rbac.can(user, P.INITIATIVE_EDIT_ANY)) return true;
  return rbac.can(user, P.INITIATIVE_EDIT_OWN) && initiative.owner_id === user.id;
}

function canBookActual(user, initiative) {
  if (!rbac.canWriteBu(user, initiative.bu_code)) return false;
  if (rbac.can(user, P.ACTUAL_SUBMIT_ANY)) return true;
  return rbac.can(user, P.ACTUAL_SUBMIT_OWN) && initiative.owner_id === user.id;
}

function deny(res, reason) {
  return res.status(403).json({ error: reason });
}

/* --------------------------------------------------------------------- *
 * List and detail
 * --------------------------------------------------------------------- */

router.get('/', async (req, res, next) => {
  try {
    const { bu } = req.query;
    if (bu && !req.scope.includes(String(bu).toUpperCase())) {
      return deny(res, `Your access does not extend to ${bu}.`);
    }
    const rows = await repo.listInitiatives(req.scope, req.query);
    res.json({ rows, scope: req.scope });
  } catch (err) { next(err); }
});

/** Everything the caller may do to this record, so the UI never guesses. */
router.get('/:id', async (req, res, next) => {
  try {
    const row = await load(req);
    if (!row) return res.status(404).json({ error: 'Initiative not found.' });
    const settings = await repo.settings();
    res.json({
      initiative: row,
      can: {
        edit: canEdit(req.user, row),
        editPlan: rbac.can(req.user, P.PLAN_EDIT_ANY)
          || (rbac.can(req.user, P.PLAN_EDIT_OWN) && row.owner_id === req.user.id && rbac.canWriteBu(req.user, row.bu_code)),
        bookActual: canBookActual(req.user, row),
        approve: rbac.canApprove(req.user, row.bu_code, settings['approval.mode']),
        manageTasks: rbac.can(req.user, P.TASK_MANAGE_ANY)
          || (rbac.can(req.user, P.TASK_MANAGE_OWN) && row.owner_id === req.user.id),
        comment: rbac.can(req.user, P.COMMENT_WRITE),
      },
    });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------- *
 * Create and update
 * --------------------------------------------------------------------- */

router.post('/', requirePermission(P.INITIATIVE_CREATE), async (req, res, next) => {
  try {
    const bu = String(req.body.bu_code || '').toUpperCase();
    if (!rbac.canWriteBu(req.user, bu)) {
      return deny(res, `You can only raise initiatives in ${req.writeScope.join(', ') || 'no unit'}.`);
    }
    if (!req.body.title || !String(req.body.title).trim()) {
      return res.status(400).json({ error: 'A title is required.' });
    }
    const row = await repo.createInitiative(req.body, req.user);
    res.status(201).json({ initiative: row });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const row = await load(req);
    if (!row) return res.status(404).json({ error: 'Initiative not found.' });
    if (!canEdit(req.user, row)) {
      return deny(res, row.owner_id === req.user.id
        ? 'Your role does not allow editing initiatives.'
        : 'Only the initiative owner or the PMO office can change this record.');
    }
    const updated = await repo.updateInitiative(req.params.id, req.body, req.user);
    res.json({ initiative: updated });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------- *
 * Monthly plan
 * --------------------------------------------------------------------- */

/**
 * Replace the monthly plan grid.
 *
 * The plan is validated against the initiative's full-year target before it is
 * accepted. text.txt 13.3 records that plan figures previously arrived only
 * through CSV seeding; making them editable in the application is the point of
 * this endpoint, and validating the total is what stops the same mistake the
 * spreadsheet used to allow - a plan that does not add up to what was
 * committed.
 */
router.put('/:id/plan', async (req, res, next) => {
  try {
    const row = await load(req);
    if (!row) return res.status(404).json({ error: 'Initiative not found.' });

    const allowed = rbac.can(req.user, P.PLAN_EDIT_ANY)
      || (rbac.can(req.user, P.PLAN_EDIT_OWN) && row.owner_id === req.user.id);
    if (!allowed || !rbac.canWriteBu(req.user, row.bu_code)) {
      return deny(res, 'You cannot change the plan for this initiative.');
    }

    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
    // An approved month is a signed number. Changing the plan under it would
    // silently restate a variance leadership has already been shown.
    const locked = row.months.filter((m) => m.actual_status === 'approved').map((m) => m.period);
    const clash = entries.filter((e) => locked.includes(e.period)
      && M.round(Number(e.plan_cr), 4) !== M.round(row.months.find((m) => m.period === e.period).plan_cr, 4));
    if (clash.length) {
      return res.status(409).json({
        error: `Cannot change the plan for approved month(s): ${clash.map((c) => M.periodLabel(c.period)).join(', ')}. Ask the PMO office to reopen the month first.`,
      });
    }

    const total = entries.reduce((a, e) => a + (Number(e.plan_cr) || 0), 0);
    const target = Number(req.body.target_savings_cr ?? row.target_savings_cr) || 0;
    const drift = Math.abs(total - target);
    if (drift > 0.005 && !req.body.allow_mismatch) {
      return res.status(422).json({
        error: `The monthly plan totals Rs ${total.toFixed(2)} Cr against a full-year target of Rs ${target.toFixed(2)} Cr.`,
        detail: 'Adjust the months, change the target, or resubmit with allow_mismatch to record the gap deliberately.',
        total, target, drift: M.round(drift, 4),
      });
    }

    const months = await repo.setPlan(req.params.id, entries, req.user);
    if (req.body.target_savings_cr !== undefined) {
      await repo.updateInitiative(req.params.id, { target_savings_cr: target }, req.user);
    }
    res.json({ months, total: M.round(total, 4) });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------- *
 * Monthly actuals
 * --------------------------------------------------------------------- */

router.put('/:id/actuals/:period', async (req, res, next) => {
  try {
    const row = await load(req);
    if (!row) return res.status(404).json({ error: 'Initiative not found.' });
    if (!canBookActual(req.user, row)) {
      return deny(res, 'Only the initiative owner or the PMO office can book actuals against this initiative.');
    }

    const action = req.body.action === 'submit' ? 'submit' : 'save';
    if (action === 'submit' && (req.body.actual_cr === null || req.body.actual_cr === '' || req.body.actual_cr === undefined)) {
      return res.status(400).json({ error: 'Enter an actual figure before submitting for approval.' });
    }

    const month = await repo.saveActual(req.params.id, req.params.period, { ...req.body, action }, req.user);

    if (action === 'submit') {
      // Fire-and-forget: the submission is already recorded, and a mail
      // failure must not undo it.
      notify.onActualSubmitted(row, month, req.user);
    }
    res.json({ month: { ...month, label: M.periodLabel(month.period) } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

/* --------------------------------------------------------------------- *
 * Tasks, milestones, risks, comments
 * --------------------------------------------------------------------- */

function subResource(crud, entity, permAny, permOwn) {
  const r = express.Router({ mergeParams: true });

  r.post('/', async (req, res, next) => {
    try {
      const row = await load(req);
      if (!row) return res.status(404).json({ error: 'Initiative not found.' });
      const allowed = rbac.canWriteBu(req.user, row.bu_code)
        && (rbac.can(req.user, permAny) || (rbac.can(req.user, permOwn) && row.owner_id === req.user.id));
      if (!allowed) return deny(res, `You cannot add a ${entity} to this initiative.`);
      const created = await crud.create({
        ...req.body,
        initiative_id: row.id,
        bu_code: row.bu_code,
      }, req.user);
      res.status(201).json({ [entity]: created });
    } catch (err) { next(err); }
  });

  r.patch('/:childId', async (req, res, next) => {
    try {
      const row = await load(req);
      if (!row) return res.status(404).json({ error: 'Initiative not found.' });
      const isAssignee = entity === 'task'
        && rbac.can(req.user, P.TASK_UPDATE_ASSIGNED)
        && (row.tasks.find((t) => t.id === Number(req.params.childId)) || {}).assignee_id === req.user.id;
      const allowed = rbac.canWriteBu(req.user, row.bu_code)
        && (rbac.can(req.user, permAny)
          || (rbac.can(req.user, permOwn) && row.owner_id === req.user.id)
          || isAssignee);
      if (!allowed) return deny(res, `You cannot change this ${entity}.`);
      const updated = await crud.update(req.params.childId, req.body, req.user);
      if (!updated) return res.status(404).json({ error: `${entity} not found.` });
      res.json({ [entity]: updated });
    } catch (err) { next(err); }
  });

  r.delete('/:childId', async (req, res, next) => {
    try {
      const row = await load(req);
      if (!row) return res.status(404).json({ error: 'Initiative not found.' });
      const allowed = rbac.canWriteBu(req.user, row.bu_code)
        && (rbac.can(req.user, permAny) || (rbac.can(req.user, permOwn) && row.owner_id === req.user.id));
      if (!allowed) return deny(res, `You cannot remove this ${entity}.`);
      const ok = await crud.remove(req.params.childId, req.user);
      res.json({ ok });
    } catch (err) { next(err); }
  });

  return r;
}

router.use('/:id/tasks', subResource(repo.taskCrud, 'task', P.TASK_MANAGE_ANY, P.TASK_MANAGE_OWN));
router.use('/:id/milestones', subResource(repo.milestoneCrud, 'milestone', P.TASK_MANAGE_ANY, P.TASK_MANAGE_OWN));
router.use('/:id/risks', subResource(repo.riskCrud, 'risk', P.RISK_MANAGE_ANY, P.RISK_MANAGE_OWN));

router.post('/:id/comments', requirePermission(P.COMMENT_WRITE), async (req, res, next) => {
  try {
    const row = await load(req);
    if (!row) return res.status(404).json({ error: 'Initiative not found.' });
    if (!String(req.body.body || '').trim()) return res.status(400).json({ error: 'Comment cannot be empty.' });
    const comment = await repo.addComment('initiative', row.id, req.body.body.trim(), req.user);
    res.status(201).json({ comment });
  } catch (err) { next(err); }
});

module.exports = router;
