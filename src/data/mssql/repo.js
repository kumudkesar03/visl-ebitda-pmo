'use strict';

const bcrypt = require('bcryptjs');
const { sql, query, queryOne, transaction } = require('./pool');
const M = require('../../domain/metrics');
const H = require('../../domain/hierarchy');

/**
 * The SQL Server / Azure SQL repository.
 *
 * Implements exactly the interface exported by src/data/synthetic/repo.js.
 * The route layer cannot tell which one it is talking to; docs/02-ARCHITECTURE.md
 * carries the contract, and adding a method to one means adding it to both.
 *
 * SCOPE IS APPLIED IN SQL, NOT IN JAVASCRIPT.
 *
 * Every read that returns initiative-shaped data joins against a table-valued
 * parameter of permitted business unit codes. Filtering after the fact would
 * mean the database still returns other units' figures across the wire and a
 * single forgotten filter leaks them; here a caller who passes no scope gets
 * an empty set from the server. text.txt s.13.1 records what the alternative
 * cost the ESL build.
 */

/* --------------------------------------------------------------------- *
 * Scope, applied in SQL
 * --------------------------------------------------------------------- */

/**
 * The caller's permitted business units, bound as one comma-separated
 * parameter and expanded server-side with STRING_SPLIT.
 *
 * STRING_SPLIT rather than a table-valued parameter because a TVP needs a
 * user-defined type registered as a separate migration step, and one more
 * object that must exist before the application starts is one more way a
 * deployment half-works. STRING_SPLIT needs nothing installed on Azure SQL or
 * SQL Server 2016+.
 *
 * A missing or empty scope produces an EMPTY STRING, which matches no rows.
 * That is deliberate: a route that forgets to pass scope renders an empty
 * screen, which gets reported and fixed, rather than every business unit's
 * figures, which does not.
 */
function scopeCsv(scope) {
  return Array.isArray(scope) ? scope.map((c) => String(c).toUpperCase()).join(',') : '';
}

/** Join fragment. Requires `b` to be an alias on dbo.business_units. */
const SCOPE_JOIN = "JOIN STRING_SPLIT(@scopeCsv, ',') sc ON sc.value = b.code";

/* --------------------------------------------------------------------- *
 * Reference data
 * --------------------------------------------------------------------- */

async function businessUnits() {
  const rows = await query(`
    SELECT b.id, b.code, b.name, b.short_name, b.is_consolidated, b.accent, b.sort_order, b.is_active,
           p.code AS parent_code
    FROM dbo.business_units b
    LEFT JOIN dbo.business_units p ON p.id = b.parent_id
    WHERE b.is_active = 1
    ORDER BY b.sort_order`);
  return rows.map((r) => ({
    ...r,
    is_consolidated: !!r.is_consolidated,
    is_active: !!r.is_active,
    depth: (H.get(r.code) || { depth: 0 }).depth,
  }));
}

async function categories() {
  return query('SELECT code, name, accent, sort_order FROM dbo.categories ORDER BY sort_order');
}

async function departments(scope) {
  return query(`
    SELECT d.id, d.name, d.code, d.sort_order, d.is_active, b.code AS bu_code, d.business_unit_id
    FROM dbo.departments d
    JOIN dbo.business_units b ON b.id = d.business_unit_id
    ${SCOPE_JOIN}
    WHERE d.is_active = 1
    ORDER BY d.name`, { scopeCsv: scopeCsv(scope) });
}

const USER_SELECT = `
  SELECT u.id, u.employee_id, u.name, u.email, u.role, u.designation, u.phone,
         u.ad_user, u.is_active, u.last_login, u.created_at,
         b.code AS home_bu, u.home_business_unit_id
  FROM dbo.users u
  LEFT JOIN dbo.business_units b ON b.id = u.home_business_unit_id`;

