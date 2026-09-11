'use strict';

const fs = require('fs');
const path = require('path');
const { generate } = require('./generate');
const M = require('../../domain/metrics');
const H = require('../../domain/hierarchy');

/**
 * The synthetic repository.
 *
 * Implements the same interface as src/data/mssql, entirely in memory. Writes
 * are real - an owner books an actual, a PMO approves it, and every dashboard
 * moves - so the whole application including the approval workflow can be
 * reviewed and signed off before a database exists.
 *
 * State is snapshotted to var/state.json after each write so a review survives
 * a restart. Delete that file (or POST /api/system/reset) to return to the
 * generated baseline.
 */

const STATE_FILE = path.join(process.cwd(), 'var', 'state.json');

let db = null;
let saveTimer = null;

function boot() {
  if (db) return db;
  if (fs.existsSync(STATE_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (db && db.initiatives && db.initiatives.length) return db;
    } catch {
      // A corrupt snapshot must never block startup; fall through to a rebuild.
      db = null;
    }
  }
  db = generate();
  persist();
  return db;
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(db));
    } catch (err) {
      console.warn('[synthetic] could not persist state:', err.message);
    }
  }, 120);
}

function reset() {
  db = generate();
  persist();
  return { ok: true, initiatives: db.initiatives.length };
}

const nextId = (rows) => rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
const nowISO = () => new Date().toISOString();

/* --------------------------------------------------------------------- *
 * Scope filtering - the single choke point
 * --------------------------------------------------------------------- */

/**
 * Every read that returns initiative-shaped data passes through here.
 *
 * `scope` is the array of BU codes the caller is permitted to see, resolved
 * from the signed-in user in middleware/auth.js. Passing undefined returns
 * nothing rather than everything: a route that forgets to pass scope produces
 * an empty screen, which gets noticed and fixed, rather than a data leak
 * across business units, which does not.
 */
function inScope(rows, scope, field = 'bu_code') {
  if (!Array.isArray(scope)) return [];
  const allowed = new Set(scope.map((c) => String(c).toUpperCase()));
  return rows.filter((r) => allowed.has(String(r[field] || '').toUpperCase()));
}

/* --------------------------------------------------------------------- *
 * Reference data
 * --------------------------------------------------------------------- */

async function businessUnits() { return boot().businessUnits; }
async function categories() { return boot().categories; }

async function departments(scope) {
  return inScope(boot().departments, scope).sort((a, b) => a.name.localeCompare(b.name));
}

async function users(scope) {
  const d = boot();
  const rows = scope ? inScope(d.users, scope, 'home_bu') : d.users;
  return rows.map(publicUser);
}

async function allUsers() { return boot().users.map(publicUser); }

function publicUser(u) {
  const { password_plain: _pw, ...rest } = u;
  return rest;
}

async function findUserByEmployeeId(employeeId) {
  return boot().users.find((u) => u.employee_id.toLowerCase() === String(employeeId).toLowerCase()) || null;
}
async function findUserById(id) {
  return boot().users.find((u) => u.id === Number(id)) || null;
}

async function verifyPassword(user, password) {
  // Synthetic mode only. The mssql repository compares a bcrypt hash.
  return !!user && user.password_plain === password;
}

async function touchLogin(id) {
  const u = await findUserById(id);
  if (u) { u.last_login = nowISO(); persist(); }
}

async function updateUser(id, patch, actor) {
  const d = boot();
  const u = d.users.find((x) => x.id === Number(id));
  if (!u) return null;
  const allowed = ['name', 'email', 'role', 'home_bu', 'designation', 'phone', 'is_active'];
  for (const k of allowed) if (patch[k] !== undefined) u[k] = patch[k];
  audit(actor, 'user.update', 'user', u.id, `Updated ${u.employee_id}`);
  persist();
  return publicUser(u);
}

async function createUser(payload, actor) {
  const d = boot();
  const u = {
    id: nextId(d.users),
    employee_id: payload.employee_id,
    name: payload.name,
    email: payload.email || `${payload.employee_id}@vedanta.co.in`,
    role: payload.role || 'viewer',
    home_bu: payload.home_bu,
    designation: payload.designation || null,
    department: null,
    phone: payload.phone || null,
    ad_user: false,
    is_active: true,
    password_plain: payload.password || 'demo1234',
    last_login: null,
    created_at: nowISO(),
  };
  d.users.push(u);
  audit(actor, 'user.create', 'user', u.id, `Created ${u.employee_id} as ${u.role}`);
  persist();
  return publicUser(u);
}

