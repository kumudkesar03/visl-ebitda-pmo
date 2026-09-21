import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useApp } from '../context/AppContext';
import { PageHeader, SyntheticBanner } from '../components/Shell';
import { Card, Empty, Loading, BuTag, StatusBadge, ProgressBar, Alert } from '../components/Primitives';
import { Icon } from '../components/Icons';
import { cr, crSigned, pct, dateShort, varianceTone, achievementTone, relTime, initials } from '../lib/format';
import { statusLabel, TASK_STATUS_OPTIONS } from '../lib/vocabulary';
import type { MonthPoint, Ratio, Task, Notification } from '../types/api';

/* ====================================================================== *
 * Savings matrix
 * ====================================================================== */

interface MatrixResponse {
  node: { code: string; name: string };
  periods: { period: string; label: string }[];
  window: { closedThrough: string | null; closed: string[] };
  rows: {
    id: number; code: string; title: string; bu_code: string;
    owner_name: string | null; department_name: string | null; target_savings_cr: number;
    cells: Record<string, { plan_cr: number; actual_cr: number | null; status: string }>;
  }[];
  totals: MonthPoint[];
}

/**
 * The savings matrix.
 *
 * This is the screen that replaces the circulated spreadsheet, so it has to do
 * what the spreadsheet did well: every initiative against every month, on one
 * surface, scannable. The two things it adds are that the totals row is
 * computed by the same code as the board (not a formula somebody dragged) and
 * that each cell carries its approval state, so an unapproved figure is never
 * silently read as delivered.
 */