async function users(scope) {
  const rows = await query(`${USER_SELECT}
    JOIN STRING_SPLIT(@scopeCsv, ',') sc ON sc.value = b.code
    WHERE u.is_active = 1 ORDER BY u.name`, { scopeCsv: scopeCsv(scope) });
  return rows.map(shapeUser);
}

async function allUsers() {
  const rows = await query(`${USER_SELECT} ORDER BY u.name`);
  return rows.map(shapeUser);
}

function shapeUser(u) {
  return { ...u, ad_user: !!u.ad_user, is_active: !!u.is_active };
}

async function findUserByEmployeeId(employeeId) {
  // The hash is never selected here. verifyPassword() fetches it on its own,
  // so a user object cannot carry a password hash into a response by accident.
  const row = await queryOne(`${USER_SELECT} WHERE LOWER(u.employee_id) = LOWER(@id)`,
    { id: employeeId });
  return row ? shapeUser(row) : null;
}

async function findUserById(id) {
  const row = await queryOne(`${USER_SELECT} WHERE u.id = @id`, { id: Number(id) });
  return row ? shapeUser(row) : null;
}

/** Local accounts only. AD accounts authenticate through src/services/ad.js. */
async function verifyPassword(user, password) {
  if (!user) return false;
  const row = await queryOne('SELECT password_hash FROM dbo.users WHERE id = @id', { id: user.id });
  if (!row || !row.password_hash) return false;
  return bcrypt.compare(password, row.password_hash);
}

async function touchLogin(id) {
  await query('UPDATE dbo.users SET last_login = SYSUTCDATETIME() WHERE id = @id', { id: Number(id) });
}

async function createUser(payload, actor) {
  // AD accounts never carry a local password: the directory is the only
  // thing that can vouch for them.
  const adUser = !!payload.ad_user;
  const hash = !adUser && payload.password ? await bcrypt.hash(payload.password, 10) : null;
  const rows = await query(`
    INSERT INTO dbo.users (employee_id, name, email, role, home_business_unit_id, designation, phone, password_hash, ad_user, is_active)
    OUTPUT INSERTED.id
    SELECT @employee_id, @name, @email, @role, b.id, @designation, @phone, @hash, @ad_user, 1
    FROM dbo.business_units b WHERE b.code = @home_bu`,
  {
    employee_id: payload.employee_id,
    name: payload.name,
    email: payload.email || null,
    role: payload.role || 'viewer',
    home_bu: String(payload.home_bu).toUpperCase(),
    designation: payload.designation || null,
    phone: payload.phone || null,
    hash,
    ad_user: adUser ? 1 : 0,
  });
  const id = rows[0] && rows[0].id;
  if (!id) throw httpError(400, `Unknown business unit "${payload.home_bu}".`);
  await audit(actor, 'user.create', 'user', id, `Created ${payload.employee_id} as ${payload.role}`);
  return findUserById(id);
}

async function updateUser(id, patch, actor) {
  const sets = [];
  const params = { id: Number(id) };
  const map = { name: 'name', email: 'email', role: 'role', designation: 'designation', phone: 'phone' };
  for (const [key, column] of Object.entries(map)) {
    if (patch[key] !== undefined) { sets.push(`${column} = @${key}`); params[key] = patch[key]; }
  }
  if (patch.is_active !== undefined) { sets.push('is_active = @is_active'); params.is_active = patch.is_active ? 1 : 0; }
  if (patch.ad_user !== undefined) {
    sets.push('ad_user = @ad_user');
    params.ad_user = patch.ad_user ? 1 : 0;
    // Moving to AD retires the local password so it cannot be used as a back door.
    if (patch.ad_user) sets.push('password_hash = NULL');
  }
  if (patch.password && !patch.ad_user) {
    sets.push('password_hash = @hash');
    params.hash = await bcrypt.hash(String(patch.password), 10);
  }
  if (patch.home_bu !== undefined) {
    sets.push('home_business_unit_id = (SELECT id FROM dbo.business_units WHERE code = @home_bu)');
    params.home_bu = String(patch.home_bu).toUpperCase();
  }
  if (!sets.length) return findUserById(id);
  sets.push('updated_at = SYSUTCDATETIME()');
  await query(`UPDATE dbo.users SET ${sets.join(', ')} WHERE id = @id`, params);
  // Field names only - never the password itself.
  await audit(actor, 'user.update', 'user', Number(id), Object.keys(patch).map((k) => (k === 'password' ? 'password reset' : k)).join(', '));
  return findUserById(id);
}

