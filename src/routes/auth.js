'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const repo = require('../data');
const rbac = require('../domain/rbac');
const H = require('../domain/hierarchy');
const auth = require('../middleware/auth');
const ldap = require('../services/ldap');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { employee_id: employeeId, password } = req.body || {};
    if (!employeeId || !password) {
      return res.status(400).json({ error: 'Enter your user ID and password.' });
    }

    // People type DOMAIN\user or user@domain as often as the bare ID.
    const user = await repo.findUserByEmployeeId(ldap.normaliseUsername(employeeId))
      || await repo.findUserByEmployeeId(String(employeeId).trim());

    // Same message whether the account is unknown or the password is wrong, so
    // the form cannot be used to enumerate valid employee IDs.
    const refuse = () => res.status(401).json({ error: 'Incorrect user ID or password.' });
    if (!user || !user.is_active) return refuse();

    const mode = env.auth.mode;
    if (user.ad_user) {
      // Directory accounts. In AUTH_MODE=local the directory is not consulted.
      if (mode === 'local') return refuse();
      const result = await ldap.authenticate(user, password);
      if (result.error && !result.ok) {
        // The directory could not be reached or rejected our configuration.
        // Say so, rather than blaming the user's password for an outage.
        return res.status(503).json({ error: 'The company directory could not be reached. Please try again shortly, or contact the PMO office.' });
      }
      if (!result.ok) return refuse();
    } else {
      // Local accounts: AUTH_MODE=local, or hybrid (break-glass admin, service users).
      if (mode === 'ad') return refuse();
      if (!await repo.verifyPassword(user, password)) return refuse();
    }

    await repo.touchLogin(user.id);
    const token = auth.sign(user);
    auth.setSessionCookie(res, token);
    repo.audit({ id: user.id, name: user.name }, 'auth.login', 'user', user.id, `Signed in from ${req.ip}`);

    return res.json({ user: shape(user), scope: rbac.readScope(user) });
  } catch (err) { return next(err); }
});

router.post('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

/** Everything the client needs to render the shell for this user. */
router.get('/me', auth.requireAuth, async (req, res, next) => {
  try {
    const settings = await repo.settings();
    const mode = settings['approval.mode'] || 'local';
    const unread = (await repo.notificationsFor(req.user.id, { unreadOnly: true, limit: 999 })).length;
    const queue = rbac.can(req.user, rbac.PERMISSIONS.ACTUAL_APPROVE)
      ? (await repo.approvalQueue(req.scope)).filter((row) => rbac.canApprove(req.user, row.bu_code, mode)).length
      : 0;

    res.json({
      user: req.user,
      role: rbac.ROLES[req.user.role],
      permissions: rbac.GRANTS[req.user.role] || [],
      scope: req.scope,
      writeScope: req.writeScope,
      businessUnits: (await repo.businessUnits()).filter((b) => req.scope.includes(b.code)),
      settings: {
        fy_label: settings['reporting.fy_label'],
        closed_through: settings['reporting.closed_through'],
        submission_period: settings['reporting.submission_period'],
        approval_mode: mode,
        dataset_kind: settings['dataset.kind'],
      },
      unreadNotifications: unread,
      pendingApprovals: queue,
      dataMode: repo.mode(),
    });
  } catch (err) { next(err); }
});

/**
 * Demo directory. Synthetic mode only - it lists the seeded accounts so the
 * access-control model can be reviewed by signing in as each role. It returns
 * 404 the moment DATA_MODE is anything but synthetic, so it cannot leak a real
 * user list from a production deployment.
 */
router.get('/demo-accounts', async (req, res) => {
  if (env.DATA_MODE !== 'synthetic') return res.status(404).json({ error: 'Not available.' });
  const users = await repo.allUsers();
  const wanted = ['visl.ceo', 'visl.pmo1', 'iob.pmo', 'iok.pmo', 'esl.pmo', 'iok.own1', 'esl.own1', 'kumud.kesar', 'esl.view1'];
  res.json({
    password: 'demo1234',
    accounts: wanted.map((id) => users.find((u) => u.employee_id === id)).filter(Boolean).map((u) => ({
      employee_id: u.employee_id,
      name: u.name,
      role: u.role,
      role_label: rbac.ROLES[u.role].label,
      home_bu: u.home_bu,
      designation: u.designation,
      sees: rbac.readScope(u).filter((c) => !H.get(c).consolidated).join(', '),
    })),
  });
});

function shape(u) {
  return {
    id: u.id, employee_id: u.employee_id, name: u.name, email: u.email,
    role: u.role, home_bu: u.home_bu, designation: u.designation,
  };
}

module.exports = router;