/* --------------------------------------------------------------------- *
 * Settings
 * --------------------------------------------------------------------- */

async function settings() { return { ...boot().settings }; }

async function setSetting(key, value, actor) {
  const d = boot();
  d.settings[key] = String(value);
  audit(actor, 'setting.update', 'setting', null, `${key} = ${value}`);
  persist();
  return { ...d.settings };
}

/* --------------------------------------------------------------------- *
 * Reporting context - what the metrics layer consumes
 * --------------------------------------------------------------------- */

async function reportingContext(scope) {
  const d = boot();
  const initiatives = scope ? inScope(d.initiatives, scope) : d.initiatives;
  const ids = new Set(initiatives.map((i) => i.id));
  return {
    initiatives: initiatives.filter((i) => i.is_active),
    monthRows: d.initiativeMonths.filter((m) => ids.has(m.initiative_id)),
    periods: d.periods,
    categories: d.categories,
    closedThrough: d.settings['reporting.closed_through'],
    submissionPeriod: d.settings['reporting.submission_period'],
    settings: d.settings,
  };
}

/* --------------------------------------------------------------------- *
 * Initiatives
 * --------------------------------------------------------------------- */

async function listInitiatives(scope, filters = {}) {
  const d = boot();
  let rows = inScope(d.initiatives, scope).filter((i) => i.is_active);

  if (filters.bu) {
    const wanted = new Set(H.descendantsOf(filters.bu));
    rows = rows.filter((i) => wanted.has(i.bu_code));
  }
  if (filters.status) rows = rows.filter((i) => i.status === filters.status);
  if (filters.health) rows = rows.filter((i) => i.health === filters.health);
  if (filters.category) rows = rows.filter((i) => i.category === filters.category);
  if (filters.owner_id) rows = rows.filter((i) => i.owner_id === Number(filters.owner_id));
  if (filters.department_id) rows = rows.filter((i) => i.department_id === Number(filters.department_id));
  if (filters.q) {
    const q = String(filters.q).toLowerCase();
    rows = rows.filter((i) => `${i.code} ${i.title} ${i.owner_name}`.toLowerCase().includes(q));
  }

  const periods = d.periods;
  const closedThrough = d.settings['reporting.closed_through'];
  return rows.map((i) => decorate(i, d, periods, closedThrough));
}

/** Attach the derived financials an initiative row is never shown without. */
function decorate(i, d, periods, closedThrough) {
  const roll = M.initiativeRollup(i, d.initiativeMonths, periods, closedThrough);
  const tasks = d.tasks.filter((t) => t.initiative_id === i.id);
  const openRisks = d.risks.filter((r) => r.initiative_id === i.id && ['open', 'mitigating'].includes(r.status));
  const today = new Date(d.today);
  return {
    ...i,
    plan_fy_cr: roll.plan_fy_cr,
    plan_ptd_cr: roll.plan_ptd_cr,
    booked_ptd_cr: roll.booked_ptd_cr,
    booked_fy_cr: roll.booked_fy_cr,
    submitted_cr: roll.submitted_cr,
    variance_ptd_cr: roll.variance_ptd_cr,
    achievement_ptd: roll.achievement_ptd,
    target_delivered: roll.target_delivered,
    health_computed: M.computedHealth({
      achievementPct: roll.achievement_ptd.pct,
      dueDate: i.due_date,
      status: i.status,
      today,
    }),
    task_count: tasks.length,
    task_done: tasks.filter((t) => t.status === 'done').length,
    task_overdue: tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled'
      && t.planned_end && new Date(t.planned_end) < today).length,
    open_risks: openRisks.length,
  };
}