/* --------------------------------------------------------------------- *
 * Settings
 * --------------------------------------------------------------------- */

async function settings() {
  const rows = await query('SELECT skey, svalue FROM dbo.settings');
  return Object.fromEntries(rows.map((r) => [r.skey, r.svalue]));
}

async function setSetting(key, value, actor) {
  await query(`
    MERGE dbo.settings AS t
    USING (SELECT @k AS skey, @v AS svalue) AS s ON t.skey = s.skey
    WHEN MATCHED THEN UPDATE SET svalue = s.svalue, updated_at = SYSUTCDATETIME(), updated_by = @actor
    WHEN NOT MATCHED THEN INSERT (skey, svalue, updated_by) VALUES (s.skey, s.svalue, @actor);`,
  { k: key, v: String(value), actor: actor ? actor.id : null });
  await audit(actor, 'setting.update', 'setting', null, `${key} = ${value}`);
  return settings();
}

/* --------------------------------------------------------------------- *
 * Reporting context
 * --------------------------------------------------------------------- */

/**
 * Everything the metrics layer needs, for the caller's scope only.
 *
 * The month rows are fetched joined to their initiative's business unit so
 * the scope filter is applied server-side; the aggregation itself then happens
 * in src/domain/metrics.js, which keeps ONE implementation of the formulas
 * shared with synthetic mode. The SQL views in sql/03_views.sql compute the
 * same figures for reporting tools and are verified against this path by
 * sql/04_verify.sql.
 */
async function reportingContext(scope) {
  const s = await settings();
  const csv = scopeCsv(scope);

  const initiatives = await query(`
    SELECT r.*
    FROM dbo.vw_initiative_rollup r
    JOIN dbo.business_units b ON b.code = r.bu_code
    ${SCOPE_JOIN}`, { scopeCsv: csv });

  const monthRows = await query(`
    SELECT m.id, m.initiative_id, m.period,
           m.plan_cr, m.actual_cr, m.actual_status, m.remarks,
           m.submitted_by, m.submitted_at, m.approved_by, m.approved_at, m.rejection_note
    FROM dbo.initiative_months m
    JOIN dbo.initiatives i    ON i.id = m.initiative_id AND i.is_active = 1
    JOIN dbo.business_units b ON b.id = i.business_unit_id
    ${SCOPE_JOIN}`, { scopeCsv: csv });

  const fyStart = s['reporting.fy_start'] || '2026-04-01';
  return {
    initiatives,
    monthRows,
    periods: M.fyPeriods(fyStart, 12),
    categories: await categories(),
    closedThrough: s['reporting.closed_through'],
    submissionPeriod: s['reporting.submission_period'],
    settings: s,
  };
}

/* --------------------------------------------------------------------- *
 * Initiatives
 * --------------------------------------------------------------------- */

