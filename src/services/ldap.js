'use strict';

const fs = require('fs');
const path = require('path');
const { Client, InvalidCredentialsError } = require('ldapts');
const env = require('../config/env');
const H = require('../domain/hierarchy');

/**
 * Active Directory sign-in over LDAP.
 *
 * THE SPLIT OF RESPONSIBILITY: Active Directory answers "is this really
 * kumud.kesar, and is the password right?". This application answers "what may
 * kumud.kesar see and do?" - role and home business unit live in dbo.users and
 * are managed under Administration. A valid AD password on its own grants
 * nothing: the account must also exist here, be active and be marked as an AD
 * account. Nobody is auto-created from the directory.
 *
 * HOW A SIGN-IN WORKS ("search, then bind" - the standard pattern for AD):
 *
 *   1. Open a connection to the domain controller, encrypted:
 *        ldaps://dc:636            TLS from the first byte (preferred), or
 *        ldap://dc:389 + StartTLS  upgraded to TLS before anything is sent.
 *   2. Bind as the SERVICE ACCOUNT (read-only, no rights beyond reading
 *      users) and SEARCH the base DN for the user by sAMAccountName. This
 *      finds the user's full distinguished name, wherever in the OU tree
 *      they sit, and confirms the account is not disabled.
 *   3. Bind again as THE USER'S OWN DN with the password they typed. Success
 *      means the directory accepted the password. Nothing is stored.
 *
 * Without a service account it falls back to "direct bind": bind as
 * user@upnSuffix with the typed password, then search as that user. That works
 * on most AD domains but cannot find accounts whose UPN differs from their
 * sAMAccountName, so the service-account route is what to ask IT for.
 *
 * Passwords are never logged, never written anywhere, and never sent over an
 * unencrypted connection: a plain ldap:// URL without StartTLS is refused.
 */

const ATTRIBUTES = ['sAMAccountName', 'userPrincipalName', 'displayName', 'mail', 'title', 'department',
  'distinguishedName', 'userAccountControl'];

// userAccountControl bit 2 = ACCOUNTDISABLE.
const UAC_DISABLED = 0x2;

