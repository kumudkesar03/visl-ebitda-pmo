import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp, useToast } from '../context/AppContext';
import { PageHeader, SyntheticBanner } from '../components/Shell';
import { Card, Kpi, Empty, Loading, BuTag, StatusBadge, Alert, ProgressBar } from '../components/Primitives';
import { Icon } from '../components/Icons';
import { cr, crSigned, pct, dateShort, varianceTone, achievementTone } from '../lib/format';
import { statusLabel } from '../lib/vocabulary';
import type { Task, Initiative } from '../types/api';

interface Submission {
  initiative_id: number;
  code: string;
  title: string;
  bu_code: string;
  period: string;
  label: string;
  plan_cr: number;
  actual_cr: number | null;
  status: string;
  rejection_note: string | null;
  health: string;
  achievement_pct: number | null;
}

interface MyWorkResponse {
  period: string;
  label: string;
  submissions: Submission[];
  outstanding: number;
  returned: number;
  tasks: Task[];
  overdueTasks: number;
  initiatives: Initiative[];
}

/**
 * MY WORK.
 *
 * An owner signing in on the fifth of the month has exactly one job: put this
 * month's figures in. Making them find their five rows inside a forty-eight row
 * portfolio table is how a PMO application ends up being ignored in favour of
 * the spreadsheet somebody emails round.
 *
 * So the month's submission is the entire top of this page, editable in place,
 * with the returned entries pulled to the front - those are the ones with a
 * deadline attached and somebody waiting.
 */
