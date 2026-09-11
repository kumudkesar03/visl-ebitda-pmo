'use strict';

const sql = require('mssql');
const env = require('../../config/env');

/**
 * Connection pool for Azure SQL / SQL Server.
 *
 * Two things here exist because of the environment recorded in text.txt s.1:
 *
 * 1. The database is named in the connection, and the application NEVER
 *    issues USE. Azure SQL does not support it, and a connection that does
 *    not name a database defaults to master and is rejected with error 916.
 *
 * 2. Timeouts are generous. The ESL_PMO database sits on a serverless tier
 *    that auto-pauses when idle, and the first query after a quiet period
 *    takes 30-60 seconds to resume. A default 15-second timeout turns that
 *    into an outage on the first click of the morning.
 */

let poolPromise = null;

function config() {
  if (!env.db.host) {
    throw new Error('DATA_MODE=mssql but DB_HOST is not set. See docs/01-SETUP.md.');
  }
  return {
    server: env.db.host,
    port: env.db.port,
    database: env.db.name,
    user: env.db.user,
    password: env.db.password,
    options: {
      encrypt: env.db.encrypt,                          // required by Azure SQL
      trustServerCertificate: env.db.trustServerCertificate,
      enableArithAbort: true,
    },
    requestTimeout: env.db.requestTimeout,
    connectionTimeout: env.db.connectionTimeout,
    pool: { max: env.db.poolMax, min: 0, idleTimeoutMillis: 30000 },
  };
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(config()).catch((err) => {
      // Reset so a transient failure (a paused serverless tier, a network
      // blip) does not permanently poison the cached promise.
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

/**
 * Run a parameterised query.
 *
 * Parameters are always bound, never interpolated. `params` is a plain
 * object; types are inferred, which is adequate for everything this
 * application sends. Pass an explicit {type, value} pair where it matters:
 *
 *     query('SELECT ... WHERE period = @p', { p: { type: sql.Date, value: d } })
 */
async function query(text, params = {}) {
  const pool = await getPool();
  const request = pool.request();
  for (const [key, value] of Object.entries(params)) {
    if (value && typeof value === 'object' && 'type' in value && 'value' in value) {
      request.input(key, value.type, value.value);
    } else {
      request.input(key, value);
    }
  }
  const result = await request.query(text);
  return result.recordset || [];
}

async function queryOne(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}

/**
 * Run several statements inside one transaction.
 *
 * Used where a partial write would leave the governance record inconsistent -
 * approving a month and writing its audit entry, for instance. `fn` receives
 * a request factory bound to the transaction.
 */
async function transaction(fn) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const run = async (text, params = {}) => {
      const request = new sql.Request(tx);
      for (const [key, value] of Object.entries(params)) {
        if (value && typeof value === 'object' && 'type' in value && 'value' in value) {
          request.input(key, value.type, value.value);
        } else {
          request.input(key, value);
        }
      }
      const result = await request.query(text);
      return result.recordset || [];
    };
    const out = await fn(run);
    await tx.commit();
    return out;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function close() {
  if (poolPromise) {
    const pool = await poolPromise;
    await pool.close();
    poolPromise = null;
  }
}

module.exports = { sql, getPool, query, queryOne, transaction, close };
