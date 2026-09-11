'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { parse } = require('csv-parse/sync');
const env = require('../config/env');
const M = require('../domain/metrics');
const H = require('../domain/hierarchy');

/**
 * Seeding.   `npm run seed -- [options]`
 *
 *   --admin <employee_id> --password <value>
 *       Set (or reset) a local password for an account. Stores a bcrypt hash.
 *
 *   --plan <file.csv> --bu <CODE>
 *       Load a savings plan into one reporting unit.
 *
 * THE ORDER OF OPERATIONS MATTERS. In the ESL deployment `npm run seed`
 * aborted on a missing CSV, and because the bootstrap administrator was
 * created by the same run, nobody could sign in at all - which presented as
 * "incorrect username and password" rather than as a failed seed. Here the
 * two are independent: the admin password is set first and committed before
 * any plan file is opened, and a bad CSV cannot take the account with it.
 */

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

async function main() {
  if (env.DATA_MODE !== 'mssql') {
    console.error('');
    console.error('  DATA_MODE is "%s". The synthetic dataset is generated, not seeded.', env.DATA_MODE);
    console.error('  Reset it from the application under System, or delete var/state.json.');
    console.error('');
    process.exit(1);
  }

  const { query, close } = require('../data/mssql/pool');

  /* ---------------- 1. Administrator password, first and alone -------- */
  const adminId = arg('admin');
  const password = arg('password');
  if (adminId) {
    if (!password) {
      console.error('  --admin requires --password.');
      process.exit(1);
    }
    if (password.length < 10) {
      console.error('  Password must be at least 10 characters.');
      process.exit(1);
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      'UPDATE dbo.users SET password_hash = @hash, is_active = 1 WHERE employee_id = @id; SELECT @@ROWCOUNT AS n',
      { hash, id: adminId },
    );
    if (!result[0] || result[0].n === 0) {
      console.error(`  No user "${adminId}". Create the account first, or check 02_reference_data.sql ran.`);
      await close();
      process.exit(1);
    }
    console.log(`  Password set for ${adminId}.`);
    console.log('  You can sign in now. Anything below is independent of this.');
    console.log('');
  }

  /* ---------------- 2. Savings plan, separately ----------------------- */
  const planFile = arg('plan');
  if (planFile) {
    const bu = String(arg('bu') || '').toUpperCase();
    if (!H.exists(bu)) {
      console.error(`  --bu must be one of: ${H.LEAF_CODES.join(', ')}`);
      await close();
      process.exit(1);
    }
    if (H.get(bu).consolidated) {
      console.error(`  ${bu} is a consolidated roll-up node. Initiatives attach only to reporting units:`);
      console.error(`  ${H.leavesOf(bu).join(', ')}`);
      await close();
      process.exit(1);
    }
    const full = path.resolve(planFile);
    if (!fs.existsSync(full)) {
      console.error(`  Plan file not found: ${full}`);
      await close();
      process.exit(1);
    }
    await loadPlan(query, full, bu);
  }

  if (!adminId && !planFile) {
    console.log('');
    console.log('  Nothing to do. Usage:');
    console.log('    npm run seed -- --admin pmo.admin --password "SomeLongValue"');
    console.log('    npm run seed -- --plan ./savings-plan-IOK.csv --bu IOK');
    console.log('');
  }

  await close();
}

/**
 * Load a savings plan CSV into one reporting unit.
 *
 * Expected columns (header row required, case-insensitive):
 *   code, title, department, owner, category, target_cr,
 *   and one column per month named Apr-26, May-26, ... Mar-27
 *
 * The monthly columns are checked against target_cr before anything is
 * written. A plan that does not foot to its own target is the single most
 * common defect in a spreadsheet-sourced load, and it surfaces later as an
 * unexplained gap on the executive board.
 */