export function MyWork() {
  const { session } = useApp();
  const qc = useQueryClient();
  const { push } = useToast();
  const [values, setValues] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['mywork'],
    queryFn: () => api.get<MyWorkResponse>('/my-work'),
  });

  const submit = useMutation({
    mutationFn: ({ s, action }: { s: Submission; action: 'save' | 'submit' }) =>
      api.put(`/initiatives/${s.initiative_id}/actuals/${s.period}`, {
        actual_cr: values[s.initiative_id] === '' || values[s.initiative_id] === undefined
          ? s.actual_cr : Number(values[s.initiative_id]),
        remarks: notes[s.initiative_id] ?? null,
        action,
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['mywork'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      push(v.action === 'submit' ? 'Submitted for approval.' : 'Saved as draft.', 'success');
    },
    onError: (e: any) => push(e.message, 'error'),
  });

  if (isLoading || !data) {
    return (<><PageHeader title="My work" /><div className="content"><Card><Loading rows={6} /></Card></div></>);
  }

  const returned = data.submissions.filter((s) => s.status === 'rejected');
  const pending = data.submissions.filter((s) => s.status !== 'rejected');
  const committed = data.initiatives.reduce((a, i) => a + i.target_savings_cr, 0);
  const banked = data.initiatives.reduce((a, i) => a + i.booked_ptd_cr, 0);
  const planned = data.initiatives.reduce((a, i) => a + i.plan_ptd_cr, 0);

  return (
    <>
      <PageHeader
        title="My work"
        subtitle={`${session.user.name} · ${data.initiatives.length} initiatives · reporting month ${data.label}`}
      />

      <div className="content content-narrow">
        <SyntheticBanner />

        <div className="kpi-band" style={{ marginBottom: 14 }}>
          <Kpi label="Awaiting your submission" value={data.outstanding}
            accent={data.outstanding > 0 ? 'amber' : 'green'}
            sub={<span className="muted">for {data.label}</span>}
            basis={data.outstanding === 0 ? 'Everything submitted' : 'Savings do not count until submitted and approved'} />
          <Kpi label="Returned for revision" value={data.returned}
            accent={data.returned > 0 ? 'red' : 'navy'}
            sub={<span className="muted">need correcting</span>}
            basis="Not counted as banked while returned" />
          <Kpi label="Your committed target" value={cr(committed)} unit="Cr" accent="navy"
            sub={<span className="muted">across {data.initiatives.length} initiatives</span>}
            basis={session.settings.fy_label} />
          <Kpi label="Banked to date" value={cr(banked)} unit="Cr" accent="green"
            delta={{ value: banked - planned }} sub={<span className="muted">vs plan {cr(planned)}</span>}
            basis="Approved actuals only" />
          <Kpi label="Open tasks" value={data.tasks.length}
            accent={data.overdueTasks > 0 ? 'red' : 'blue'}
            sub={<span className="muted">{data.overdueTasks} overdue</span>}
            basis="Assigned to you" />
        </div>

        {returned.length > 0 && (
          <Alert tone="red">
            <b>{returned.length} submission(s) returned by the PMO office.</b> These do not count towards banked
            savings until they are corrected and approved.
          </Alert>
        )}

        <Card
          title={`${data.label} submission`}
          hint="Enter the month's actual against the plan, then submit for approval"
          bodyClass="tight"
          style={{ marginBottom: 14 }}
          footer="Submitting notifies the approving PMO office. You can resubmit while an entry is still awaiting approval."
        >
          {data.submissions.length === 0 ? (
            <Empty title="Nothing to submit">
              None of your initiatives carries a plan for {data.label}.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Initiative</th>
                    <th>Unit</th>
                    <th className="right">Plan</th>
                    <th className="right" style={{ width: 120 }}>Actual (Rs Cr)</th>
                    <th className="right">Variance</th>
                    <th style={{ minWidth: 200 }}>Remarks</th>
                    <th>Status</th>
                    <th style={{ width: 158 }} />
                  </tr>
                </thead>
                <tbody>
                  {[...returned, ...pending].map((s) => {
                    const current = values[s.initiative_id] ?? (s.actual_cr === null ? '' : String(s.actual_cr));
                    const variance = current === '' ? null : Number(current) - s.plan_cr;
                    const locked = s.status === 'approved';
                    return (
                      <tr key={s.initiative_id} className={s.status === 'rejected' ? undefined : undefined}>
                        <td style={{ maxWidth: 300 }}>
                          <Link to={`/initiatives/${s.initiative_id}`} className="strong">{s.title}</Link>
                          <div className="tiny muted mono">{s.code}</div>
                          {s.rejection_note && (
                            <div className="tiny delta down" style={{ marginTop: 3 }}>
                              <Icon name="alert" style={{ width: 11, height: 11 }} /> {s.rejection_note}
                            </div>
                          )}
                        </td>
                        <td><BuTag code={s.bu_code} /></td>
                        <td className="right num muted">{cr(s.plan_cr)}</td>
                        <td className="right">
                          {locked ? <span className="num strong">{cr(s.actual_cr)}</span> : (
                            <input
                              className="cell-input" type="number" step="0.0001" value={current}
                              placeholder="--"
                              onChange={(e) => setValues((v) => ({ ...v, [s.initiative_id]: e.target.value }))}
                            />
                          )}
                        </td>
                        <td className={`right num delta ${varianceTone(variance)}`}>
                          {variance === null ? <span className="dim">--</span> : crSigned(variance)}
                        </td>
                        <td>
                          {locked ? <span className="tiny muted">--</span> : (
                            <input className="input" style={{ fontSize: 12, padding: '4px 8px' }}
                              value={notes[s.initiative_id] ?? ''}
                              placeholder="Basis, one-offs, anything the approver needs"
                              onChange={(e) => setNotes((n) => ({ ...n, [s.initiative_id]: e.target.value }))} />
                          )}
                        </td>
                        <td><StatusBadge status={s.status} /></td>
                        <td style={{ textAlign: 'right' }}>
                          {locked ? <span className="tiny muted">Locked</span> : (
                            <span className="row gap-6" style={{ justifyContent: 'flex-end' }}>
                              <button className="btn btn-outline btn-xs" disabled={submit.isPending}
                                onClick={() => submit.mutate({ s, action: 'save' })}>Draft</button>
                              <button className="btn btn-primary btn-xs"
                                disabled={submit.isPending || current === ''}
                                onClick={() => submit.mutate({ s, action: 'submit' })}>
                                <Icon name="send" style={{ width: 12, height: 12 }} />
                                {s.status === 'submitted' ? 'Resubmit' : 'Submit'}
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="grid-cards cols-2">
          <Card title="My initiatives" hint="Everything you own" bodyClass="tight">
            {data.initiatives.length === 0 ? <Empty title="You own no initiatives" /> : (
              <div className="table-wrap">
                <table className="grid compact">
                  <thead><tr><th>Initiative</th><th className="right">Target</th><th className="right">Booked</th><th className="right">Achv</th></tr></thead>
                  <tbody>
                    {data.initiatives.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <Link to={`/initiatives/${i.id}`} className="strong">{i.title}</Link>
                          <div className="tiny muted">{statusLabel(i.status)} · due {dateShort(i.due_date)}</div>
                        </td>
                        <td className="right num">{cr(i.target_savings_cr)}</td>
                        <td className="right num strong">{cr(i.booked_ptd_cr)}</td>
                        <td className="right">
                          <span className={`badge ${achievementTone(i.achievement_ptd.pct)}`}>{pct(i.achievement_ptd.pct, 0)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="My open tasks" hint="Assigned to you across every initiative" bodyClass="tight">
            {data.tasks.length === 0 ? <Empty title="No open tasks" icon="check" /> : (
              <div className="table-wrap">
                <table className="grid compact">
                  <thead><tr><th>Task</th><th>Initiative</th><th className="right">Progress</th><th>Due</th></tr></thead>
                  <tbody>
                    {data.tasks.map((t) => (
                      <tr key={t.id}>
                        <td className="strong" style={{ maxWidth: 230 }}>{t.title}</td>
                        <td className="tiny muted mono">{t.initiative_code}</td>
                        <td className="right"><ProgressBar value={t.progress_pct} /></td>
                        <td className={`small nowrap ${t.is_overdue ? 'delta down strong' : ''}`}>{dateShort(t.planned_end)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
