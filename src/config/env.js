'use strict';
require('dotenv').config();

/**
 * Every environment value the application reads is declared here, once.
 * Nothing else in the codebase touches process.env directly, so the full
 * configuration surface of the app is this file and .env.example.
 */

function bool(v, dflt = false) {
  if (v === undefined || v === null || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}
function int(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: int(process.env.PORT, 4010),
  APP_URL: process.env.APP_URL || 'http://localhost:4010',
  APP_NAME: process.env.APP_NAME || 'VISL EBITDA Drive PMO',

  /* ------------------------------------------------------------------ *
   * DATA_MODE decides where every read and write goes.
   *   synthetic - in-process deterministic dataset, no database at all.
   *               This is the mode the UI review build runs in.
   *   mssql     - Azure SQL / SQL Server via src/data/mssql.
   * The route layer never knows which is active; see src/data/index.js.
   * ------------------------------------------------------------------ */
  DATA_MODE: (process.env.DATA_MODE || 'synthetic').toLowerCase(),

  db: {
    host: process.env.DB_HOST || '',
    // Named instance (SERVER\INSTANCE). When set, the port is resolved by the
    // SQL Browser service (UDP 1434) and DB_PORT is ignored.
    instance: process.env.DB_INSTANCE || '',
    port: int(process.env.DB_PORT, 1433),
    // sql  - SQL Server login (DB_USER / DB_PASSWORD). The recommended default.
    // ntlm - a Windows / domain account (DB_DOMAIN + DB_USER / DB_PASSWORD).
    auth: (process.env.DB_AUTH || 'sql').toLowerCase(),
    domain: process.env.DB_DOMAIN || '',
    name: process.env.DB_NAME || 'VISL_PMO',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    // Azure SQL requires encryption and presents a valid certificate.
    encrypt: bool(process.env.DB_ENCRYPT, true),
    trustServerCertificate: bool(process.env.DB_TRUST_SERVER_CERT, false),
    // Serverless Azure tiers auto-pause; the first query after idle can take 60s.
    requestTimeout: int(process.env.DB_REQUEST_TIMEOUT_MS, 90000),
    connectionTimeout: int(process.env.DB_CONNECT_TIMEOUT_MS, 60000),
    poolMax: int(process.env.DB_POOL_MAX, 10),
  },

  auth: {
    mode: (process.env.AUTH_MODE || 'local').toLowerCase(), // local | ad | hybrid
    jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
    sessionHours: int(process.env.SESSION_HOURS, 10),
    cookieName: process.env.COOKIE_NAME || 'visl_pmo_sid',
    cookieSecure: bool(process.env.COOKIE_SECURE, false),
  },

  /* Active Directory over LDAP. See src/services/ldap.js and HANDOVER.txt s.9.
     One directory is configured with the flat AD_* values; several (ESL, IOB and
     FACOR may sit behind different forests - text.txt 13.4) with AD_DIRECTORIES,
     keyed by business unit code. Either way it resolves to the same shape. */
  ad: {
    directories: adDirectories(),
    timeoutMs: int(process.env.AD_TIMEOUT_MS, 10000),
  },

  mail: {
    enabled: bool(process.env.SMTP_ENABLED, false),
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 25),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.MAIL_FROM || 'VISL PMO <pmo-noreply@vedanta.co.in>',
    // With SMTP disabled every message is written to the outbox instead of
    // being sent, so mail can be reviewed end-to-end without reaching staff.
    outboxDir: process.env.MAIL_OUTBOX_DIR || 'var/outbox',
    digestCron: process.env.MAIL_DIGEST_CRON || '0 7 * * 1',
    reminderCron: process.env.MAIL_REMINDER_CRON || '0 9 * * *',
    cronEnabled: bool(process.env.MAIL_CRON_ENABLED, false),
  },

  fy: {
    // Indian financial year. FY27 == Apr 2026 - Mar 2027.
    startMonth: int(process.env.FY_START_MONTH, 4),
    label: process.env.FY_LABEL || 'FY 2026-27',
    startISO: process.env.FY_START || '2026-04-01',
  },
};

function safeJson(raw, dflt) {
  if (!raw) return dflt;
  try { return JSON.parse(raw); } catch {
    throw new Error('AD_DIRECTORIES is not valid JSON. It must be one line of JSON - see HANDOVER.txt s.9.');
  }
}