async function loadPlan(query, file, bu) {
  const rows = parse(fs.readFileSync(file), { columns: true, skip_empty_lines: true, trim: true });
  if (!rows.length) {
    console.error('  Plan file has no data rows.');
    return;
  }

  const settings = Object.fromEntries(
    (await query('SELECT skey, svalue FROM dbo.settings')).map((r) => [r.skey, r.svalue]),
  );
  const periods = M.fyPeriods(settings['reporting.fy_start'] || env.fy.startISO, 12);
  const monthLabels = periods.map((p) => M.periodLabel(p));

  const header = Object.keys(rows[0]);
  const lower = Object.fromEntries(header.map((h) => [h.toLowerCase().trim(), h]));
  const monthCols = periods.map((p, i) => {
    const wanted = monthLabels[i].toLowerCase();
    return header.find((h) => h.toLowerCase().trim() === wanted) || null;
  });

  const missing = monthCols.filter((c) => !c).length;
  if (missing) {
    console.warn(`  WARNING: ${missing} of 12 month columns not found. Expected headings: ${monthLabels.join(', ')}`);
  }

  /* -------- validate everything before writing anything -------- */
  const problems = [];
  for (const [idx, row] of rows.entries()) {
    const target = Number(row[lower.target_cr] || row[lower.target] || 0);
    const monthly = monthCols.reduce((a, c) => a + (c ? Number(row[c]) || 0 : 0), 0);
    if (!row[lower.title]) problems.push(`row ${idx + 2}: no title`);
    if (target > 0 && Math.abs(monthly - target) > 0.005) {
      problems.push(`row ${idx + 2} (${row[lower.code] || row[lower.title]}): months total ${monthly.toFixed(2)} against target ${target.toFixed(2)}`);
    }
  }
  if (problems.length) {
    console.error('');
    console.error(`  ${problems.length} problem(s) found. Nothing has been written.`);
    problems.slice(0, 20).forEach((p) => console.error(`    - ${p}`));
    if (problems.length > 20) console.error(`    ... and ${problems.length - 20} more`);
    console.error('');
    console.error('  Fix the file and re-run. Pass --force to load anyway.');
    if (!process.argv.includes('--force')) return;
  }

  /* -------- write -------- */
  let created = 0;
  for (const [idx, row] of rows.entries()) {
    const code = row[lower.code] || `${bu}-${String(idx + 1).padStart(3, '0')}`;
    const target = Number(row[lower.target_cr] || row[lower.target] || 0);

    const inserted = await query(`
      MERGE dbo.initiatives AS t
      USING (SELECT @code AS code) AS s ON t.code = s.code
      WHEN MATCHED THEN UPDATE SET
        title = @title, target_savings_cr = @target, updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT
        (code, title, business_unit_id, department_id, owner_id, owner_name_raw, category_code, target_savings_cr, status)
        VALUES (@code, @title,
                (SELECT id FROM dbo.business_units WHERE code = @bu),
                (SELECT TOP 1 id FROM dbo.departments WHERE name = @department),
                (SELECT TOP 1 u.id FROM dbo.users u WHERE u.name = @owner),
                @owner, @category, @target, 'not_started')
      OUTPUT INSERTED.id;`,
    {
      code,
      title: row[lower.title],
      bu,
      department: row[lower.department] || null,
      owner: row[lower.owner] || null,
      category: row[lower.category] || null,
      target,
    });

    const id = inserted[0].id;
    for (const [i, period] of periods.entries()) {
      const col = monthCols[i];
      const plan = col ? Number(row[col]) || 0 : 0;
      await query(`
        MERGE dbo.initiative_months AS t
        USING (SELECT @id AS initiative_id, @period AS period) AS s
          ON t.initiative_id = s.initiative_id AND t.period = s.period
        WHEN MATCHED AND t.actual_status <> 'approved' THEN UPDATE SET plan_cr = @plan
        WHEN NOT MATCHED THEN INSERT (initiative_id, period, plan_cr, actual_status)
                                VALUES (@id, @period, @plan, 'draft');`,
      { id, period, plan });
    }
    created += 1;
  }

  console.log(`  Loaded ${created} initiative(s) into ${bu} from ${path.basename(file)}.`);
  console.log('  Run sql/04_verify.sql to confirm the plan foots at every level.');
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
