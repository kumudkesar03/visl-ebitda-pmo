'use strict';

/**
 * End-to-end API check.   `npm run test:e2e`   (server must already be running)
 *
 * Signs in as each role and walks every endpoint the client uses: reads,
 * scope boundaries, the plan/actual/approval cycle, tasks, milestones, risks,
 * comments, notifications, exports and administration. Works in either data
 * mode, so the same script is the acceptance check on the company server.
 *
 *   E2E_URL=http://localhost:4010  (default)
 *   E2E_PASSWORD=...               admin password (defaults to the synthetic demo password)
 *   E2E_USER_PASSWORD=...          password given to the e2e.* test users it creates (mssql)
 *   E2E_ADMIN=pmo.admin            (mssql: the bootstrap admin; synthetic: kumud.kesar)
 *
 * In mssql mode only the admin account is assumed to exist; the script creates
 * the other role accounts it needs (prefixed e2e.) and deactivates nothing.
 */

const BASE = process.env.E2E_URL || 'http://localhost:4010';
const PASSWORD = process.env.E2E_PASSWORD || 'demo1234';
// Test users created in mssql mode must meet the 10-character rule.
const USER_PASSWORD = process.env.E2E_USER_PASSWORD || 'E2e-Test-Pass-2026';

let passed = 0;
const failures = [];

async function call(session, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(session && session.cookie ? { cookie: session.cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const type = res.headers.get('content-type') || '';
  let data = null;
  if (type.includes('json')) data = await res.json();
  else data = Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}

function check(name, cond, detail) {
  if (cond) { passed += 1; return true; }
  failures.push(`${name}${detail ? `  ->  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}` : ''}`);
  return false;
}

async function expectStatus(name, promise, want) {
  const r = await promise;
  const wants = Array.isArray(want) ? want : [want];
  check(`${name} [${wants.join('|')}]`, wants.includes(r.status), `got ${r.status} ${r.data && r.data.error ? r.data.error : ''}`);
  return r;
}

async function login(employeeId, password = PASSWORD) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ employee_id: employeeId, password }),
  });
  const data = await res.json();
  if (res.status !== 200) throw new Error(`login ${employeeId}: ${res.status} ${data.error}`);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { cookie, user: data.user, id: employeeId };
}

const isoDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function main() {
  const health = await call(null, 'GET', '/api/health');
  check('health', health.status === 200 && health.data.ok, health.data);
  const mode = health.data.dataMode;
  console.log(`\n  E2E against ${BASE}  (data: ${mode}, mail: ${health.data.mailMode})\n`);

  /* ---------- static client ---------- */
  for (const p of ['/app', '/app/initiatives', '/login']) {
    const r = await call(null, 'GET', p);
    check(`static ${p}`, r.status === 200 && String(r.data).includes('<div id="root">') || r.status === 200, `status ${r.status}`);
  }
  await expectStatus('unauthenticated /api/auth/me', call(null, 'GET', '/api/auth/me'), 401);
  await expectStatus('bad password', fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ employee_id: 'nobody', password: 'x' }),
  }).then(async (r) => ({ status: r.status, data: await r.json() })), 401);

  /* ---------- accounts ---------- */
  let S;
  if (mode === 'synthetic') {
    S = {
      admin: await login('kumud.kesar'),
      pmo: await login('visl.pmo1'),
      ceo: await login('visl.ceo'),
      iobPmo: await login('iob.pmo'),
      eslPmo: await login('esl.pmo'),
      iokOwner: await login('iok.own1'),
      viewer: await login('esl.view1'),
    };
  } else {
    const admin = await login(process.env.E2E_ADMIN || 'pmo.admin');
    const want = [
      ['pmo', 'e2e.visl.pmo', 'visl_pmo', 'VISL'],
      ['ceo', 'e2e.visl.ceo', 'visl_exec', 'VISL'],
      ['iobPmo', 'e2e.iob.pmo', 'bu_pmo', 'IOB'],
      ['eslPmo', 'e2e.esl.pmo', 'bu_pmo', 'ESL'],
      ['iokOwner', 'e2e.iok.owner', 'owner', 'IOK'],
      ['viewer', 'e2e.esl.viewer', 'viewer', 'ESL'],
    ];
    S = { admin };
    const existing = (await call(admin, 'GET', '/api/admin/users')).data.users || [];
    for (const [key, id, role, bu] of want) {
      if (!existing.find((u) => u.employee_id === id)) {
        await expectStatus(`create user ${id}`, call(admin, 'POST', '/api/admin/users',
          { employee_id: id, name: `E2E ${role} ${bu}`, email: `${id}@example.invalid`, role, home_bu: bu, password: USER_PASSWORD }), [200, 201]);
      }
      S[key] = await login(id, USER_PASSWORD);
    }
  }

  /* ---------- /me and scope ---------- */
  for (const [k, s] of Object.entries(S)) {
    const r = await expectStatus(`me ${k}`, call(s, 'GET', '/api/auth/me'), 200);
    check(`me ${k} has scope`, Array.isArray(r.data.scope) && r.data.scope.length > 0, r.data.scope);
  }
  const eslScope = (await call(S.eslPmo, 'GET', '/api/auth/me')).data.scope;
  check('ESL PMO scope is ESL only', eslScope.join() === 'ESL', eslScope);

  /* ---------- reference and analytics reads, every role ---------- */
  const reads = ['/api/admin/reference', '/api/dashboard', '/api/initiatives', '/api/tasks', '/api/notifications',
    '/api/matrix', '/api/leaderboard', '/api/admin/access-matrix'];
  for (const [k, s] of Object.entries(S)) {
    for (const p of reads) await expectStatus(`${k} GET ${p}`, call(s, 'GET', p), 200);
    await expectStatus(`${k} GET /api/exec/board`, call(s, 'GET', '/api/exec/board'), 200);
  }

  /* ---------- scope boundaries ---------- */
  const eslList = await call(S.eslPmo, 'GET', '/api/initiatives');
  check('ESL PMO sees only ESL', (eslList.data.rows || []).every((r) => r.bu_code === 'ESL'), (eslList.data.rows || []).map((r) => r.bu_code));
  await expectStatus('ESL PMO ?bu=IOK', call(S.eslPmo, 'GET', '/api/initiatives?bu=IOK'), 403);
  const iobList = await call(S.iobPmo, 'GET', '/api/initiatives');
  check('IOB PMO sees only IOB leaves', (iobList.data.rows || []).every((r) => ['IOK', 'IOG', 'VAB', 'HO'].includes(r.bu_code)));

  /* ---------- initiative lifecycle (VISL PMO creates in IOK) ---------- */
  const ref = (await call(S.pmo, 'GET', '/api/admin/reference')).data;
  const iokDept = (ref.departments || []).find((d) => d.bu_code === 'IOK');
  const created = await expectStatus('create initiative', call(S.pmo, 'POST', '/api/initiatives', {
    title: `E2E initiative ${Date.now()}`,
    bu_code: 'IOK',
    department_id: iokDept ? iokDept.id : null,
    owner_id: S.iokOwner.user.id,
    category: 'ENE',
    target_savings_cr: 1.2,
    priority: 'high',
  }), 201);
  const createdRow = created.data && created.data.initiative;
  if (!createdRow) { report(); return; }
  const init = (await call(S.pmo, 'GET', `/api/initiatives/${createdRow.id}`)).data.initiative;
  check('new initiative has 12 months', (init.months || []).length === 12, (init.months || []).length);
  check('month.period is YYYY-MM-DD', isoDay(init.months && init.months[0] && init.months[0].period), init.months && init.months[0]);
  check('initiative.bu_code is a string', typeof init.bu_code === 'string', init.bu_code);
  check('due_date is YYYY-MM-DD', init.due_date === null || isoDay(init.due_date), init.due_date);

  await expectStatus('create on consolidated IOB rejected', call(S.pmo, 'POST', '/api/initiatives',
    { title: 'bad', bu_code: 'IOB', target_savings_cr: 1 }), [400, 403]);
  await expectStatus('ESL PMO cannot create in IOK', call(S.eslPmo, 'POST', '/api/initiatives',
    { title: 'bad', bu_code: 'IOK', target_savings_cr: 1 }), 403);
  await expectStatus('ESL PMO cannot read IOK initiative', call(S.eslPmo, 'GET', `/api/initiatives/${init.id}`), [403, 404]);
  await expectStatus('viewer cannot create', call(S.viewer, 'POST', '/api/initiatives',
    { title: 'bad', bu_code: 'ESL', target_savings_cr: 1 }), 403);

  const detail = await expectStatus('get initiative', call(S.iokOwner, 'GET', `/api/initiatives/${init.id}`), 200);
  check('owner can book actuals', detail.data.can && detail.data.can.bookActual, detail.data.can);

  await expectStatus('patch initiative', call(S.pmo, 'PATCH', `/api/initiatives/${init.id}`,
    { description: 'Updated by E2E', status: 'in_progress', progress_pct: 10 }), 200);

  /* plan */
  const periods = init.months.map((m) => m.period);
  await expectStatus('plan not footing -> 422', call(S.iokOwner, 'PUT', `/api/initiatives/${init.id}/plan`,
    { entries: periods.map((p) => ({ period: p, plan_cr: 0.05 })) }), 422);
  const planRes = await expectStatus('plan footing -> 200', call(S.iokOwner, 'PUT', `/api/initiatives/${init.id}/plan`,
    { entries: periods.map((p) => ({ period: p, plan_cr: 0.1 })) }), 200);
  check('plan response months periods are strings', (planRes.data.months || []).every((m) => isoDay(m.period)), planRes.data.months && planRes.data.months[0]);

  /* actual: owner submits, ESL PMO cannot see, IOB PMO approves (central policy) */
  const me = (await call(S.pmo, 'GET', '/api/auth/me')).data;
  const subPeriod = me.settings.submission_period;
  const act = await expectStatus('owner submits actual', call(S.iokOwner, 'PUT', `/api/initiatives/${init.id}/actuals/${subPeriod}`,
    { actual_cr: 0.12, remarks: 'E2E submit', action: 'submit' }), 200);
  const monthId = act.data.month && act.data.month.id;
  check('submitted month period is string', isoDay(act.data.month && act.data.month.period), act.data.month);

  await expectStatus('owner cannot open approvals', call(S.iokOwner, 'GET', '/api/approvals'), 403);
  const eslQ = await expectStatus('ESL PMO approvals', call(S.eslPmo, 'GET', '/api/approvals'), 200);
  check('ESL PMO queue excludes IOK entry', !(eslQ.data.rows || []).some((r) => r.id === monthId));
  await expectStatus('ESL PMO cannot approve IOK', call(S.eslPmo, 'POST', `/api/approvals/${monthId}/approve`, {}), [403, 404]);

  const pmoQ = await expectStatus('VISL PMO approvals', call(S.pmo, 'GET', '/api/approvals'), 200);
  const qRow = (pmoQ.data.rows || []).find((r) => r.id === monthId);
  check('entry is in the VISL PMO queue', !!qRow);
  check('queue row period is string', qRow && isoDay(qRow.period), qRow && qRow.period);
  check('queue row bu_code is IOK', qRow && qRow.bu_code === 'IOK', qRow && qRow.bu_code);

  const approver = S.iobPmo;
  const appr = await expectStatus('IOB PMO approves', call(approver, 'POST', `/api/approvals/${monthId}/approve`, { note: 'ok' }), 200);
  check('approved status', appr.data.month && appr.data.month.actual_status === 'approved', appr.data.month);
  await expectStatus('approved month locked for owner', call(S.iokOwner, 'PUT', `/api/initiatives/${init.id}/actuals/${subPeriod}`,
    { actual_cr: 0.5, action: 'save' }), 409);
  await expectStatus('reopen', call(S.pmo, 'POST', `/api/approvals/${monthId}/reopen`, { note: 'E2E reopen' }), 200);

  /* reject path */
  await expectStatus('resubmit', call(S.iokOwner, 'PUT', `/api/initiatives/${init.id}/actuals/${subPeriod}`,
    { actual_cr: 0.11, action: 'submit' }), 200);
  await expectStatus('bulk reject needs note', call(S.pmo, 'POST', '/api/approvals/bulk/reject', { ids: [monthId] }), 400);
  const bulk = await expectStatus('bulk reject', call(S.pmo, 'POST', '/api/approvals/bulk/reject', { ids: [monthId], note: 'E2E' }), 200);
  check('bulk reject succeeded', bulk.data.succeeded === 1, bulk.data);

  /* tasks, milestones, risks, comments */
  const task = await expectStatus('create task', call(S.iokOwner, 'POST', `/api/initiatives/${init.id}/tasks`,
    { title: 'E2E task', assignee_id: S.iokOwner.user.id, status: 'todo', planned_start: periods[0], planned_end: periods[2] }), 201);
  if (task.data.task) {
    await expectStatus('update task', call(S.iokOwner, 'PATCH', `/api/initiatives/${init.id}/tasks/${task.data.task.id}`,
      { status: 'in_progress', progress_pct: 40 }), 200);
  }
  const ms = await expectStatus('create milestone', call(S.pmo, 'POST', `/api/initiatives/${init.id}/milestones`,
    { title: 'E2E milestone', due_date: periods[3] }), 201);
  const risk = await expectStatus('create risk', call(S.pmo, 'POST', `/api/initiatives/${init.id}/risks`,
    { title: 'E2E risk', impact: 'high', likelihood: 'low', mitigation: 'Watch it' }), 201);
  await expectStatus('comment', call(S.iokOwner, 'POST', `/api/initiatives/${init.id}/comments`, { body: 'E2E comment' }), 201);
  await expectStatus('viewer cannot comment', call(S.viewer, 'POST', `/api/initiatives/${init.id}/comments`, { body: 'x' }), [403, 404]);

  const full = await expectStatus('re-read initiative', call(S.pmo, 'GET', `/api/initiatives/${init.id}`), 200);
  const fi = full.data.initiative || {};
  check('detail has task', (fi.tasks || []).length >= 1);
  check('detail has milestone', (fi.milestones || []).length >= 1);
  check('detail has risk', (fi.risks || []).length >= 1);
  check('detail has comment', (fi.comments || []).length >= 1);
  check('detail series has 12 points', Array.isArray(fi.series) ? fi.series.length === 12 : !!fi.series, fi.series && fi.series.length);
  check('task dates are strings', (fi.tasks || []).every((t) => t.planned_end === null || isoDay(t.planned_end)), fi.tasks && fi.tasks[0]);
  check('milestone due_date string', (fi.milestones || []).every((m) => m.due_date === null || isoDay(m.due_date)), fi.milestones && fi.milestones[0]);

  if (ms.data.milestone) await expectStatus('delete milestone', call(S.pmo, 'DELETE', `/api/initiatives/${init.id}/milestones/${ms.data.milestone.id}`), 200);
  if (risk.data.risk) await expectStatus('patch risk', call(S.pmo, 'PATCH', `/api/initiatives/${init.id}/risks/${risk.data.risk.id}`, { status: 'closed' }), 200);

  /* my work, notifications */
  await expectStatus('my work', call(S.iokOwner, 'GET', '/api/my-work'), 200);
  const notes = await expectStatus('owner notifications', call(S.iokOwner, 'GET', '/api/notifications'), 200);
  check('owner got a decision notification', (notes.data.rows || []).length > 0);
  await expectStatus('mark read', call(S.iokOwner, 'POST', '/api/notifications/read', {}), 200);

  /* exports */
  const xl = await call(S.pmo, 'GET', '/api/export/matrix.xlsx?bu=VISL');
  check('xlsx export', xl.status === 200 && Buffer.isBuffer(xl.data) && xl.data.slice(0, 2).toString() === 'PK', `status ${xl.status}`);
  await expectStatus('viewer export forbidden', call(S.viewer, 'GET', '/api/export/matrix.xlsx'), 403);
  await expectStatus('ESL PMO export IOB forbidden', call(S.eslPmo, 'GET', '/api/export/matrix.xlsx?bu=IOB'), 403);

  /* dashboard by BU */
  for (const bu of ['VISL', 'IOB', 'IOK', 'ESL', 'FACOR']) {
    await expectStatus(`dashboard ?bu=${bu}`, call(S.pmo, 'GET', `/api/dashboard?bu=${bu}`), 200);
  }

  /* administration */
  await expectStatus('admin users', call(S.admin, 'GET', '/api/admin/users'), 200);
  await expectStatus('admin settings', call(S.admin, 'GET', '/api/admin/settings'), 200);
  await expectStatus('admin audit', call(S.admin, 'GET', '/api/admin/audit'), 200);
  await expectStatus('admin mail', call(S.admin, 'GET', '/api/admin/mail'), 200);
  await expectStatus('viewer admin users forbidden', call(S.viewer, 'GET', '/api/admin/users'), 403);
  const setMode = await expectStatus('set approval mode local', call(S.admin, 'PUT', '/api/admin/settings/approval.mode', { value: 'local' }), 200);
  if (setMode.status === 200) await call(S.admin, 'PUT', '/api/admin/settings/approval.mode', { value: 'central' });
  await expectStatus('mail job reminders', call(S.admin, 'POST', '/api/admin/mail/run/reminders'), [200, 202]);
  await expectStatus('mail job digest', call(S.admin, 'POST', '/api/admin/mail/run/digest'), [200, 202]);

  /* clean-up: deactivate the test initiative so it drops out of reporting */
  await expectStatus('deactivate test initiative', call(S.pmo, 'PATCH', `/api/initiatives/${init.id}`, { is_active: false }), [200, 404]);

  /* logout */
  await expectStatus('logout', call(S.viewer, 'POST', '/api/auth/logout'), 200);

  report();
}

function report() {
  console.log(`  ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  if (failures.length) console.log('');
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error('  E2E aborted:', err.message);
  report();
});