async function getInitiative(id, scope) {
  const d = boot();
  const i = inScope(d.initiatives, scope).find((x) => x.id === Number(id));
  if (!i) return null;
  const periods = d.periods;
  const closedThrough = d.settings['reporting.closed_through'];
  const roll = M.initiativeRollup(i, d.initiativeMonths, periods, closedThrough);
  return {
    ...decorate(i, d, periods, closedThrough),
    series: roll.series,
    months: d.initiativeMonths
      .filter((m) => m.initiative_id === i.id)
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((m) => ({ ...m, label: M.periodLabel(m.period) })),
    tasks: d.tasks.filter((t) => t.initiative_id === i.id)
      .map((t) => ({ ...t, assignee_name: nameOf(d, t.assignee_id) })),
    milestones: d.milestones.filter((m) => m.initiative_id === i.id).sort((a, b) => a.sort_order - b.sort_order),
    risks: d.risks.filter((r) => r.initiative_id === i.id),
    comments: d.comments.filter((c) => c.entity_type === 'initiative' && c.entity_id === i.id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
  };
}

function nameOf(d, userId) {
  const u = d.users.find((x) => x.id === Number(userId));
  return u ? u.name : null;
}

async function createInitiative(payload, actor) {
  const d = boot();
  const bu = String(payload.bu_code || '').toUpperCase();
  const unit = H.get(bu);
  if (!unit) throw httpError(400, `Unknown business unit "${payload.bu_code}".`);
  if (unit.consolidated) {
    // The leaf-only rule, enforced at the write boundary rather than trusted.
    throw httpError(400, `${bu} is a consolidated reporting node. Initiatives must be raised on a reporting unit (${H.leavesOf(bu).join(', ')}).`);
  }

  const count = d.initiatives.filter((i) => i.bu_code === bu).length + 1;
  const dept = d.departments.find((x) => x.id === Number(payload.department_id));
  const owner = d.users.find((u) => u.id === Number(payload.owner_id));

  const row = {
    id: nextId(d.initiatives),
    code: payload.code || `${bu}-${String(count).padStart(3, '0')}`,
    title: payload.title,
    description: payload.description || null,
    bu_code: bu,
    business_unit_id: (d.businessUnits.find((b) => b.code === bu) || {}).id,
    department_id: dept ? dept.id : null,
    department_name: dept ? dept.name : null,
    owner_id: owner ? owner.id : null,
    owner_name: owner ? owner.name : null,
    owner_name_raw: owner ? owner.name : payload.owner_name_raw || null,
    category: payload.category || 'OVH',
    category_name: (d.categories.find((c) => c.code === payload.category) || {}).name || null,
    status: payload.status || 'not_started',
    priority: payload.priority || 'medium',
    health: payload.health || 'green',
    progress_pct: 0,
    target_savings_cr: Number(payload.target_savings_cr) || 0,
    start_date: payload.start_date || d.periods[0],
    due_date: payload.due_date || d.periods[d.periods.length - 1],
    is_active: true,
    created_by: actor ? actor.id : null,
    updated_by: actor ? actor.id : null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  d.initiatives.push(row);

  // An initiative without a month grid cannot be planned against, so the grid
  // is created with the row rather than left for a later import step.
  for (const period of d.periods) {
    d.initiativeMonths.push({
      id: nextId(d.initiativeMonths),
      initiative_id: row.id,
      period,
      plan_cr: 0,
      actual_cr: null,
      actual_status: 'draft',
      remarks: null,
      submitted_by: null, submitted_at: null,
      approved_by: null, approved_at: null,
      rejection_note: null,
      updated_at: nowISO(),
    });
  }

  audit(actor, 'initiative.create', 'initiative', row.id, `${row.code} ${row.title}`);
  persist();
  return decorate(row, d, d.periods, d.settings['reporting.closed_through']);
}

async function updateInitiative(id, patch, actor) {
  const d = boot();
  const row = d.initiatives.find((i) => i.id === Number(id));
  if (!row) return null;
  const allowed = ['title', 'description', 'department_id', 'owner_id', 'category', 'status',
    'priority', 'health', 'progress_pct', 'target_savings_cr', 'start_date', 'due_date', 'is_active'];
  const changed = [];
  for (const k of allowed) {
    if (patch[k] !== undefined && patch[k] !== row[k]) {
      changed.push(`${k}: ${row[k]} -> ${patch[k]}`);
      row[k] = patch[k];
    }
  }
  if (patch.owner_id !== undefined) row.owner_name = nameOf(d, patch.owner_id);
  if (patch.department_id !== undefined) {
    const dep = d.departments.find((x) => x.id === Number(patch.department_id));
    row.department_name = dep ? dep.name : null;
  }
  if (patch.category !== undefined) {
    row.category_name = (d.categories.find((c) => c.code === patch.category) || {}).name || null;
  }
  row.updated_by = actor ? actor.id : null;
  row.updated_at = nowISO();
  if (changed.length) audit(actor, 'initiative.update', 'initiative', row.id, changed.join('; '));
  persist();
  return decorate(row, d, d.periods, d.settings['reporting.closed_through']);
}

/* --------------------------------------------------------------------- *
 * Monthly plan and actuals
 * --------------------------------------------------------------------- */

async function setPlan(initiativeId, entries, actor) {
  const d = boot();
  const rows = d.initiativeMonths.filter((m) => m.initiative_id === Number(initiativeId));
  for (const entry of entries) {
    const row = rows.find((m) => m.period === entry.period);
    if (!row) continue;
    row.plan_cr = M.round(Number(entry.plan_cr) || 0, 4);
    row.updated_at = nowISO();
  }
  audit(actor, 'plan.update', 'initiative', Number(initiativeId), `${entries.length} month(s) updated`);
  persist();
  return rows.sort((a, b) => a.period.localeCompare(b.period));
}

async function saveActual(initiativeId, period, payload, actor) {
  const d = boot();
  const row = d.initiativeMonths.find((m) => m.initiative_id === Number(initiativeId) && m.period === period);
  if (!row) throw httpError(404, 'That reporting month does not exist for this initiative.');
  if (row.actual_status === 'approved' && payload.action !== 'reopen') {
    throw httpError(409, 'This month is approved and locked. Ask the PMO office to reopen it before editing.');
  }
  row.actual_cr = payload.actual_cr === null || payload.actual_cr === '' ? null : M.round(Number(payload.actual_cr), 4);
  row.remarks = payload.remarks ?? row.remarks;
  row.updated_at = nowISO();

  if (payload.action === 'submit') {
    row.actual_status = 'submitted';
    row.submitted_by = actor.id;
    row.submitted_at = nowISO();
    row.rejection_note = null;
  } else {
    row.actual_status = 'draft';
  }
  audit(actor, payload.action === 'submit' ? 'actual.submit' : 'actual.save',
    'initiative_month', row.id, `${M.periodLabel(period)} = ${row.actual_cr}`);
  persist();
  return row;
}

async function decideActual(monthId, decision, actor, note) {
  const d = boot();
  const row = d.initiativeMonths.find((m) => m.id === Number(monthId));
  if (!row) throw httpError(404, 'Monthly entry not found.');
  if (decision === 'approve') {
    row.actual_status = 'approved';
    row.approved_by = actor.id;
    row.approved_at = nowISO();
    row.rejection_note = null;
  } else if (decision === 'reject') {
    row.actual_status = 'rejected';
    row.approved_by = null;
    row.approved_at = null;
    row.rejection_note = note || 'Returned for revision.';
  } else if (decision === 'reopen') {
    row.actual_status = 'draft';
    row.approved_by = null;
    row.approved_at = null;
  }
  row.updated_at = nowISO();
  audit(actor, `actual.${decision}`, 'initiative_month', row.id, note || '');
  persist();
  return row;
}

async function approvalQueue(scope, filters = {}) {
  const d = boot();
  const initiatives = new Map(inScope(d.initiatives, scope).map((i) => [i.id, i]));
  return d.initiativeMonths
    .filter((m) => m.actual_status === 'submitted' && initiatives.has(m.initiative_id))
    .filter((m) => !filters.period || m.period === filters.period)
    .filter((m) => !filters.bu || H.descendantsOf(filters.bu).includes(initiatives.get(m.initiative_id).bu_code))
    .map((m) => {
      const i = initiatives.get(m.initiative_id);
      const planned = m.plan_cr || 0;
      return {
        ...m,
        label: M.periodLabel(m.period),
        initiative_code: i.code,
        initiative_title: i.title,
        bu_code: i.bu_code,
        owner_id: i.owner_id,
        owner_name: i.owner_name,
        department_name: i.department_name,
        submitted_by_name: nameOf(d, m.submitted_by),
        variance_cr: M.round((m.actual_cr || 0) - planned, 4),
        variance_pct: planned > 0 ? M.round((((m.actual_cr || 0) - planned) / planned) * 100, 1) : null,
      };
    })
    .sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)));
}