async function listInitiatives(scope, filters = {}) {
  const clauses = [];
  const params = { scopeCsv: scopeCsv(scope) };

  if (filters.bu) {
    // Expand to descendants in code so the SQL stays a simple IN list.
    params.buCsv = H.descendantsOf(filters.bu).join(',');
    clauses.push('AND r.bu_code IN (SELECT value FROM STRING_SPLIT(@buCsv, \',\'))');
  }
  if (filters.status)        { clauses.push('AND r.status = @status'); params.status = filters.status; }
  if (filters.health)        { clauses.push('AND r.health = @health'); params.health = filters.health; }
  if (filters.category)      { clauses.push('AND r.category = @category'); params.category = filters.category; }
  if (filters.owner_id)      { clauses.push('AND r.owner_id = @owner_id'); params.owner_id = Number(filters.owner_id); }
  if (filters.department_id) { clauses.push('AND r.department_id = @department_id'); params.department_id = Number(filters.department_id); }
  if (filters.q) {
    clauses.push("AND (r.code LIKE @q OR r.title LIKE @q OR ISNULL(r.owner_name,'') LIKE @q)");
    params.q = `%${filters.q}%`;
  }

  const rows = await query(`
    SELECT r.* FROM dbo.vw_initiative_rollup r
    JOIN dbo.business_units b ON b.code = r.bu_code
    ${SCOPE_JOIN}
    WHERE 1 = 1 ${clauses.join(' ')}
    ORDER BY r.target_savings_cr DESC`, params);

  return rows.map(decorate);
}

/** Re-shape a view row into the object the API contract promises. */
function decorate(r) {
  const achievement = M.ratio(r.booked_ptd_cr, r.plan_ptd_cr, 'plan-to-date', 'closed months');
  return {
    ...r,
    is_active: true,
    achievement_ptd: achievement,
    target_delivered: M.ratio(r.booked_fy_cr, r.target_savings_cr, 'full-year target', '12 months'),
    health_computed: M.computedHealth({
      achievementPct: achievement.pct,
      dueDate: r.due_date,
      status: r.status,
      today: new Date(),
    }),
  };
}

async function getInitiative(id, scope) {
  const row = await queryOne(`
    SELECT r.* FROM dbo.vw_initiative_rollup r
    JOIN dbo.business_units b ON b.code = r.bu_code
    ${SCOPE_JOIN}
    WHERE r.id = @id`, { id: Number(id), scopeCsv: scopeCsv(scope) });
  if (!row) return null;

  const [months, tasks, milestones, risks, comments] = await Promise.all([
    query(`SELECT m.* FROM dbo.initiative_months m WHERE m.initiative_id = @id ORDER BY m.period`, { id: Number(id) }),
    query(`SELECT t.*, u.name AS assignee_name FROM dbo.tasks t
           LEFT JOIN dbo.users u ON u.id = t.assignee_id
           WHERE t.initiative_id = @id ORDER BY t.id`, { id: Number(id) }),
    query('SELECT * FROM dbo.milestones WHERE initiative_id = @id ORDER BY sort_order', { id: Number(id) }),
    query('SELECT * FROM dbo.risks WHERE initiative_id = @id ORDER BY id', { id: Number(id) }),
    query(`SELECT c.*, u.name AS user_name FROM dbo.comments c
           LEFT JOIN dbo.users u ON u.id = c.user_id
           WHERE c.entity_type = 'initiative' AND c.entity_id = @id
           ORDER BY c.created_at DESC`, { id: Number(id) }),
  ]);

  const s = await settings();
  const periods = M.fyPeriods(s['reporting.fy_start'], 12);
  const series = M.monthSeries(
    months.map((m) => ({ ...m, initiative_id: row.id })),
    periods,
  );

  return {
    ...decorate(row),
    series,
    months: months.map((m) => ({ ...m, label: M.periodLabel(m.period) })),
    tasks: tasks.map((t) => ({ ...t, bu_code: row.bu_code })),
    milestones,
    risks,
    comments,
  };
}

