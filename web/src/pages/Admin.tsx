import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApp, useToast } from '../context/AppContext';
import { PageHeader, SyntheticBanner } from '../components/Shell';
import { Card, Empty, Loading, BuTag, Alert, Kpi, SectionTitle } from '../components/Primitives';
import { Icon } from '../components/Icons';
import { Modal, ConfirmModal } from '../components/Modal';
import { dateTime, relTime, initials } from '../lib/format';
import { ROLE_LABELS, APPROVAL_MODE_LABELS } from '../lib/vocabulary';
import type { User, Role, ApprovalMode } from '../types/api';

/* ====================================================================== *
 * Users and roles
 * ====================================================================== */

/**
 * User administration.
 *
 * The column that matters is "sees". A role name tells an administrator very
 * little about the blast radius of a change; the concrete list of business
 * units the account can read tells them everything. Promoting somebody from
 * IOK PMO to IOB PMO is a four-unit change, and this screen shows that before
 * the change is saved rather than after somebody notices.
 */
export function AdminUsers() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ users: User[]; roles: Record<string, any>; businessUnits: any[]; authMode: string; dataMode: string }>('/admin/users'),
  });

  const save = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<User> }) => api.patch(`/admin/users/${id}`, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); push('User updated.', 'success'); setEditing(null); },
    onError: (e: any) => push(e.message, 'error'),
  });

  const users = (data?.users ?? []).filter((u) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return `${u.name} ${u.employee_id} ${u.role} ${u.home_bu}`.toLowerCase().includes(q);
  });

  return (
    <>
      <PageHeader title="Users & roles" subtitle={data ? `${data.users.length} accounts` : 'Loading…'}>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Icon name="plus" /> Add user</button>
      </PageHeader>

      <div className="content">
        <SyntheticBanner />
        <Alert tone="info">
          A user&rsquo;s visibility is their <b>home business unit and everything beneath it</b>. VISL roles see
          the whole estate; an IOB PMO sees IOK, IOG, VAB and HO; an IOK owner sees only IOK. Approval authority
          is separate and follows the policy set under System.
        </Alert>

        <div className="filter-bar">
          <input className="input search" placeholder="Search name, user ID, role or unit…"
            value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>

        <Card bodyClass="tight">
          {isLoading || !data ? <div style={{ padding: 18 }}><Loading rows={9} /></div> : (
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>User</th><th>User ID</th><th>Sign-in</th><th>Role</th><th>Home unit</th>
                    <th>Sees</th><th>Can edit</th><th>Last sign-in</th><th>Active</th><th style={{ width: 60 }} />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <span className="row gap-8">
                          <span style={{
                            width: 26, height: 26, borderRadius: '50%', flex: '0 0 26px', background: 'var(--ink-150)',
                            color: 'var(--ink-600)', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700,
                          }}>{initials(u.name)}</span>
                          <span>
                            <span className="strong">{u.name}</span>
                            <div className="tiny muted">{u.designation}</div>
                          </span>
                        </span>
                      </td>
                      <td className="code">{u.employee_id}</td>
                      <td>{u.ad_user ? <span className="badge blue">Active Directory</span> : <span className="badge">Local</span>}</td>
                      <td><span className="badge blue">{ROLE_LABELS[u.role]}</span></td>
                      <td><BuTag code={u.home_bu} /></td>
                      <td>
                        <span className="tiny mono muted">{(u.sees ?? []).join(' ')}</span>
                      </td>
                      <td>
                        <span className="tiny mono muted">
                          {(u.can_write ?? []).length === 0 ? <span className="dim">read only</span> : (u.can_write ?? []).join(' ')}
                        </span>
                      </td>
                      <td className="small muted nowrap">{u.last_login ? relTime(u.last_login) : <span className="dim">never</span>}</td>
                      <td>{u.is_active ? <span className="badge green">Active</span> : <span className="badge">Disabled</span>}</td>
                      <td>
                        <button className="icon-btn" onClick={() => setEditing(u)}><Icon name="edit" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {editing && data && (
        <UserForm
          user={editing}
          authMode={data.authMode}
          dataMode={data.dataMode}
          businessUnits={data.businessUnits}
          busy={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(patch) => save.mutate({ id: editing.id, patch })}
        />
      )}
      {creating && data && (
        <UserForm
          authMode={data.authMode}
          dataMode={data.dataMode}
          businessUnits={data.businessUnits}
          busy={false}
          onClose={() => setCreating(false)}
          onSave={async (patch) => {
            try {
              await api.post('/admin/users', patch);
              qc.invalidateQueries({ queryKey: ['admin-users'] });
              push('User created.', 'success');
              setCreating(false);
            } catch (e: any) { push(e.message, 'error'); }
          }}
        />
      )}
    </>
  );
}

function UserForm({ user, businessUnits, onSave, onClose, busy, authMode, dataMode }: {
  user?: User; businessUnits: any[]; onSave: (patch: any) => void; onClose: () => void; busy: boolean;
  authMode: string; dataMode: string;
}) {
  const [form, setForm] = useState({
    employee_id: user?.employee_id ?? '',
    name: user?.name ?? '',
    email: user?.email ?? '',
    designation: user?.designation ?? '',
    role: (user?.role ?? 'viewer') as Role,
    home_bu: user?.home_bu ?? 'ESL',
    is_active: user?.is_active ?? true,
    // New accounts default to AD once the directory is connected.
    ad_user: user ? !!user.ad_user : authMode !== 'local',
    password: '',
  });

  // A local account created against the real database has no other way in.
  const needsPassword = !user && !form.ad_user && dataMode === 'mssql';
  const pwShort = !form.ad_user && form.password.length > 0 && form.password.length < 10;
  const invalid = !form.name || !form.employee_id || pwShort || (needsPassword && !form.password);
  const payload = () => {
    const { password, ...rest } = form;
    return form.ad_user || !password ? rest : { ...rest, password };
  };

  // Recomputed live so the administrator sees the effect of the role and unit
  // they have just picked, before they commit to it.
  const preview = previewScope(form.role, form.home_bu, businessUnits);

  return (
    <Modal
      title={user ? `Edit ${user.name}` : 'Add user'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || invalid} onClick={() => onSave(payload())}>
            <Icon name="save" /> Save
          </button>
        </>
      }
    >
      <div className="field-row">
        <div className="field">
          <label>User ID</label>
          <input className="input" value={form.employee_id} disabled={!!user}
            onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))} />
          <span className="help">{form.ad_user ? 'Their Windows / AD logon name (sAMAccountName), e.g. kumud.kesar.' : 'Any unique ID. Used only to sign in to this application.'}</span>
        </div>
        <div className="field">
          <label>Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Email</label>
          <input className="input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </div>
        <div className="field">
          <label>Designation</label>
          <input className="input" value={form.designation ?? ''} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Role</label>
          <select className="select" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Home business unit</label>
          <select className="select" value={form.home_bu} onChange={(e) => setForm((f) => ({ ...f, home_bu: e.target.value }))}>
            {businessUnits.map((b) => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Sign-in method</label>
        <div className="btn-group">
          <button type="button" className={`btn btn-outline btn-sm ${form.ad_user ? 'on' : ''}`}
            onClick={() => setForm((f) => ({ ...f, ad_user: true, password: '' }))}>Active Directory</button>
          <button type="button" className={`btn btn-outline btn-sm ${!form.ad_user ? 'on' : ''}`}
            onClick={() => setForm((f) => ({ ...f, ad_user: false }))}>Local password</button>
        </div>
        <span className="help">
          {form.ad_user
            ? (authMode === 'local'
              ? 'Signs in with their company (AD) password once AUTH_MODE is set to ad or hybrid. Until then this account cannot sign in.'
              : 'Signs in with their company (AD) password. Nothing is stored here.')
            : (authMode === 'ad'
              ? 'AUTH_MODE is ad: local passwords are not accepted. Use hybrid to keep a break-glass local administrator.'
              : 'For service and break-glass accounts. Stored as a bcrypt hash.')}
        </span>
      </div>

      {!form.ad_user && (
        <div className="field">
          <label>{user ? 'Reset password (leave blank to keep)' : 'Initial password'}</label>
          <input className="input" type="password" autoComplete="new-password" value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
          <span className="help" style={pwShort ? { color: 'var(--red-600)' } : undefined}>
            At least 10 characters. Share it with the user directly, never by mail.
          </span>
        </div>
      )}

      <Alert tone={preview.global ? 'amber' : 'info'}>
        {preview.global
          ? <>This role sees <b>every business unit</b> across VISL, regardless of home unit.</>
          : <>This account will see <b>{preview.units.join(', ') || 'nothing'}</b>.</>}
      </Alert>

      {user && (
        <label className="row gap-8 small" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={form.is_active}
            onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
          Account is active
        </label>
      )}
    </Modal>
  );
}

