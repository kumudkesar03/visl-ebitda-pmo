'use strict';

const fs = require('fs');
const path = require('path');
const env = require('../config/env');

/**
 * Applies sql/*.sql in numeric order.   `npm run migrate`
 *
 * Deliberately thin. The scripts themselves are idempotent and readable, and a
 * DBA on a plant network is far more likely to run them in SSMS than to trust a
 * migration tool - so this runner exists to make the happy path one command,
 * not to become the only way the schema can be applied.
 *
 * WHY BATCH SPLITTING MATTERS: SQL Server needs CREATE VIEW to be the first
 * statement in its batch. The `GO` separator is an SSMS convention, not T-SQL,
 * so the driver never sees it - this runner splits on it and sends each batch
 * separately. Sending a whole file as one string fails on the first view.
 */

async function main() {
  if (env.DATA_MODE !== 'mssql') {
    console.error('');
    console.error('  DATA_MODE is "%s", so there is no database to migrate.', env.DATA_MODE);
    console.error('  Set DATA_MODE=mssql in .env once the database is ready.');
    console.error('');
    process.exit(1);
  }

  const { query, close } = require('../data/mssql/pool');
  const dir = path.join(process.cwd(), 'sql');
  const only = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1]
    : null;

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    // Only the schema: 01 tables, 02 reference data, 03 views, 04 verify.
    // 00 (server setup, run once by a DBA as sysadmin), 05 (departments - edit
    // the list first) and 99 (synthetic clean-up) are run by hand in SSMS.
    .filter((f) => /^0[1-4]_/.test(f))
    .filter((f) => !only || f.startsWith(only))
    .sort();

  if (!files.length) {
    console.error('No migration files matched.');
    process.exit(1);
  }

  console.log('');
  console.log(`  Target : ${env.db.host} / ${env.db.name}`);
  console.log(`  As     : ${env.db.user}`);
  console.log(`  Files  : ${files.join(', ')}`);
  console.log('');

  // Confirm the connection landed in the right database. Error 916 and the
  // "empty sys.tables" confusion in the ESL setup both came from a session
  // silently sitting on master.
  const [{ db }] = await query('SELECT DB_NAME() AS db');
  // Case-insensitive: SQL Server database names are, and DB_NAME=visl_pmo
  // against a database created as VISL_PMO is the same database.
  if (String(db).toLowerCase() !== String(env.db.name).toLowerCase()) {
    console.error(`  Connected to "${db}" but DB_NAME is "${env.db.name}". Refusing to run.`);
    process.exit(1);
  }
  console.log(`  Confirmed connected to ${db}.`);
  console.log('');

  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const batches = text
      .split(/^\s*GO\s*$/gim)
      .map((b) => b.trim())
      .filter(Boolean);

    process.stdout.write(`  ${file.padEnd(28)} ${batches.length} batch(es) `);
    let n = 0;
    for (const batch of batches) {
      try {
        await query(batch);
        n += 1;
      } catch (err) {
        console.log('');
        console.error(`\n  FAILED in ${file}, batch ${n + 1}:`);
        console.error(`  ${err.message}`);
        console.error('\n  Batch was:\n');
        console.error(batch.split('\n').slice(0, 12).map((l) => `    ${l}`).join('\n'));
        await close();
        process.exit(1);
      }
    }
    console.log('OK');
  }

  console.log('');
  console.log('  Migration complete. Now run sql/04_verify.sql and resolve any FAIL.');
  console.log('');
  await close();
}

main().catch(async (err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