async function createInitiative(payload, actor) {
  const bu = String(payload.bu_code || '').toUpperCase();
  const unit = H.get(bu);
  if (!unit) throw httpError(400, `Unknown business unit "${payload.bu_code}".`);
  if (unit.consolidated) {
    throw httpError(400, `${bu} is a consolidated reporting node. Initiatives must be raised on a reporting unit (${H.leavesOf(bu).join(', ')}).`);
  }

  const s = await settings();
  const periods = M.fyPeriods(s['reporting.fy_start'], 12);

  const id = await transaction(async (run) => {
    // Next free number after the highest existing BU-nnn code. A COUNT()+1
    // collides as soon as a CSV load has used its own numbering or an
    // initiative has been retired, and codes are UNIQUE.
    const seq = await run(`
      SELECT ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(code, LEN(@bu) + 2, 10))), 0) + 1 AS n
      FROM dbo.initiatives WITH (UPDLOCK, HOLDLOCK)
      WHERE code LIKE @bu + '-%'`, { bu });
    const code = payload.code || `${bu}-${String(seq[0].n).padStart(3, '0')}`;

    const inserted = await run(`
      INSERT INTO dbo.initiatives
        (code, title, description, business_unit_id, department_id, owner_id, owner_name_raw,
         category_code, status, priority, health, progress_pct, target_savings_cr,
         start_date, due_date, created_by, updated_by)
      OUTPUT INSERTED.id
      SELECT @code, @title, @description, b.id, @department_id, @owner_id, @owner_name_raw,
             @category, @status, @priority, @health, 0, @target,
             @start_date, @due_date, @actor, @actor
      FROM dbo.business_units b WHERE b.code = @bu`,
    {
      code, bu,
      title: payload.title,
      description: payload.description || null,
      department_id: payload.department_id || null,
      owner_id: payload.owner_id || null,
      owner_name_raw: payload.owner_name_raw || null,
      category: payload.category || null,
      status: payload.status || 'not_started',
      priority: payload.priority || 'medium',
      health: payload.health || 'green',
      target: Number(payload.target_savings_cr) || 0,
      start_date: payload.start_date || periods[0],
      due_date: payload.due_date || periods[periods.length - 1],
      actor: actor ? actor.id : null,
    });

    const newId = inserted[0].id;
    // The month grid is created with the initiative. An initiative with no
    // grid cannot be planned against, and leaving it to a later import step
    // is how plans ended up living in spreadsheets.
    for (const period of periods) {
      await run(`INSERT INTO dbo.initiative_months (initiative_id, period, plan_cr, actual_status)
                 VALUES (@id, @period, 0, 'draft')`,
      { id: newId, period: { type: sql.Date, value: new Date(period) } });
    }
    return newId;
  });

  await audit(actor, 'initiative.create', 'initiative', id, payload.title);
  return getInitiative(id, [bu]);
}

async function updateInitiative(id, patch, actor) {
  const sets = [];
  const params = { id: Number(id), actor: actor ? actor.id : null };
  const map = {
    title: 'title', description: 'description', department_id: 'department_id',
    owner_id: 'owner_id', status: 'status', priority: 'priority', health: 'health',
    progress_pct: 'progress_pct', target_savings_cr: 'target_savings_cr',
    start_date: 'start_date', due_date: 'due_date',
  };
  for (const [key, column] of Object.entries(map)) {
    if (patch[key] !== undefined) { sets.push(`${column} = @${key}`); params[key] = patch[key]; }
  }
  if (patch.category !== undefined) { sets.push('category_code = @category'); params.category = patch.category; }
  if (patch.is_active !== undefined) { sets.push('is_active = @is_active'); params.is_active = patch.is_active ? 1 : 0; }
  if (!sets.length) return null;

  sets.push('updated_by = @actor', 'updated_at = SYSUTCDATETIME()');
  await query(`UPDATE dbo.initiatives SET ${sets.join(', ')} WHERE id = @id`, params);
  await audit(actor, 'initiative.update', 'initiative', Number(id), Object.keys(patch).join(', '));

  const row = await queryOne('SELECT b.code FROM dbo.initiatives i JOIN dbo.business_units b ON b.id = i.business_unit_id WHERE i.id = @id', { id: Number(id) });
  return getInitiative(id, row ? [row.code] : []);
}

/* --------------------------------------------------------------------- *
 * Plan and actuals
 * --------------------------------------------------------------------- */