/* --------------------------------------------------------------------- *
 * Tasks, milestones, risks, comments
 * --------------------------------------------------------------------- */

async function listTasks(scope, filters = {}) {
  const d = boot();
  const visible = new Set(inScope(d.initiatives, scope).map((i) => i.id));
  let rows = d.tasks.filter((t) => visible.has(t.initiative_id));
  if (filters.assignee_id) rows = rows.filter((t) => t.assignee_id === Number(filters.assignee_id));
  if (filters.status) rows = rows.filter((t) => t.status === filters.status);
  if (filters.initiative_id) rows = rows.filter((t) => t.initiative_id === Number(filters.initiative_id));
  if (filters.bu) {
    const wanted = new Set(H.descendantsOf(filters.bu));
    rows = rows.filter((t) => wanted.has(t.bu_code));
  }
  const initById = new Map(d.initiatives.map((i) => [i.id, i]));
  const today = new Date(d.today);
  return rows.map((t) => ({
    ...t,
    assignee_name: nameOf(d, t.assignee_id),
    initiative_code: (initById.get(t.initiative_id) || {}).code,
    initiative_title: (initById.get(t.initiative_id) || {}).title,
    is_overdue: !!(t.planned_end && new Date(t.planned_end) < today && !['done', 'cancelled'].includes(t.status)),
  }));
}

