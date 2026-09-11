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
    port: int(process.env.DB_PORT, 1433),
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

  /* Per-business-unit Active Directory. text.txt section 13.4 records that ESL,
     IOB and FACOR appear to sit behind different directories, so the config is
     keyed by BU code from the start rather than being one flat block. */
  ad: {
    enabled: bool(process.env.AD_ENABLED, false),
    directories: safeJson(process.env.AD_DIRECTORIES, {}),
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
  try { return JSON.parse(raw); } catch { return dflt; }
}

if (env.NODE_ENV === 'production' && env.auth.jwtSecret === 'dev-only-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a real value before running in production.');
}
if (!['synthetic', 'mssql'].includes(env.DATA_MODE)) {
  throw new Error(`DATA_MODE must be "synthetic" or "mssql", received "${env.DATA_MODE}".`);
}

module.exports = env;