async function setPlan(initiativeId, entries, actor) {
  await transaction(async (run) => {
    for (const entry of entries) {
      await run(`UPDATE dbo.initiative_months
                 SET plan_cr = @plan, updated_at = SYSUTCDATETIME()
                 WHERE initiative_id = @id AND period = @period`,
      {
        id: Number(initiativeId),
        period: { type: sql.Date, value: new Date(entry.period) },
        plan: M.round(Number(entry.plan_cr) || 0, 4),
      });
    }
  });
  await audit(actor, 'plan.update', 'initiative', Number(initiativeId), `${entries.length} month(s) updated`);
  return query(`SELECT *
                FROM dbo.initiative_months WHERE initiative_id = @id ORDER BY period`,
  { id: Number(initiativeId) });
}

async function saveActual(initiativeId, period, payload, actor) {
  const existing = await queryOne(`
    SELECT id, actual_status FROM dbo.initiative_months
    WHERE initiative_id = @id AND period = @period`,
  { id: Number(initiativeId), period: { type: sql.Date, value: new Date(period) } });

  if (!existing) throw httpError(404, 'That reporting month does not exist for this initiative.');
  if (existing.actual_status === 'approved' && payload.action !== 'reopen') {
    throw httpError(409, 'This month is approved and locked. Ask the PMO office to reopen it before editing.');
  }

  const submitting = payload.action === 'submit';
  await query(`
    UPDATE dbo.initiative_months SET
      actual_cr      = @actual,
      remarks        = @remarks,
      actual_status  = @status,
      submitted_by   = CASE WHEN @submitting = 1 THEN @actor ELSE submitted_by END,
      submitted_at   = CASE WHEN @submitting = 1 THEN SYSUTCDATETIME() ELSE submitted_at END,
      rejection_note = CASE WHEN @submitting = 1 THEN NULL ELSE rejection_note END,
      updated_at     = SYSUTCDATETIME()
    WHERE id = @id`,
  {
    id: existing.id,
    actual: payload.actual_cr === null || payload.actual_cr === '' ? null : M.round(Number(payload.actual_cr), 4),
    remarks: payload.remarks ?? null,
    status: submitting ? 'submitted' : 'draft',
    submitting: submitting ? 1 : 0,
    actor: actor.id,
  });

  await audit(actor, submitting ? 'actual.submit' : 'actual.save', 'initiative_month', existing.id,
    `${M.periodLabel(period)} = ${payload.actual_cr}`);

  return queryOne(`SELECT *
                   FROM dbo.initiative_months WHERE id = @id`, { id: existing.id });
}

async function decideActual(monthId, decision, actor, note) {
  const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'draft';
  await query(`
    UPDATE dbo.initiative_months SET
      actual_status  = @status,
      approved_by    = CASE WHEN @status = 'approved' THEN @actor ELSE NULL END,
      approved_at    = CASE WHEN @status = 'approved' THEN SYSUTCDATETIME() ELSE NULL END,
      rejection_note = CASE WHEN @status = 'rejected' THEN @note ELSE NULL END,
      updated_at     = SYSUTCDATETIME()
    WHERE id = @id`,
  { id: Number(monthId), status, actor: actor.id, note: note || 'Returned for revision.' });

  await audit(actor, `actual.${decision}`, 'initiative_month', Number(monthId), note || '');
  return queryOne(`SELECT *
                   FROM dbo.initiative_months WHERE id = @id`, { id: Number(monthId) });
}

