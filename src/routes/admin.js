'use strict';

const express = require('express');
const env = require('../config/env');
const repo = require('../data');
const rbac = require('../domain/rbac');
const H = require('../domain/hierarchy');
const mailer = require('../services/mailer');
const notify = require('../services/notifications');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const P = rbac.PERMISSIONS;

/* --------------------------------------------------------------------- *
 * Reference data - readable by any signed-in user, scoped
 * --------------------------------------------------------------------- */

router.get('/reference', async (req, res, next) => {
  try {
    const settings = await repo.settings();
    res.json({
      businessUnits: (await repo.businessUnits()).filter((b) => req.scope.includes(b.code)),
      departments: await repo.departments(req.scope),
      categories: await repo.categories(),
      users: await repo.users(req.scope),
      roles: rbac.ROLES,
      periods: (await repo.reportingContext(req.scope)).periods,
      settings: {
        fy_label: settings['reporting.fy_label'],
        closed_through: settings['reporting.closed_through'],
        submission_period: settings['reporting.submission_period'],
        approval_mode: settings['approval.mode'],
      },
      writeScope: req.writeScope,
    });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------- *
 * Users and roles
 * --------------------------------------------------------------------- */

router.get('/users', requirePermission(P.USER_MANAGE), async (req, res, next) => {
  try {
    const users = await repo.allUsers();
    res.json({
      users: users.map((u) => ({
        ...u,
        role_label: (rbac.ROLES[u.role] || {}).label,
        // The concrete list of units this account can see, so the effect of a
        // role change is visible before it is saved rather than after someone
        // reports seeing the wrong business unit.
        sees: rbac.readScope(u),
        can_write: rbac.writeScope(u),
      })),
      roles: rbac.ROLES,
      businessUnits: await repo.businessUnits(),
      authMode: env.auth.mode,
      dataMode: repo.mode(),
    });
  } catch (err) { next(err); }
});

router.post('/users', requirePermission(P.USER_MANAGE), async (req, res, next) => {
  try {
    const { employee_id: empId, name, role, home_bu: homeBu } = req.body;
    if (!empId || !name) return res.status(400).json({ error: 'User ID and name are required.' });
    if (!rbac.ROLE_CODES.includes(role)) return res.status(400).json({ error: 'Unknown role.' });
    if (!H.exists(homeBu)) return res.status(400).json({ error: 'Unknown business unit.' });
    if (await repo.findUserByEmployeeId(empId)) {
      return res.status(409).json({ error: `${empId} already exists.` });
    }
    const pwError = passwordProblem(req.body, true);
    if (pwError) return res.status(400).json({ error: pwError });
    const user = await repo.createUser(req.body, req.user);
    res.status(201).json({ user });
  } catch (err) { next(err); }
});

router.patch('/users/:id', requirePermission(P.USER_MANAGE), async (req, res, next) => {
  try {
    if (req.body.role && !rbac.ROLE_CODES.includes(req.body.role)) {
      return res.status(400).json({ error: 'Unknown role.' });
    }
    if (req.body.home_bu && !H.exists(req.body.home_bu)) {
      return res.status(400).json({ error: 'Unknown business unit.' });
    }
    const pwError = passwordProblem(req.body, false);
    if (pwError) return res.status(400).json({ error: pwError });
    // Losing the last administrator locks everyone out of user management with
    // no way back in short of a database edit.
    if (Number(req.params.id) === req.user.id
      && (req.body.role && req.body.role !== 'admin')) {
      const admins = (await repo.allUsers()).filter((u) => u.role === 'admin' && u.is_active);
      if (admins.length <= 1) {
        return res.status(409).json({ error: 'You are the only active administrator. Promote someone else first.' });
      }
    }
    const user = await repo.updateUser(req.params.id, req.body, req.user);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: { ...user, sees: rbac.readScope(user) } });
  } catch (err) { next(err); }
});

/** The permission matrix, rendered as data so the UI can show it verbatim. */
router.get('/access-matrix', requireAuth, (req, res) => {
  const permissions = Object.values(P);
  res.json({
    roles: rbac.ROLE_CODES.map((code) => ({
      code,
      ...rbac.ROLES[code],
      grants: rbac.GRANTS[code],
    })),
    permissions,
    matrix: rbac.ROLE_CODES.map((code) => ({
      role: code,
      cells: permissions.map((perm) => (rbac.GRANTS[code] || []).includes(perm)),
    })),
    approvalModes: rbac.APPROVAL_MODES.map((mode) => ({
      mode,
      example: H.LEAF_CODES.map((code) => ({ unit: code, approvedBy: rbac.approvalAuthorityFor(code, mode) })),
    })),
  });
});

/* --------------------------------------------------------------------- *
 * Settings
 * --------------------------------------------------------------------- */

router.get('/settings', requirePermission(P.SETTINGS_MANAGE), async (req, res, next) => {
  try {
    res.json({
      settings: await repo.settings(),
      approvalModes: rbac.APPROVAL_MODES,
      dataMode: repo.mode(),
      mailMode: mailer.mode(),
      env: {
        node: process.version,
        appUrl: env.APP_URL,
        fyLabel: env.fy.label,
        authMode: env.auth.mode,
      },
    });
  } catch (err) { next(err); }
});

router.put('/settings/:key', requirePermission(P.SETTINGS_MANAGE), async (req, res, next) => {
  try {
    const { key } = req.params;
    const value = String(req.body.value);
    if (key === 'approval.mode' && !rbac.APPROVAL_MODES.includes(value)) {
      return res.status(400).json({ error: `approval.mode must be one of ${rbac.APPROVAL_MODES.join(', ')}.` });
    }
    const settings = await repo.setSetting(key, value, req.user);
    res.json({ settings });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------- *
 * Audit trail
 * --------------------------------------------------------------------- */

router.get('/audit', requirePermission(P.AUDIT_VIEW), async (req, res, next) => {
  try {
    res.json({ rows: await repo.auditTrail({ limit: Number(req.query.limit) || 200 }) });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------- *
 * Mail
 * --------------------------------------------------------------------- */

/**
 * The mail outbox.
 *
 * In outbox mode every intimation the system would have sent is rendered and
 * kept here instead of being delivered, so the business can read the actual
 * messages - wording, figures, recipients - and sign them off before SMTP is
 * ever switched on.
 */
router.get('/mail', requirePermission(P.MAIL_MANAGE), (req, res) => {
  res.json({
    mode: mailer.mode(),
    enabled: mailer.enabled(),
    templates: Object.keys(mailer.templates),
    messages: mailer.listOutbox(Number(req.query.limit) || 100),
  });
});

router.get('/mail/:id', requirePermission(P.MAIL_MANAGE), (req, res) => {
  const html = mailer.readOutbox(req.params.id);
  if (!html) return res.status(404).send('Message not found.');

  /**
   * The application-wide policy is frame-ancestors 'none', which also blocks
   * the outbox screen from framing this preview on its own origin. Relax it to
   * 'self' for this response only - the message must be shown exactly as the
   * recipient will see it, and rewriting it into the page would defeat the
   * point of the review.
   *
   * The rest of the policy is tightened rather than inherited: mail bodies are
   * generated HTML, so this document needs no script, no framing of its own
   * and no network access at all.
   */
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'",
  );
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.type('html').send(html);
});

router.post('/mail/run/:job', requirePermission(P.MAIL_MANAGE), async (req, res, next) => {
  try {
    const { job } = req.params;
    if (job === 'reminders') {
      return res.json({ job, sent: await notify.sendSubmissionReminders({ period: req.body.period }) });
    }
    if (job === 'digest') {
      return res.json({ job, sent: await notify.sendExecDigest() });
    }
    return res.status(400).json({ error: 'Unknown job. Use "reminders" or "digest".' });
  } catch (err) { return next(err); }
});

/* --------------------------------------------------------------------- *
 * System
 * --------------------------------------------------------------------- */

/** Return the synthetic dataset to its generated baseline. Never available
 *  against a real database - the guard is the data mode, not a role. */
router.post('/system/reset', requirePermission(P.SETTINGS_MANAGE), async (req, res) => {
  if (repo.mode() !== 'synthetic') {
    return res.status(400).json({ error: 'Reset is only available in synthetic data mode.' });
  }
  res.json(await repo.reset());
});

module.exports = router;

/**
 * A local account needs a password it can actually sign in with; an AD account
 * must not carry one. Same rule as `npm run seed -- --admin`: at least 10
 * characters, and none of the characters that dotenv or a shell mangle.
 */
function passwordProblem(body, creating) {
  if (body.ad_user) {
    return body.password ? 'An Active Directory account signs in with its AD password. Leave the password blank.' : null;
  }
  if (!body.password) {
    return creating && repo.mode() === 'mssql'
      ? 'A local account needs an initial password (at least 10 characters), or mark it as an Active Directory account.'
      : null;
  }
  if (String(body.password).length < 10) return 'Password must be at least 10 characters.';
  return null;
}
