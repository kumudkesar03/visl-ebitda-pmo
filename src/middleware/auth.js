'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const rbac = require('../domain/rbac');
const repo = require('../data');

/**
 * Authentication and scope resolution.
 *
 * The important part of this file is not the token handling - it is that
 * `req.scope` is computed here, once, from the signed-in user's role and home
 * business unit, and every repository read is given that array. Routes cannot
 * widen it. text.txt 13.1 documents what happens when scope is left to each
 * route to remember.
 */

function sign(user) {
  return jwt.sign(
    { sub: user.id, employee_id: user.employee_id, role: user.role, home_bu: user.home_bu },
    env.auth.jwtSecret,
    { expiresIn: `${env.auth.sessionHours}h` },
  );
}

function setSessionCookie(res, token) {
  res.cookie(env.auth.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.auth.cookieSecure,
    maxAge: env.auth.sessionHours * 3600 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(env.auth.cookieName);
}

function readToken(req) {
  const fromCookie = req.cookies ? req.cookies[env.auth.cookieName] : null;
  if (fromCookie) return fromCookie;
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/** Attaches req.user, req.scope and req.writeScope, or 401s. */
async function requireAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) return res.status(401).json({ error: 'Not signed in.' });

    const payload = jwt.verify(token, env.auth.jwtSecret);
    const user = await repo.findUserById(payload.sub);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Account is no longer active.' });
    }

    req.user = {
      id: user.id,
      employee_id: user.employee_id,
      name: user.name,
      email: user.email,
      role: user.role,
      home_bu: user.home_bu,
      designation: user.designation,
    };
    // Resolved once. Everything downstream receives this array explicitly.
    req.scope = rbac.readScope(req.user);
    req.writeScope = rbac.writeScope(req.user);
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
}

/** Route guard for a named permission. */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!rbac.can(req.user, permission)) {
      return res.status(403).json({
        error: 'You do not have permission to do that.',
        required: permission,
        role: req.user ? req.user.role : null,
      });
    }
    return next();
  };
}

/**
 * Guard for a write against a specific business unit. Checked on the resolved
 * BU of the record being changed, not on anything the client sends.
 */
function requireBuWrite(getBuCode) {
  return async (req, res, next) => {
    try {
      const bu = await getBuCode(req);
      if (!bu) return res.status(404).json({ error: 'Record not found.' });
      if (!rbac.canWriteBu(req.user, bu)) {
        return res.status(403).json({
          error: `Your access does not extend to ${bu}.`,
          scope: req.writeScope,
        });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  sign, setSessionCookie, clearSessionCookie,
  requireAuth, requirePermission, requireBuWrite,
};