async function approvalQueue(scope, filters = {}) {
  const params = { scopeCsv: scopeCsv(scope) };
  let extra = '';
  if (filters.bu) { params.buCsv = H.descendantsOf(filters.bu).join(','); extra += " AND q.bu_code IN (SELECT value FROM STRING_SPLIT(@buCsv, ','))"; }
  if (filters.period) { params.period = { type: sql.Date, value: new Date(filters.period) }; extra += ' AND q.period = @period'; }

  const rows = await query(`
    SELECT q.*
    FROM dbo.vw_approval_queue q
    JOIN dbo.business_units b ON b.code = q.bu_code
    ${SCOPE_JOIN}
    WHERE 1 = 1 ${extra}
    ORDER BY q.submitted_at`, params);

  return rows.map((r) => ({
    ...r,
    label: M.periodLabel(r.period),
    variance_pct: r.plan_cr > 0 ? M.round(((r.actual_cr - r.plan_cr) / r.plan_cr) * 100, 1) : null,
  }));
}

/* --------------------------------------------------------------------- *
 * Tasks, milestones, risks, comments
 * --------------------------------------------------------------------- */

async function listTasks(scope, filters = {}) {
  const params = { scopeCsv: scopeCsv(scope) };
  let extra = '';
  if (filters.assignee_id)   { extra += ' AND t.assignee_id = @assignee_id'; params.assignee_id = Number(filters.assignee_id); }
  if (filters.status)        { extra += ' AND t.status = @status'; params.status = filters.status; }
  if (filters.initiative_id) { extra += ' AND t.initiative_id = @initiative_id'; params.initiative_id = Number(filters.initiative_id); }
  if (filters.bu) { params.buCsv = H.descendantsOf(filters.bu).join(','); extra += " AND b.code IN (SELECT value FROM STRING_SPLIT(@buCsv, ','))"; }

  const rows = await query(`
    SELECT t.*, u.name AS assignee_name, i.code AS initiative_code, i.title AS initiative_title,
           b.code AS bu_code,
           CASE WHEN t.planned_end < CAST(GETDATE() AS DATE)
                 AND t.status NOT IN ('done','cancelled') THEN 1 ELSE 0 END AS is_overdue
    FROM dbo.tasks t
    JOIN dbo.initiatives i    ON i.id = t.initiative_id AND i.is_active = 1
    JOIN dbo.business_units b ON b.id = i.business_unit_id
    ${SCOPE_JOIN}
    LEFT JOIN dbo.users u ON u.id = t.assignee_id
    WHERE 1 = 1 ${extra}
    ORDER BY t.planned_end`, params);
  return rows.map((r) => ({ ...r, is_overdue: !!r.is_overdue }));
}

/** Generic CRUD, mirroring makeCrud() in the synthetic repository. */
function makeCrud(table, entity, columns) {
  return {
    async create(payload, actor) {
      const cols = columns.filter((c) => payload[c] !== undefined);
      const rows = await query(`
        INSERT INTO dbo.${table} (initiative_id, ${cols.join(', ')}, created_by)
        OUTPUT INSERTED.*
        VALUES (@initiative_id, ${cols.map((c) => `@${c}`).join(', ')}, @actor)`,
      {
        initiative_id: Number(payload.initiative_id),
        actor: actor ? actor.id : null,
        ...Object.fromEntries(cols.map((c) => [c, payload[c] === '' ? null : payload[c]])),
      });
      await audit(actor, `${entity}.create`, entity, rows[0] && rows[0].id, payload.title || '');
      return rows[0];
    },
    async update(id, patch, actor) {
      const cols = columns.filter((c) => patch[c] !== undefined);
      if (!cols.length) return null;
      const rows = await query(`
        UPDATE dbo.${table} SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.* WHERE id = @id`,
      { id: Number(id), ...Object.fromEntries(cols.map((c) => [c, patch[c] === '' ? null : patch[c]])) });
      await audit(actor, `${entity}.update`, entity, Number(id), cols.join(', '));
      return rows[0] || null;
    },
    async remove(id, actor) {
      await query(`DELETE FROM dbo.${table} WHERE id = @id`, { id: Number(id) });
      await audit(actor, `${entity}.delete`, entity, Number(id), '');
      return true;
    },
  };
}