/**
 * Directory definitions.
 *
 * VISL signs people in against TWO Active Directory forests:
 *     ESL  directory - serves ESL
 *     IOB  directory - serves IOB (IOK, IOG, VAB, HO) and FACOR
 * so the primary form is one block of variables per directory:
 *
 *     AD_DIRS=ESL,IOB
 *     AD_ESL_URL=...   AD_ESL_BASE_DN=...   AD_ESL_BIND_DN=...   AD_ESL_BIND_PASSWORD=...
 *     AD_ESL_UNITS=ESL
 *     AD_IOB_URL=...   ...                                     AD_IOB_UNITS=IOB,FACOR
 *
 * A directory serves the units in its _UNITS list and everything beneath them.
 * Also accepted: a single directory as flat AD_URL / AD_BASE_DN / ..., or
 * AD_DIRECTORIES as one line of JSON (bind passwords then named by
 * bindPasswordEnv so the JSON never carries a secret).
 */
function adDirectories() {
  let raw = {};
  const envDir = (prefix) => ({
    url: process.env[`${prefix}URL`],
    baseDN: process.env[`${prefix}BASE_DN`],
    bindDN: process.env[`${prefix}BIND_DN`],
    bindPassword: process.env[`${prefix}BIND_PASSWORD`],
    upnSuffix: process.env[`${prefix}UPN_SUFFIX`],
    domain: process.env[`${prefix}DOMAIN`],
    userFilter: process.env[`${prefix}USER_FILTER`],
    caFile: process.env[`${prefix}CA_FILE`],
    startTLS: process.env[`${prefix}STARTTLS`],
    rejectUnauthorized: process.env[`${prefix}TLS_REJECT_UNAUTHORIZED`],
    units: process.env[`${prefix}UNITS`],
  });

  if (process.env.AD_DIRECTORIES) {
    raw = safeJson(process.env.AD_DIRECTORIES, {});
  } else if (process.env.AD_DIRS) {
    for (const key of process.env.AD_DIRS.split(',').map((k) => k.trim().toUpperCase()).filter(Boolean)) {
      raw[key] = envDir(`AD_${key}_`);
    }
  } else if (process.env.AD_URL) {
    raw[(process.env.AD_BU || 'VISL').toUpperCase()] = envDir('AD_');
  }

  const out = {};
  for (const [key, d] of Object.entries(raw)) {
    const k = String(key).toUpperCase();
    if (!d || !d.url) {
      if (process.env.AD_DIRS) throw new Error(`AD_DIRS lists ${k} but AD_${k}_URL is not set.`);
      continue;
    }
    const units = Array.isArray(d.units) ? d.units : String(d.units || k).split(',');
    out[k] = {
      key: k,
      url: d.url,
      baseDN: d.baseDN || '',
      bindDN: d.bindDN || '',
      bindPassword: d.bindPasswordEnv ? (process.env[d.bindPasswordEnv] || '') : (d.bindPassword || ''),
      upnSuffix: d.upnSuffix || '',
      domain: d.domain || '',
      // {{username}} is replaced by the escaped sAMAccountName.
      userFilter: d.userFilter || '(&(objectCategory=person)(objectClass=user)(sAMAccountName={{username}}))',
      caFile: d.caFile || '',
      startTLS: bool(d.startTLS, false),
      rejectUnauthorized: bool(d.rejectUnauthorized, true),
      units: units.map((u) => String(u).trim().toUpperCase()).filter(Boolean),
    };
  }
  return out;
}

if (env.NODE_ENV === 'production' && env.auth.jwtSecret === 'dev-only-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a real value before running in production.');
}
if (!['local', 'ad', 'hybrid'].includes(env.auth.mode)) {
  throw new Error(`AUTH_MODE must be "local", "ad" or "hybrid", received "${env.auth.mode}".`);
}
if (env.auth.mode !== 'local' && !Object.keys(env.ad.directories).length) {
  throw new Error(`AUTH_MODE=${env.auth.mode} but no directory is configured. Set AD_DIRS with AD_<KEY>_URL etc. (see .env.example and HANDOVER.txt s.9).`);
}
if (!['sql', 'ntlm'].includes(env.db.auth)) {
  throw new Error(`DB_AUTH must be "sql" or "ntlm", received "${env.db.auth}".`);
}
if (!['synthetic', 'mssql'].includes(env.DATA_MODE)) {
  throw new Error(`DATA_MODE must be "synthetic" or "mssql", received "${env.DATA_MODE}".`);
}

module.exports = env;