/** RFC 4515 escaping, so a user ID cannot inject into the search filter. */
function escapeFilter(value) {
  return String(value).replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/**
 * Accept the forms people actually type - kumud.kesar, VEDANTA\kumud.kesar,
 * kumud.kesar@vedanta.co.in - and reduce them to the sAMAccountName.
 */
function normaliseUsername(input) {
  let u = String(input || '').trim();
  if (u.includes('\\')) u = u.split('\\').pop();
  if (u.includes('@')) u = u.split('@')[0];
  return u;
}

function tlsOptions(dir) {
  const opts = { rejectUnauthorized: dir.rejectUnauthorized };
  if (dir.caFile) {
    const file = path.resolve(dir.caFile);
    if (!fs.existsSync(file)) throw new Error(`AD CA certificate not found: ${file}`);
    opts.ca = [fs.readFileSync(file)];
  }
  return opts;
}

async function connect(dir) {
  const secure = dir.url.toLowerCase().startsWith('ldaps://');
  if (!secure && !dir.startTLS) {
    throw new Error(`Directory ${dir.key}: ${dir.url} is unencrypted. Use ldaps://...:636, or set startTLS for ldap://...:389.`);
  }
  const client = new Client({
    url: dir.url,
    timeout: env.ad.timeoutMs,
    connectTimeout: env.ad.timeoutMs,
    tlsOptions: secure ? tlsOptions(dir) : undefined,
    strictDN: false,
  });
  if (!secure && dir.startTLS) await client.startTLS(tlsOptions(dir));
  return client;
}

async function findUser(client, dir, username) {
  const filter = dir.userFilter.replace(/\{\{username\}\}/g, escapeFilter(username));
  const { searchEntries } = await client.search(dir.baseDN, {
    scope: 'sub', filter, attributes: ATTRIBUTES, sizeLimit: 2,
  });
  if (searchEntries.length > 1) throw Object.assign(new Error('More than one directory entry matches that user ID.'), { code: 'AMBIGUOUS' });
  return searchEntries[0] || null;
}

function shape(entry, dirKey) {
  // LDAP attribute names are case-insensitive; servers differ in the case they
  // return (AD says sAMAccountName, others samaccountname). Read them that way.
  const lower = Object.fromEntries(Object.entries(entry).map(([k, v]) => [k.toLowerCase(), v]));
  const get = (name) => { const v = lower[name.toLowerCase()]; return Array.isArray(v) ? v[0] : v; };
  return {
    directory: dirKey,
    dn: get('dn') || get('distinguishedName'),
    username: get('sAMAccountName'),
    upn: get('userPrincipalName') || null,
    name: get('displayName') || null,
    email: get('mail') || null,
    title: get('title') || null,
    department: get('department') || null,
    disabled: (Number(get('userAccountControl')) & UAC_DISABLED) === UAC_DISABLED,
  };
}

/**
 * Authenticate against one directory. Resolves to the directory entry on
 * success, null on a wrong password or unknown user; throws on configuration
 * or network failure so that an outage is never reported as a bad password.
 */
async function authenticateIn(dir, rawUsername, password) {
  const username = normaliseUsername(rawUsername);
  if (!username || !password) return null;

  const client = await connect(dir);
  try {
    let entry;
    if (dir.bindDN) {
      // Search as the service account, then bind as the user.
      await client.bind(dir.bindDN, dir.bindPassword);
      entry = await findUser(client, dir, username);
      if (!entry) return null;
      const user = shape(entry, dir.key);
      if (user.disabled) return null;
      const userClient = await connect(dir);
      try {
        await userClient.bind(user.dn, password);
      } catch (err) {
        if (err instanceof InvalidCredentialsError) return null;
        throw err;
      } finally {
        await userClient.unbind().catch(() => {});
      }
      return user;
    }

    // Direct bind as user@upnSuffix (or DOMAIN\user), then read own entry.
    const principal = dir.upnSuffix ? `${username}@${dir.upnSuffix}` : `${dir.domain}\\${username}`;
    try {
      await client.bind(principal, password);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) return null;
      throw err;
    }
    entry = await findUser(client, dir, username);
    if (!entry) return { directory: dir.key, username, dn: principal, disabled: false };
    const user = shape(entry, dir.key);
    return user.disabled ? null : user;
  } finally {
    await client.unbind().catch(() => {});
  }
}

/**
 * Which directories to try for a user, in order.
 *
 * Walk up from the user's home unit (IOK -> IOB -> VISL) and take the first
 * directory whose units cover it:  ESL -> ESL directory;  IOK, IOG, VAB, HO,
 * IOB and FACOR -> IOB directory. Only that directory is tried - an ESL
 * account is never tested against the IOB forest, so the same logon name in
 * two forests cannot be confused.
 *
 * Group-level users homed at VISL belong to no single forest; for them every
 * directory is tried in AD_DIRS order and the first that accepts wins.
 */
function directoriesFor(homeBu) {
  const dirs = Object.values(env.ad.directories);
  let code = homeBu ? String(homeBu).toUpperCase() : null;
  while (code) {
    const match = dirs.find((d) => d.units.includes(code));
    if (match) return [match];
    const unit = H.get(code);
    code = unit ? unit.parent : null;
  }
  return dirs;
}

/**
 * Authenticate a user who exists in the application as an AD account.
 * Returns { ok, entry, error } - error is set only for infrastructure failures.
 */
async function authenticate(user, password) {
  const username = normaliseUsername(user.employee_id);
  let lastError = null;
  for (const dir of directoriesFor(user.home_bu)) {
    try {
      const entry = await authenticateIn(dir, username, password);
      if (entry) return { ok: true, entry };
    } catch (err) {
      lastError = err;
      console.error(`[ldap] ${dir.key} ${dir.url}: ${err.message || err.code || err}`);
    }
  }
  return { ok: false, error: lastError };
}

module.exports = {
  authenticate, authenticateIn, directoriesFor, normaliseUsername, escapeFilter,
  connect, findUser, shape, ATTRIBUTES,
  configured: () => Object.keys(env.ad.directories).length > 0,
};
