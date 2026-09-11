'use strict';

const repo = require('../data');
const mailer = require('./mailer');
const rbac = require('../domain/rbac');
const H = require('../domain/hierarchy');
const M = require('../domain/metrics');

/**
 * Workflow notifications.
 *
 * One place decides WHO is told about a workflow event, so the answer cannot
 * drift between the in-app bell and the mail. Both are raised together here.
 *
 * Every function is best-effort: a mail server outage must never roll back an
 * approval that has already been recorded. Failures are logged and swallowed.
 */

/** The users who hold approval authority over a business unit, per policy. */
async function approversFor(buCode, mode) {
  const authority = rbac.approvalAuthorityFor(buCode, mode);
  const all = await repo.allUsers();
  const holders = all.filter((u) => u.is_active
    && rbac.can(u, rbac.PERMISSIONS.ACTUAL_APPROVE)
    && (u.home_bu === authority || H.descendantsOf(u.home_bu || '').includes(authority)));

  // Never leave a submission with nowhere to go. If the configured authority
  // has no active PMO account, it escalates to VISL PMO rather than sitting
  // invisible in a queue nobody owns.
  if (holders.length) return holders;
  return all.filter((u) => u.is_active && u.role === 'visl_pmo');
}

async function approvalMode() {
  const s = await repo.settings();
  return s['approval.mode'] || 'local';
}

async function onActualSubmitted(initiative, month, submitter) {
  try {
    const mode = await approvalMode();
    const approvers = await approversFor(initiative.bu_code, mode);
    const label = M.periodLabel(month.period);
    for (const approver of approvers) {
      await repo.pushNotification(approver.id, {
        type: 'approval_pending',
        title: `Approval pending: ${initiative.code}`,
        body: `${initiative.title} - ${label} actual of Rs ${month.actual_cr} Cr submitted by ${submitter.name}.`,
        link: '/approvals',
      });
      await mailer.send('actual_submitted', approver.email, {
        initiative, month: { ...month, label }, submitter, approver,
      });
    }
  } catch (err) {
    console.error('[notify] onActualSubmitted:', err.message);
  }
}

async function onActualDecided(initiative, month, decider, decision, note) {
  try {
    const owner = await repo.findUserById(initiative.owner_id);
    if (!owner) return;
    const label = M.periodLabel(month.period);

    if (decision === 'approve') {
      await repo.pushNotification(owner.id, {
        type: 'actual_approved',
        title: `Approved: ${initiative.code} ${label}`,
        body: `Rs ${month.actual_cr} Cr is now booked against the drive.`,
        link: `/initiatives/${initiative.id}`,
      });
      await mailer.send('actual_approved', owner.email, {
        initiative, month: { ...month, label }, approver: decider,
      });
    } else if (decision === 'reject') {
      await repo.pushNotification(owner.id, {
        type: 'actual_returned',
        title: `Returned for revision: ${initiative.code} ${label}`,
        body: note || 'Returned for revision.',
        link: `/initiatives/${initiative.id}`,
      });
      await mailer.send('actual_returned', owner.email, {
        initiative, month: { ...month, label }, approver: decider, note,
      });
    }
  } catch (err) {
    console.error('[notify] onActualDecided:', err.message);
  }
}

/**
 * Monthly submission reminder. Sent to owners with an unsubmitted actual for
 * the collection month, one mail per owner listing everything outstanding
 * rather than one mail per initiative.
 */
async function sendSubmissionReminders({ period } = {}) {
  const s = await repo.settings();
  const target = period || s['reporting.submission_period'];
  const all = H.descendantsOf(H.ROOT);
  const ctx = await repo.reportingContext(all);

  const outstanding = ctx.monthRows.filter((m) => m.period === target
    && m.plan_cr > 0
    && !['submitted', 'approved'].includes(m.actual_status));

  const byOwner = new Map();
  for (const m of outstanding) {
    const init = ctx.initiatives.find((i) => i.id === m.initiative_id);
    if (!init || !init.owner_id) continue;
    if (!byOwner.has(init.owner_id)) byOwner.set(init.owner_id, []);
    byOwner.get(init.owner_id).push({ ...init, plan_cr: m.plan_cr });
  }

  const sent = [];
  for (const [ownerId, pending] of byOwner) {
    const user = await repo.findUserById(ownerId);
    if (!user || !user.is_active) continue;
    await repo.pushNotification(user.id, {
      type: 'submission_due',
      title: `${M.periodLabel(target)} actuals due`,
      body: `${pending.length} initiative(s) awaiting your submission.`,
      link: '/my-work',
    });
    const rec = await mailer.send('submission_reminder', user.email, {
      user, period: M.periodLabel(target), pending,
    });
    sent.push({ to: user.email, count: pending.length, id: rec.id });
  }
  return sent;
}

/** Weekly leadership digest, scoped to each recipient's own visibility. */
async function sendExecDigest() {
  const all = await repo.allUsers();
  const recipients = all.filter((u) => u.is_active && ['visl_exec', 'visl_pmo', 'bu_pmo'].includes(u.role));

  const sent = [];
  for (const user of recipients) {
    const scope = rbac.readScope(user);
    if (!scope.length) continue;
    const ctx = await repo.reportingContext(scope);
    const roll = M.rollup({
      initiatives: ctx.initiatives,
      monthRows: ctx.monthRows,
      periods: ctx.periods,
      closedThrough: ctx.closedThrough,
    });
    const rootCode = scope[0];
    const node = roll.nodes[rootCode];
    if (!node) continue;

    const rows = H.childrenOf(rootCode).map((c) => {
      const n = roll.nodes[c.code];
      return [
        c.code,
        n.target_cr.toFixed(2),
        n.booked_ptd_cr.toFixed(2),
        n.achievement_ptd.pct === null ? '--' : `${n.achievement_ptd.pct.toFixed(1)}%`,
      ];
    });

    const rec = await mailer.send('exec_digest', user.email, {
      user, node, rows, window: roll.window,
    });
    sent.push({ to: user.email, node: rootCode, id: rec.id });
  }
  return sent;
}

module.exports = {
  approversFor, approvalMode,
  onActualSubmitted, onActualDecided,
  sendSubmissionReminders, sendExecDigest,
};