const taskCrud = makeCrud('tasks', 'task',
  ['code', 'title', 'description', 'assignee_id', 'status', 'priority', 'weight',
    'progress_pct', 'planned_start', 'planned_end', 'actual_start', 'actual_end', 'estimated_savings_cr']);
const milestoneCrud = makeCrud('milestones', 'milestone',
  ['title', 'due_date', 'completed_at', 'status', 'sort_order']);
const riskCrud = makeCrud('risks', 'risk',
  ['title', 'description', 'impact', 'likelihood', 'mitigation', 'owner_id', 'status', 'due_date']);

async function addComment(entityType, entityId, body, actor) {
  const rows = await query(`
    INSERT INTO dbo.comments (entity_type, entity_id, user_id, body)
    OUTPUT INSERTED.* VALUES (@type, @id, @user, @body)`,
  { type: entityType, id: Number(entityId), user: actor.id, body });
  return { ...rows[0], user_name: actor.name };
}

/* --------------------------------------------------------------------- *
 * Notifications and audit
 * --------------------------------------------------------------------- */

async function notificationsFor(userId, { unreadOnly = false, limit = 50 } = {}) {
  const rows = await query(`
    SELECT TOP (@limit) * FROM dbo.notifications
    WHERE user_id = @id ${unreadOnly ? 'AND is_read = 0' : ''}
    ORDER BY created_at DESC`, { id: Number(userId), limit: Number(limit) });
  return rows.map((r) => ({ ...r, is_read: !!r.is_read }));
}

async function pushNotification(userId, payload) {
  const rows = await query(`
    INSERT INTO dbo.notifications (user_id, type, title, body, link)
    OUTPUT INSERTED.* VALUES (@user, @type, @title, @body, @link)`,
  {
    user: Number(userId),
    type: payload.type || 'info',
    title: payload.title,
    body: payload.body || null,
    link: payload.link || null,
  });
  return rows[0];
}

async function markNotificationsRead(userId, ids) {
  if (Array.isArray(ids) && ids.length) {
    await query(`UPDATE dbo.notifications SET is_read = 1
                 WHERE user_id = @id AND id IN (SELECT TRY_CONVERT(int, value) FROM STRING_SPLIT(@ids, ','))`,
    { id: Number(userId), ids: ids.join(',') });
  } else {
    await query('UPDATE dbo.notifications SET is_read = 1 WHERE user_id = @id', { id: Number(userId) });
  }
  return true;
}

async function audit(actor, action, entityType, entityId, details) {
  try {
    await query(`
      INSERT INTO dbo.audit_log (user_id, actor_name, action, entity_type, entity_id, details)
      VALUES (@user, @actor_name, @action, @entity_type, @entity_id, @details)`,
    {
      user: actor ? actor.id : null,
      actor_name: actor ? actor.name : 'System',
      action,
      entity_type: entityType || null,
      entity_id: entityId || null,
      details: details || null,
    });
  } catch (err) {
    // An audit failure must never roll back the action it was recording, but
    // it must be loud - a silent gap in the trail is worse than a noisy log.
    console.error('[audit] could not write audit entry:', err.message);
  }
}

async function auditTrail({ limit = 200 } = {}) {
  return query('SELECT TOP (@limit) * FROM dbo.audit_log ORDER BY created_at DESC', { limit: Number(limit) });
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function reset() {
  throw httpError(400, 'Reset is only available in synthetic data mode.');
}

module.exports = {
  mode: () => 'mssql',
  reset,
  businessUnits, categories, departments,
  users, allUsers, findUserByEmployeeId, findUserById, verifyPassword, touchLogin, updateUser, createUser,
  settings, setSetting,
  reportingContext,
  listInitiatives, getInitiative, createInitiative, updateInitiative,
  setPlan, saveActual, decideActual, approvalQueue,
  listTasks, taskCrud, milestoneCrud, riskCrud, addComment,
  notificationsFor, pushNotification, markNotificationsRead,
  auditTrail, audit,
};