function makeCrud(collection, entity, extra = () => ({})) {
  return {
    async create(payload, actor) {
      const d = boot();
      const row = {
        id: nextId(d[collection]),
        ...payload,
        created_by: actor ? actor.id : null,
        created_at: nowISO(),
        updated_at: nowISO(),
        ...extra(payload, d),
      };
      d[collection].push(row);
      audit(actor, `${entity}.create`, entity, row.id, row.title || '');
      persist();
      return row;
    },
    async update(id, patch, actor) {
      const d = boot();
      const row = d[collection].find((r) => r.id === Number(id));
      if (!row) return null;
      Object.assign(row, patch, { updated_at: nowISO() });
      audit(actor, `${entity}.update`, entity, row.id, row.title || '');
      persist();
      return row;
    },
    async remove(id, actor) {
      const d = boot();
      const idx = d[collection].findIndex((r) => r.id === Number(id));
      if (idx < 0) return false;
      const [row] = d[collection].splice(idx, 1);
      audit(actor, `${entity}.delete`, entity, row.id, row.title || '');
      persist();
      return true;
    },
  };
}

const taskCrud = makeCrud('tasks', 'task');
const milestoneCrud = makeCrud('milestones', 'milestone');
const riskCrud = makeCrud('risks', 'risk');

async function addComment(entityType, entityId, body, actor) {
  const d = boot();
  const row = {
    id: nextId(d.comments),
    entity_type: entityType,
    entity_id: Number(entityId),
    user_id: actor.id,
    user_name: actor.name,
    body,
    created_at: nowISO(),
  };
  d.comments.push(row);
  persist();
  return row;
}

/* --------------------------------------------------------------------- *
 * Notifications and audit
 * --------------------------------------------------------------------- */

async function notificationsFor(userId, { unreadOnly = false, limit = 50 } = {}) {
  const d = boot();
  return d.notifications
    .filter((n) => n.user_id === Number(userId))
    .filter((n) => !unreadOnly || !n.is_read)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
}

async function pushNotification(userId, payload) {
  const d = boot();
  const row = {
    id: nextId(d.notifications),
    user_id: Number(userId),
    type: payload.type || 'info',
    title: payload.title,
    body: payload.body || null,
    link: payload.link || null,
    is_read: false,
    created_at: nowISO(),
  };
  d.notifications.push(row);
  persist();
  return row;
}

async function markNotificationsRead(userId, ids) {
  const d = boot();
  d.notifications
    .filter((n) => n.user_id === Number(userId) && (!ids || ids.includes(n.id)))
    .forEach((n) => { n.is_read = true; });
  persist();
  return true;
}

function audit(actor, action, entityType, entityId, details) {
  const d = boot();
  d.auditLog.push({
    id: nextId(d.auditLog),
    user_id: actor ? actor.id : null,
    actor_name: actor ? actor.name : 'System',
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    ip: null,
    created_at: nowISO(),
  });
}

async function auditTrail({ limit = 200 } = {}) {
  return boot().auditLog
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = {
  mode: () => 'synthetic',
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