function previewScope(role: Role, homeBu: string, units: any[]) {
  const global = ['admin', 'visl_pmo', 'visl_exec'].includes(role);
  if (global) return { global: true, units: units.map((u) => u.code) };
  const descend = (code: string): string[] => {
    const kids = units.filter((u) => u.parent_code === code);
    return [code, ...kids.flatMap((k) => descend(k.code))];
  };
  return { global: false, units: descend(homeBu) };
}

/* ====================================================================== *
 * Access model
 * ====================================================================== */

/**
 * The permission matrix, rendered from the server's own grant table.
 *
 * It is not documentation that can go stale - it is the live authorisation
 * data. If a role gains a permission, this page shows it on the next reload.
 * The approval-policy comparison beneath it answers text.txt 13.6(b) by
 * demonstration rather than description.
 */
export function AdminAccess() {
  const { data, isLoading } = useQuery({
    queryKey: ['access-matrix'],
    queryFn: () => api.get<any>('/admin/access-matrix'),
  });

  if (isLoading || !data) {
    return (<><PageHeader title="Access model" /><div className="content"><Card><Loading rows={8} /></Card></div></>);
  }

  return (
    <>
      <PageHeader title="Access model" subtitle="Live authorisation data, read from the server's own grant table" />
      <div className="content">
        <Alert tone="info">
          This is not a description of the access model — it is the model itself, rendered. Every tick is a
          permission the API will actually honour.
        </Alert>

        <Card title="Roles" style={{ marginBottom: 14 }} bodyClass="tight">
          <div className="table-wrap">
            <table className="grid compact">
              <thead><tr><th>Role</th><th>Scope</th><th>What it is for</th><th className="right">Permissions</th></tr></thead>
              <tbody>
                {data.roles.map((r: any) => (
                  <tr key={r.code}>
                    <td><span className="badge blue">{r.label}</span></td>
                    <td>{r.global ? <span className="badge amber">All units</span> : <span className="badge">Home unit and below</span>}</td>
                    <td className="small muted">{r.description}</td>
                    <td className="right num">{r.grants.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Permission matrix" bodyClass="tight" style={{ marginBottom: 14 }}>
          <div className="table-wrap">
            <table className="grid compact">
              <thead>
                <tr>
                  <th style={{ minWidth: 190 }}>Permission</th>
                  {data.roles.map((r: any) => <th key={r.code} className="center" style={{ writingMode: 'vertical-rl', height: 108, padding: '8px 4px' }}>{r.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.permissions.map((p: string) => (
                  <tr key={p}>
                    <td className="code">{p}</td>
                    {data.roles.map((r: any) => (
                      <td key={r.code} className="center">
                        {r.grants.includes(p)
                          ? <Icon name="check" style={{ width: 14, height: 14, color: 'var(--green-600)' }} />
                          : <span className="dim">·</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Approval policy — who approves whom"
          hint="Leadership decision, not a technical one. Changing it under System changes every queue immediately."
          bodyClass="tight"
        >
          <div className="table-wrap">
            <table className="grid compact">
              <thead>
                <tr>
                  <th>Reporting unit</th>
                  {data.approvalModes.map((m: any) => <th key={m.mode}>{APPROVAL_MODE_LABELS[m.mode as ApprovalMode]}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.approvalModes[0].example.map((row: any, idx: number) => (
                  <tr key={row.unit}>
                    <td><BuTag code={row.unit} /></td>
                    {data.approvalModes.map((m: any) => (
                      <td key={m.mode}><BuTag code={m.example[idx].approvedBy} /> PMO</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ====================================================================== *
 * Mail outbox
 * ====================================================================== */

/**
 * The mail outbox.
 *
 * With SMTP disabled, every intimation the system would have sent is rendered
 * in full and kept here. The business can read the real messages - wording,
 * figures, recipients - and sign them off before a single mail reaches an
 * employee. Running a job from this screen generates the messages without
 * sending them, which is what makes the review possible at all.
 */
export function AdminMail() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [preview, setPreview] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['mail'],
    queryFn: () => api.get<{ mode: string; enabled: boolean; templates: string[]; messages: any[] }>('/admin/mail'),
  });

  const run = useMutation({
    mutationFn: (job: string) => api.post<{ sent: any[] }>(`/admin/mail/run/${job}`),
    onSuccess: (res, job) => {
      qc.invalidateQueries({ queryKey: ['mail'] });
      push(`${job === 'digest' ? 'Digest' : 'Reminders'} generated — ${res.sent.length} message(s).`, 'success');
    },
    onError: (e: any) => push(e.message, 'error'),
  });

  return (
    <>
      <PageHeader title="Mail outbox" subtitle={data ? `${data.mode} mode · ${data.messages.length} messages` : 'Loading…'}>
        <button className="btn btn-outline btn-sm" disabled={run.isPending} onClick={() => run.mutate('reminders')}>
          <Icon name="bell" /> Run submission reminders
        </button>
        <button className="btn btn-outline btn-sm" disabled={run.isPending} onClick={() => run.mutate('digest')}>
          <Icon name="send" /> Run leadership digest
        </button>
      </PageHeader>

      <div className="content">
        {data && (
          data.enabled ? (
            <Alert tone="red">
              <b>SMTP is enabled.</b> Messages generated from this screen will be delivered to real recipients.
            </Alert>
          ) : (
            <Alert tone="green">
              <b>Outbox mode — nothing is being sent.</b> Every message is rendered and stored so the wording,
              figures and recipient list can be reviewed and signed off before SMTP is switched on.
              Set <code>SMTP_ENABLED=true</code> in <code>.env</code> when the business has approved them.
            </Alert>
          )
        )}

        <Card bodyClass="tight">
          {isLoading || !data ? <div style={{ padding: 18 }}><Loading rows={7} /></div>
            : data.messages.length === 0 ? (
              <Empty title="No messages yet">
                Submit or approve a monthly actual, or run one of the jobs above, to generate messages.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="grid compact">
                  <thead><tr><th>Sent</th><th>Template</th><th>To</th><th>Subject</th><th>Delivered</th><th style={{ width: 80 }} /></tr></thead>
                  <tbody>
                    {data.messages.map((m) => (
                      <tr key={m.id}>
                        <td className="small nowrap muted">{dateTime(m.sent_at)}</td>
                        <td><span className="badge">{m.template}</span></td>
                        <td className="small">{m.to}</td>
                        <td className="small strong" style={{ maxWidth: 360 }}>{m.subject}</td>
                        <td>{m.delivered ? <span className="badge green">Sent</span> : <span className="badge">Held</span>}</td>
                        <td>
                          <button className="btn btn-outline btn-xs" onClick={() => setPreview(m.id)}>Preview</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
      </div>

      {preview && (
        <Modal title="Message preview" subtitle="Rendered exactly as the recipient would receive it" wide onClose={() => setPreview(null)}>
          <iframe
            title="Mail preview" src={`/api/admin/mail/${preview}`}
            style={{ width: '100%', height: '62vh', border: '1px solid var(--ink-200)', borderRadius: 8, background: '#fff' }}
          />
        </Modal>
      )}
    </>
  );
}

/* ====================================================================== *
 * System settings
 * ====================================================================== */

export function AdminSettings() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { session } = useApp();
  const [resetting, setResetting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<any>('/admin/settings'),
  });

  const setSetting = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => api.put(`/admin/settings/${key}`, { value }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['approvals'] });
      push(`${v.key} updated.`, 'success');
    },
    onError: (e: any) => push(e.message, 'error'),
  });

  const reset = useMutation({
    mutationFn: () => api.post('/admin/system/reset'),
    onSuccess: () => { window.location.reload(); },
    onError: (e: any) => { push(e.message, 'error'); setResetting(false); },
  });

  if (isLoading || !data) {
    return (<><PageHeader title="System" /><div className="content"><Card><Loading rows={8} /></Card></div></>);
  }

  const s = data.settings;

  return (
    <>
      <PageHeader title="System" subtitle={`${data.dataMode} data · ${data.mailMode} mail · Node ${data.env.node}`} />

      <div className="content content-narrow">
        <div className="kpi-band" style={{ marginBottom: 16 }}>
          <Kpi label="Data source" value={data.dataMode === 'synthetic' ? 'Synthetic' : 'Azure SQL'}
            accent={data.dataMode === 'synthetic' ? 'amber' : 'green'}
            basis={data.dataMode === 'synthetic' ? 'DATA_MODE=synthetic in .env' : 'DATA_MODE=mssql in .env'} />
          <Kpi label="Mail" value={data.mailMode === 'outbox' ? 'Outbox' : 'SMTP'}
            accent={data.mailMode === 'outbox' ? 'blue' : 'green'}
            basis={data.mailMode === 'outbox' ? 'Rendered and held, nothing sent' : 'Delivering to real recipients'} />
          <Kpi label="Authentication" value={data.env.authMode} accent="navy"
            basis={data.env.authMode === 'local' ? 'Local accounts; AD not yet connected' : 'Active Directory'} />
          <Kpi label="Financial year" value={s['reporting.fy_label']} accent="navy"
            basis={`Starts ${s['reporting.fy_start']}`} />
        </div>

        <Card title="Reporting calendar" hint="What the application treats as closed, and what it is collecting" style={{ marginBottom: 14 }}>
          <Alert tone="info">
            <b>Closed through</b> is the last month settled for reporting — everything up to it counts as banked
            and drives plan-to-date. <b>Collection month</b> is the month owners are entering now. Keeping them
            apart is what stops every dashboard understating delivery in the first fortnight of a month.
          </Alert>
          <div className="field-row">
            <div className="field">
              <label>Closed through</label>
              <input className="input" type="month"
                defaultValue={String(s['reporting.closed_through']).slice(0, 7)}
                onBlur={(e) => setSetting.mutate({ key: 'reporting.closed_through', value: `${e.target.value}-01` })} />
            </div>
            <div className="field">
              <label>Collection month</label>
              <input className="input" type="month"
                defaultValue={String(s['reporting.submission_period']).slice(0, 7)}
                onBlur={(e) => setSetting.mutate({ key: 'reporting.submission_period', value: `${e.target.value}-01` })} />
            </div>
          </div>
        </Card>

        <Card title="Approval policy" hint="Who approves monthly actuals" style={{ marginBottom: 14 }}>
          <Alert tone="amber">
            This answers the open question recorded in the handover: do IOK, IOG, VAB and HO approve their own
            months, or does IOB PMO approve centrally? It is a leadership decision. Changing it here changes
            every approval queue immediately — no migration, no code change.
          </Alert>
          <div className="stack gap-8">
            {(['local', 'central', 'visl'] as ApprovalMode[]).map((mode) => (
              <label key={mode} className="row gap-10" style={{
                padding: '11px 13px', border: '1px solid var(--ink-200)', borderRadius: 8, cursor: 'pointer',
                background: s['approval.mode'] === mode ? 'var(--blue-50)' : undefined,
                borderColor: s['approval.mode'] === mode ? 'var(--blue-500)' : undefined,
              }}>
                <input type="radio" name="approval" checked={s['approval.mode'] === mode}
                  onChange={() => setSetting.mutate({ key: 'approval.mode', value: mode })} />
                <span className="grow">
                  <span className="strong small">{APPROVAL_MODE_LABELS[mode]}</span>
                  <div className="tiny muted">
                    {mode === 'local' && 'IOK PMO approves IOK. Fastest, and closest to the work.'}
                    {mode === 'central' && 'IOB PMO approves IOK, IOG, VAB and HO. One pair of eyes across the business.'}
                    {mode === 'visl' && 'VISL PMO approves everything. Tightest control, heaviest central load.'}
                  </div>
                </span>
              </label>
            ))}
          </div>

          <SectionTitle hint="Maker-checker. A user can never approve a figure they submitted themselves.">
            <span style={{ marginTop: 16, display: 'inline-block' }}>Self-approval</span>
          </SectionTitle>
          <label className="row gap-8 small" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={s['approval.self_approval_allowed'] === 'true'}
              onChange={(e) => setSetting.mutate({ key: 'approval.self_approval_allowed', value: String(e.target.checked) })} />
            Allow a user to approve their own submission (not recommended)
          </label>
        </Card>

        {data.dataMode === 'synthetic' && (
          <Card title="Synthetic dataset" hint="Design-review data only">
            <p className="small muted">
              Every edit you make in this mode is real and persists to <code>var/state.json</code>, so a review
              session survives a restart. Resetting rebuilds the generated baseline and discards those edits.
            </p>
            <button className="btn btn-danger btn-sm" onClick={() => setResetting(true)}>
              <Icon name="refresh" /> Reset to generated baseline
            </button>
          </Card>
        )}

        <p className="tiny muted" style={{ marginTop: 16 }}>
          Signed in as {session.user.name} · {data.env.appUrl}
        </p>
      </div>

      {resetting && (
        <ConfirmModal
          title="Reset the synthetic dataset?"
          message={<>Every initiative, plan figure, actual, approval and comment entered during this review will
            be discarded and the generated baseline rebuilt. This cannot be undone.</>}
          confirmLabel="Reset dataset"
          busy={reset.isPending}
          onConfirm={() => reset.mutate()}
          onClose={() => setResetting(false)}
        />
      )}
    </>
  );
}