export function Matrix() {
  const { bu, can } = useApp();
  const [mode, setMode] = useState<'plan' | 'actual' | 'both'>('both');

  const { data, isLoading } = useQuery({
    queryKey: ['matrix', bu],
    queryFn: () => api.get<MatrixResponse>(`/matrix${qs({ bu })}`),
    enabled: !!bu,
  });

  const closed = new Set(data?.window.closed ?? []);

  return (
    <>
      <PageHeader title="Savings matrix" subtitle={data ? `${data.rows.length} initiatives · ${data.node.name}` : 'Loading…'}>
        <div className="btn-group">
          {(['plan', 'actual', 'both'] as const).map((m) => (
            <button key={m} className={`btn btn-outline btn-sm ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>
              {m === 'both' ? 'Both' : m === 'plan' ? 'Plan' : 'Actual'}
            </button>
          ))}
        </div>
        {can('report:export') && (
          <a className="btn btn-outline btn-sm" href={`/api/export/matrix.xlsx${qs({ bu })}`}>
            <Icon name="download" /> Excel
          </a>
        )}
      </PageHeader>

      <div className="content">
        <SyntheticBanner />
        <Alert tone="neutral">
          Grey columns are closed reporting months. An actual is shown only once it has been <b>approved</b> —
          figures still in the approval queue are marked with a dot and are not counted in the totals row.
        </Alert>

        <Card bodyClass="tight">
          {isLoading || !data ? <div style={{ padding: 18 }}><Loading rows={9} /></div>
            : data.rows.length === 0 ? <Empty title="Nothing to show" />
              : (
                <div className="table-wrap">
                  <table className="month-grid">
                    <thead>
                      <tr>
                        <th style={{ minWidth: 260 }}>Initiative</th>
                        <th>Target</th>
                        {data.periods.map((p) => (
                          <th key={p.period} style={{ background: closed.has(p.period) ? 'var(--ink-150)' : undefined }}>
                            {p.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <Link to={`/initiatives/${r.id}`} className="strong">{r.title}</Link>
                            <div className="tiny muted">
                              <span className="mono">{r.code}</span> · {r.bu_code} · {r.owner_name}
                            </div>
                          </td>
                          <td className="strong">{cr(r.target_savings_cr)}</td>
                          {data.periods.map((p) => {
                            const c = r.cells[p.period];
                            const approved = c?.status === 'approved';
                            return (
                              <td key={p.period} style={{ background: closed.has(p.period) ? 'var(--ink-50)' : undefined }}>
                                {!c || (c.plan_cr === 0 && c.actual_cr === null) ? <span className="dim">·</span> : (
                                  <>
                                    {(mode === 'plan' || mode === 'both') && (
                                      <div className="muted" style={{ fontSize: 11.5 }}>{cr(c.plan_cr)}</div>
                                    )}
                                    {(mode === 'actual' || mode === 'both') && (
                                      <div className="strong" style={{ fontSize: 12 }}>
                                        {c.actual_cr === null ? <span className="dim">--</span> : (
                                          <span className={approved ? '' : 'muted'}>
                                            {cr(c.actual_cr)}
                                            {!approved && <i className="dot amber" style={{ width: 5, height: 5, marginLeft: 3, verticalAlign: 'middle' }} />}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="total-row">
                        <td style={{ background: 'var(--navy-900)', color: '#fff' }}>Total plan</td>
                        <td>{cr(data.totals.reduce((a, t) => a + t.plan_cr, 0))}</td>
                        {data.totals.map((t) => <td key={t.period}>{cr(t.plan_cr)}</td>)}
                      </tr>
                      <tr className="total-row">
                        <td style={{ background: 'var(--navy-900)', color: '#fff' }}>Total booked</td>
                        <td>{cr(data.totals.reduce((a, t) => a + t.booked_cr, 0))}</td>
                        {data.totals.map((t) => <td key={t.period}>{t.booked_cr > 0 ? cr(t.booked_cr) : '--'}</td>)}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
        </Card>
      </div>
    </>
  );
}

/* ====================================================================== *
 * Performance / leaderboard
 * ====================================================================== */

interface LeaderboardResponse {
  byOwner: {
    owner_id: number; owner_name: string; bu_code: string; initiatives: number;
    target_cr: number; plan_ptd_cr: number; booked_ptd_cr: number;
    red: number; overdue_tasks: number; achievement: Ratio;
  }[];
  byDepartment: {
    code: string; name: string; initiative_count: number; target_cr: number;
    plan_ptd_cr: number; booked_ptd_cr: number; variance_ptd_cr: number; achievement_pct: number | null;
  }[];
}

/**
 * Performance by owner and department.
 *
 * Ranked by achievement against plan-to-date, not by absolute value banked -
 * otherwise the owner of the largest initiative wins every month regardless of
 * how they are actually doing, and the ranking stops meaning anything.
 */
export function Leaderboard() {
  const { bu } = useApp();
  const [tab, setTab] = useState<'owner' | 'department'>('owner');

  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', bu],
    queryFn: () => api.get<LeaderboardResponse>(`/leaderboard${qs({ bu })}`),
    enabled: !!bu,
  });

  return (
    <>
      <PageHeader title="Performance" subtitle="Ranked by achievement against plan for closed months">
      </PageHeader>

      <div className="content">
        <SyntheticBanner />

        <div className="tabs">
          <button className={tab === 'owner' ? 'active' : ''} onClick={() => setTab('owner')}>By owner</button>
          <button className={tab === 'department' ? 'active' : ''} onClick={() => setTab('department')}>By department</button>
        </div>

        <Card bodyClass="tight">
          {isLoading || !data ? <div style={{ padding: 18 }}><Loading rows={8} /></div> : tab === 'owner' ? (
            data.byOwner.length === 0 ? <Empty title="No owners in scope" /> : (
              <div className="table-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th><th>Owner</th><th>Unit</th>
                      <th className="right">Initiatives</th><th className="right">Target</th>
                      <th className="right">Plan to date</th><th className="right">Booked</th>
                      <th className="right">Achievement</th><th className="right">Off track</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byOwner.map((o, idx) => (
                      <tr key={o.owner_id}>
                        <td className="num muted">{idx + 1}</td>
                        <td>
                          <span className="row gap-8">
                            <span style={{
                              width: 25, height: 25, borderRadius: '50%', flex: '0 0 25px',
                              background: idx === 0 ? 'var(--green-600)' : 'var(--ink-150)',
                              color: idx === 0 ? '#fff' : 'var(--ink-600)',
                              display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700,
                            }}>{initials(o.owner_name)}</span>
                            <span className="strong">{o.owner_name}</span>
                          </span>
                        </td>
                        <td><BuTag code={o.bu_code} /></td>
                        <td className="right num">{o.initiatives}</td>
                        <td className="right num">{cr(o.target_cr)}</td>
                        <td className="right num muted">{cr(o.plan_ptd_cr)}</td>
                        <td className="right num strong">{cr(o.booked_ptd_cr)}</td>
                        <td className="right">
                          <span className={`badge ${achievementTone(o.achievement.pct)}`}>{pct(o.achievement.pct, 0)}</span>
                        </td>
                        <td className="right num">{o.red > 0 ? <span className="delta down strong">{o.red}</span> : <span className="dim">--</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Department</th><th className="right">Initiatives</th><th className="right">Target</th>
                    <th className="right">Plan to date</th><th className="right">Booked</th>
                    <th className="right">Variance</th><th className="right">Achievement</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byDepartment.map((d) => (
                    <tr key={d.code}>
                      <td className="strong">{d.name}</td>
                      <td className="right num">{d.initiative_count}</td>
                      <td className="right num">{cr(d.target_cr)}</td>
                      <td className="right num muted">{cr(d.plan_ptd_cr)}</td>
                      <td className="right num strong">{cr(d.booked_ptd_cr)}</td>
                      <td className={`right num delta ${varianceTone(d.variance_ptd_cr)}`}>{crSigned(d.variance_ptd_cr)}</td>
                      <td className="right"><span className={`badge ${achievementTone(d.achievement_pct)}`}>{pct(d.achievement_pct, 0)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/* ====================================================================== *
 * Tasks
 * ====================================================================== */

export function Tasks() {
  const { bu, session } = useApp();
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', bu, status, mine, session.user.id],
    queryFn: () => api.get<{ rows: Task[]; counts: Record<string, number>; overdue: number }>(
      `/tasks${qs({ bu, status, assignee_id: mine ? session.user.id : undefined })}`,
    ),
    enabled: !!bu,
  });

  return (
    <>
      <PageHeader title="Tasks" subtitle={data ? `${data.rows.length} tasks · ${data.overdue} overdue` : 'Loading…'}>
      </PageHeader>

      <div className="content">
        <SyntheticBanner />

        <div className="filter-bar">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {TASK_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <label className="row gap-6 small" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            Assigned to me
          </label>
          <span className="grow" />
          {data && (
            <span className="row gap-8">
              {Object.entries(data.counts).map(([k, v]) => (
                <span className="badge" key={k}>{statusLabel(k)} {v}</span>
              ))}
            </span>
          )}
        </div>

        <Card bodyClass="tight">
          {isLoading || !data ? <div style={{ padding: 18 }}><Loading rows={8} /></div>
            : data.rows.length === 0 ? <Empty title="No tasks match" />
              : (
                <div className="table-wrap">
                  <table className="grid">
                    <thead>
                      <tr>
                        <th>Task</th><th>Initiative</th><th>Assignee</th><th>Status</th>
                        <th className="right">Progress</th><th>Planned end</th><th className="right">Est. saving</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((t) => (
                        <tr key={t.id}>
                          <td className="strong" style={{ maxWidth: 320 }}>{t.title}</td>
                          <td>
                            <Link to={`/initiatives/${t.initiative_id}`} className="small">{t.initiative_title}</Link>
                            <div className="tiny muted mono">{t.initiative_code}</div>
                          </td>
                          <td className="small nowrap">{t.assignee_name || <span className="dim">unassigned</span>}</td>
                          <td><StatusBadge status={t.status} /></td>
                          <td className="right"><ProgressBar value={t.progress_pct} /></td>
                          <td className={`small nowrap ${t.is_overdue ? 'delta down strong' : ''}`}>
                            {dateShort(t.planned_end)}{t.is_overdue && ' · overdue'}
                          </td>
                          <td className="right num">{cr(t.estimated_savings_cr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </Card>
      </div>
    </>
  );
}

/* ====================================================================== *
 * Notifications
 * ====================================================================== */

export function Notifications() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ rows: Notification[]; unread: number }>('/notifications'),
  });

  const markRead = useMutation({
    mutationFn: () => api.post('/notifications/read', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['session'] });
    },
  });

  const tone: Record<string, string> = {
    approval_pending: 'amber', actual_returned: 'red', actual_approved: 'green', submission_due: 'amber',
  };

  return (
    <>
      <PageHeader title="Notifications" subtitle={data ? `${data.unread} unread` : 'Loading…'}>
        {data && data.unread > 0 && (
          <button className="btn btn-outline btn-sm" onClick={() => markRead.mutate()}>
            <Icon name="check" /> Mark all read
          </button>
        )}
      </PageHeader>

      <div className="content content-narrow">
        <Card bodyClass="tight">
          {isLoading || !data ? <div style={{ padding: 18 }}><Loading rows={6} /></div>
            : data.rows.length === 0 ? <Empty title="Nothing to catch up on" icon="check" />
              : (
                <div>
                  {data.rows.map((n, idx) => (
                    <div
                      className="row gap-12"
                      key={n.id}
                      style={{
                        padding: '13px 16px',
                        borderBottom: idx < data.rows.length - 1 ? '1px solid var(--ink-150)' : 0,
                        background: n.is_read ? undefined : 'var(--blue-50)',
                        alignItems: 'flex-start',
                      }}
                    >
                      <span className={`dot ${tone[n.type] === 'red' ? 'red' : tone[n.type] === 'green' ? 'green' : tone[n.type] === 'amber' ? 'amber' : 'grey'}`}
                        style={{ marginTop: 5 }} />
                      <div className="grow">
                        <div className="row gap-8">
                          <span className="strong" style={{ fontSize: 13 }}>{n.title}</span>
                          <span className="tiny muted">{relTime(n.created_at)}</span>
                        </div>
                        <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--ink-600)', lineHeight: 1.55 }}>{n.body}</p>
                      </div>
                      {n.link && <Link className="btn btn-outline btn-xs" to={n.link}>Open</Link>}
                    </div>
                  ))}
                </div>
              )}
        </Card>
      </div>
    </>
  );
}

/* ====================================================================== *
 * Audit trail
 * ====================================================================== */

export function AuditTrail() {
  const { data, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.get<{ rows: any[] }>('/admin/audit?limit=300'),
  });

  return (
    <>
      <PageHeader title="Audit trail" subtitle="Every approval, edit and administrative change" />
      <div className="content">
        <Alert tone="neutral">
          Approvals are the entries that matter here: each records who approved which figure, for which month,
          and when. This is the trail that makes an approved saving defensible.
        </Alert>
        <Card bodyClass="tight">
          {isLoading || !data ? <div style={{ padding: 18 }}><Loading rows={9} /></div> : (
            <div className="table-wrap">
              <table className="grid compact">
                <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="small nowrap muted">{relTime(r.created_at)}</td>
                      <td className="small strong nowrap">{r.actor_name}</td>
                      <td><span className={`badge ${r.action.includes('approve') ? 'green' : r.action.includes('reject') ? 'red' : ''}`}>{r.action}</span></td>
                      <td className="tiny muted mono">{r.entity_type}#{r.entity_id}</td>
                      <td className="small">{r.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
