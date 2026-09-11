import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../context/AppContext';
import { PageHeader, SyntheticBanner } from '../components/Shell';
import { Card, Kpi, RatioKpi, Loading, HealthDot, BuTag, StatusBadge, PriorityBadge, Empty, Alert, ProgressBar, SectionTitle } from '../components/Primitives';
import { MonthlyDelivery } from '../components/Charts';
import { Icon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { cr, crSigned, varianceTone, dateShort, dateTime, relTime, initials } from '../lib/format';
import { statusLabel, statusTone, STATUS_OPTIONS, TASK_STATUS_OPTIONS, PRIORITY_OPTIONS, PRIORITY_LABELS } from '../lib/vocabulary';
import type { InitiativeDetail as Detail, AbilityFlags, InitiativeMonth, Task, Milestone, Risk } from '../types/api';

type Tab = 'overview' | 'monthly' | 'tasks' | 'milestones' | 'risks' | 'discussion';

export function InitiativeDetailPage() {
  const { id } = useParams();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['initiative', id],
    queryFn: () => api.get<{ initiative: Detail; can: AbilityFlags }>(`/initiatives/${id}`),
    enabled: !!id,
  });

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="Initiative" />
        <div className="content"><Card><Loading rows={7} /></Card></div>
      </>
    );
  }

  const i = data.initiative;
  const abilities = data.can;

  return (
    <>
      <PageHeader
        title={i.title}
        subtitle={
          <span className="row gap-8 wrap">
            <span className="mono">{i.code}</span>
            <BuTag code={i.bu_code} />
            <span>{i.department_name}</span>
            <span className="dim">·</span>
            <span>{i.category_name}</span>
          </span>
        }
      >
        <Link className="btn btn-ghost btn-sm" to="/initiatives"><Icon name="chevronLeft" /> All initiatives</Link>
        {abilities.edit && (
          <button className="btn btn-outline btn-sm" onClick={() => setEditing(true)}><Icon name="edit" /> Edit</button>
        )}
      </PageHeader>

      <div className="content">
        <SyntheticBanner />

        {/* ------------------------------------------------------------- *
            Headline
         * ------------------------------------------------------------- */}
        <div className="kpi-band" style={{ marginBottom: 16 }}>
          <Kpi label="Full-year target" value={cr(i.target_savings_cr)} unit="Cr" accent="navy"
            sub={<span className="muted">plan totals {cr(i.plan_fy_cr)}</span>}
            basis={Math.abs(i.plan_fy_cr - i.target_savings_cr) > 0.005 ? 'Monthly plan does not foot to target' : 'Monthly plan foots to target'} />
          <Kpi label="Booked to date" value={cr(i.booked_ptd_cr)} unit="Cr" accent="green"
            delta={{ value: i.variance_ptd_cr }} sub={<span className="muted">vs plan {cr(i.plan_ptd_cr)}</span>}
            basis="Approved actuals only" />
          <RatioKpi label="Achievement" ratio={i.achievement_ptd} />
          <Kpi label="Progress" value={`${Math.round(i.progress_pct)}%`} accent="blue"
            sub={<span className="muted">{i.task_done} of {i.task_count} tasks done</span>}
            basis={i.task_overdue > 0 ? `${i.task_overdue} task(s) overdue` : 'No overdue tasks'} />
          <Kpi label="Status" value={<span style={{ fontSize: 18 }}>{statusLabel(i.status)}</span>}
            accent={i.health === 'red' ? 'red' : i.health === 'amber' ? 'amber' : 'green'}
            sub={<HealthDot health={i.health} />}
            basis={i.due_date ? `Due ${dateShort(i.due_date)}` : undefined} />
        </div>

        {/* The owner's self-assessed health versus the computed position.
            Divergence is information for the PMO, not an accusation. */}
        {i.health !== i.health_computed && (
          <Alert tone="amber">
            The owner has marked this initiative <b>{statusLabel(i.health)}</b>, while its delivery position and
            schedule compute to <b>{statusLabel(i.health_computed)}</b>. Worth confirming in the monthly review.
          </Alert>
        )}

        <div className="tabs">
          {([
            ['overview', 'Overview', undefined],
            ['monthly', 'Plan & actuals', i.months.filter((m) => m.actual_status === 'rejected').length || undefined],
            ['tasks', 'Tasks', i.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length],
            ['milestones', 'Milestones', i.milestones.filter((m) => m.status === 'open').length],
            ['risks', 'Risks', i.risks.filter((r) => r.status === 'open' || r.status === 'mitigating').length],
            ['discussion', 'Discussion', i.comments.length],
          ] as [Tab, string, number | undefined][]).map(([key, label, count]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              {label}{count ? <span className="count">{count}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'overview' && <Overview detail={i} />}
        {tab === 'monthly' && <MonthlyGrid detail={i} abilities={abilities} />}
        {tab === 'tasks' && <TasksTab detail={i} abilities={abilities} />}
        {tab === 'milestones' && <MilestonesTab detail={i} abilities={abilities} />}
        {tab === 'risks' && <RisksTab detail={i} abilities={abilities} />}
        {tab === 'discussion' && <Discussion detail={i} abilities={abilities} />}
      </div>

      {editing && <EditInitiative detail={i} onClose={() => setEditing(false)} />}
    </>
  );
}

/* ====================================================================== *
 * Overview
 * ====================================================================== */

function Overview({ detail }: { detail: Detail }) {
  return (
    <div className="grid-cards cols-2-1">
      <div className="stack gap-14">
        <Card title="Monthly delivery">
          <MonthlyDelivery series={detail.series} closedThrough={null} height={240} />
        </Card>

        <Card title="What this initiative does">
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink-700)', margin: 0 }}>
            {detail.description || <span className="dim">No description recorded.</span>}
          </p>
        </Card>
      </div>

      <Card title="Detail">
        <dl style={{ margin: 0 }}>
          {([
            ['Owner', detail.owner_name || '--'],
            ['Business unit', detail.bu_code],
            ['Department', detail.department_name || '--'],
            ['EBITDA lever', detail.category_name || '--'],
            ['Priority', <PriorityBadge priority={detail.priority} key="p" />],
            ['Status', <StatusBadge status={detail.status} key="s" />],
            ['Health', <HealthDot health={detail.health} key="h" />],
            ['Start', dateShort(detail.start_date)],
            ['Due', dateShort(detail.due_date)],
            ['Open risks', detail.open_risks || '--'],
            ['Tasks', `${detail.task_done} of ${detail.task_count} complete`],
          ] as [string, any][]).map(([k, v]) => (
            <div className="row gap-12" key={k} style={{ padding: '7px 0', borderBottom: '1px solid var(--ink-150)' }}>
              <dt className="small muted" style={{ width: 118, flex: '0 0 118px' }}>{k}</dt>
              <dd style={{ margin: 0, fontSize: 12.5, fontWeight: 560 }}>{v}</dd>
            </div>
          ))}
        </dl>
        <div style={{ marginTop: 14 }}>
          <ProgressBar value={detail.progress_pct} />
        </div>
      </Card>
    </div>
  );
}

/* ====================================================================== *
 * The monthly grid - where the actual work happens
 * ====================================================================== */

/**
 * Plan and actuals, editable in place.
 *
 * text.txt 13.3 records the gap this closes: monthly actuals could already be
 * entered in the application, but the plan itself only ever arrived by CSV
 * seeding. Both are editable here, with the rules that make the numbers
 * trustworthy enforced at the point of entry rather than discovered later:
 *
 *   - An APPROVED month is locked. Its plan and its actual are a signed
 *     number that leadership has already been shown. Reopening is a PMO
 *     action with an audit entry, not an edit.
 *   - The plan must foot to the full-year target. The running total sits at
 *     the bottom of the column and turns amber the moment it does not.
 *   - Submitting is a distinct act from saving. A draft is the owner's
 *     working figure; a submission enters someone else's queue and sends mail.
 */
function MonthlyGrid({ detail, abilities }: { detail: Detail; abilities: AbilityFlags }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [plan, setPlan] = useState<Record<string, string>>({});
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  useEffect(() => {
    setPlan(Object.fromEntries(detail.months.map((m) => [m.period, String(m.plan_cr ?? '')])));
    setActuals(Object.fromEntries(detail.months.map((m) => [m.period, m.actual_cr === null ? '' : String(m.actual_cr)])));
    setRemarks(Object.fromEntries(detail.months.map((m) => [m.period, m.remarks ?? ''])));
  }, [detail.id, detail.months]);

  const planTotal = useMemo(
    () => Object.values(plan).reduce((a, v) => a + (Number(v) || 0), 0),
    [plan],
  );
  const planDrift = planTotal - detail.target_savings_cr;
  const planDirty = detail.months.some((m) => Number(plan[m.period] || 0) !== m.plan_cr);

  const savePlan = useMutation({
    mutationFn: (allowMismatch: boolean) => api.put(`/initiatives/${detail.id}/plan`, {
      entries: detail.months.map((m) => ({ period: m.period, plan_cr: Number(plan[m.period]) || 0 })),
      allow_mismatch: allowMismatch,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['initiative', String(detail.id)] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      push('Monthly plan saved.', 'success');
    },
    onError: (e: any) => push(e.message, 'error'),
  });

  const saveActual = useMutation({
    mutationFn: ({ period, action }: { period: string; action: 'save' | 'submit' }) =>
      api.put(`/initiatives/${detail.id}/actuals/${period}`, {
        actual_cr: actuals[period] === '' ? null : Number(actuals[period]),
        remarks: remarks[period] || null,
        action,
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['initiative', String(detail.id)] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['mywork'] });
      push(vars.action === 'submit' ? 'Submitted for approval. The approver has been notified.' : 'Saved as draft.', 'success');
    },
    onError: (e: any) => push(e.message, 'error'),
  });

  const returned = detail.months.filter((m) => m.actual_status === 'rejected');

  return (
    <div className="stack gap-14">
      {returned.length > 0 && (
        <Alert tone="red">
          <b>{returned.length} month(s) returned for revision.</b>{' '}
          {returned.map((m) => m.label).join(', ')} — {returned[0].rejection_note}
        </Alert>
      )}

      <Card
        title="Monthly plan and actuals"
        hint="Approved months are locked. Booked savings count approved actuals only."
        bodyClass="tight"
        actions={
          abilities.editPlan && (
            <div className="row gap-8">
              {planDirty && (
                <span className={`small ${Math.abs(planDrift) > 0.005 ? 'delta down' : 'muted'}`}>
                  Plan {cr(planTotal)} of {cr(detail.target_savings_cr)} Cr
                  {Math.abs(planDrift) > 0.005 && ` · ${crSigned(planDrift)}`}
                </span>
              )}
              <button
                className="btn btn-primary btn-sm"
                disabled={!planDirty || savePlan.isPending}
                onClick={() => savePlan.mutate(false)}
              >
                <Icon name="save" /> Save plan
              </button>
            </div>
          )
        }
      >
        <div className="table-wrap">
          <table className="month-grid">
            <thead>
              <tr>
                <th>Month</th>
                <th>Plan (Cr)</th>
                <th>Actual (Cr)</th>
                <th className="right">Variance</th>
                <th style={{ textAlign: 'left' }}>Status</th>
                <th style={{ textAlign: 'left', minWidth: 220 }}>Remarks</th>
                <th style={{ textAlign: 'right', minWidth: 168 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {detail.months.map((m) => (
                <MonthRow
                  key={m.period}
                  month={m}
                  abilities={abilities}
                  planValue={plan[m.period] ?? ''}
                  actualValue={actuals[m.period] ?? ''}
                  remarkValue={remarks[m.period] ?? ''}
                  onPlan={(v) => setPlan((p) => ({ ...p, [m.period]: v }))}
                  onActual={(v) => setActuals((a) => ({ ...a, [m.period]: v }))}
                  onRemark={(v) => setRemarks((r) => ({ ...r, [m.period]: v }))}
                  onSave={(action) => saveActual.mutate({ period: m.period, action })}
                  busy={saveActual.isPending}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="total-row">
                <td style={{ background: 'var(--navy-900)', color: '#fff' }}>Full year</td>
                <td>{cr(planTotal)}</td>
                <td>{cr(detail.months.reduce((a, m) => a + (m.actual_status === 'approved' ? (m.actual_cr || 0) : 0), 0))}</td>
                <td colSpan={4} style={{ textAlign: 'left', fontWeight: 500, fontSize: 11.5 }}>
                  Target {cr(detail.target_savings_cr)} Cr
                  {Math.abs(planDrift) > 0.005 && ` · plan is ${crSigned(planDrift)} against target`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {Math.abs(planDrift) > 0.005 && abilities.editPlan && (
        <Alert tone="amber">
          The monthly plan totals <b>{cr(planTotal)} Cr</b> against a full-year target of{' '}
          <b>{cr(detail.target_savings_cr)} Cr</b>. Adjust the months so they foot, change the target,
          or{' '}
          <button className="btn btn-ghost btn-xs" onClick={() => savePlan.mutate(true)}>
            record the gap deliberately
          </button>
          . A plan that does not foot will show as a gap on the executive board.
        </Alert>
      )}
    </div>
  );
}

function MonthRow({ month, abilities, planValue, actualValue, remarkValue, onPlan, onActual, onRemark, onSave, busy }: {
  month: InitiativeMonth;
  abilities: AbilityFlags;
  planValue: string; actualValue: string; remarkValue: string;
  onPlan: (v: string) => void; onActual: (v: string) => void; onRemark: (v: string) => void;
  onSave: (action: 'save' | 'submit') => void;
  busy: boolean;
}) {
  const locked = month.actual_status === 'approved';
  const planDirty = Number(planValue || 0) !== month.plan_cr;
  const actualDirty = (actualValue === '' ? null : Number(actualValue)) !== month.actual_cr;
  const variance = (month.actual_cr ?? 0) - month.plan_cr;
  const canEditActual = abilities.bookActual && !locked;

  return (
    <tr className={locked ? 'closed' : undefined}>
      <td className="strong">{month.label}</td>
      <td>
        {abilities.editPlan && !locked ? (
          <input
            className={`cell-input ${planDirty ? 'dirty' : ''}`}
            type="number" step="0.0001" value={planValue}
            onChange={(e) => onPlan(e.target.value)}
          />
        ) : <span className="num">{cr(month.plan_cr)}</span>}
      </td>
      <td>
        {canEditActual ? (
          <input
            className={`cell-input ${actualDirty ? 'dirty' : ''}`}
            type="number" step="0.0001" value={actualValue}
            placeholder="--"
            onChange={(e) => onActual(e.target.value)}
          />
        ) : <span className="num">{month.actual_cr === null ? <span className="dim">--</span> : cr(month.actual_cr)}</span>}
      </td>
      <td className={`right num delta ${varianceTone(variance)}`}>
        {month.actual_cr === null ? <span className="dim">--</span> : crSigned(variance)}
      </td>
      <td style={{ textAlign: 'left' }}>
        <span className={`badge ${statusTone(month.actual_status)}`}>{statusLabel(month.actual_status)}</span>
        {month.approved_at && <div className="tiny muted" style={{ marginTop: 2 }}>{relTime(month.approved_at)}</div>}
      </td>
      <td style={{ textAlign: 'left' }}>
        {canEditActual ? (
          <input className="input" style={{ fontSize: 12, padding: '4px 8px' }}
            value={remarkValue} placeholder="Basis, one-offs, anything the approver needs"
            onChange={(e) => onRemark(e.target.value)} />
        ) : (
          <span className="tiny muted">
            {month.rejection_note
              ? <span className="delta down">{month.rejection_note}</span>
              : month.remarks || <span className="dim">--</span>}
          </span>
        )}
      </td>
      <td style={{ textAlign: 'right' }}>
        {locked ? (
          <span className="tiny muted nowrap"><Icon name="check" style={{ width: 12, height: 12 }} /> Locked</span>
        ) : canEditActual ? (
          <span className="row gap-6" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-xs" disabled={busy || !actualDirty} onClick={() => onSave('save')}>
              Save draft
            </button>
            <button
              className="btn btn-primary btn-xs"
              disabled={busy || actualValue === ''}
              onClick={() => onSave('submit')}
              title={month.actual_status === 'submitted' ? 'Resubmit, replacing the entry in the approval queue' : 'Send for approval'}
            >
              <Icon name="send" style={{ width: 12, height: 12 }} />
              {month.actual_status === 'submitted' ? 'Resubmit' : 'Submit'}
            </button>
          </span>
        ) : <span className="tiny dim">read only</span>}
      </td>
    </tr>
  );
}

/* ====================================================================== *
 * Tasks
 * ====================================================================== */

function TasksTab({ detail, abilities }: { detail: Detail; abilities: AbilityFlags }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [adding, setAdding] = useState(false);

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Task> }) =>
      api.patch(`/initiatives/${detail.id}/tasks/${id}`, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['initiative', String(detail.id)] }); },
    onError: (e: any) => push(e.message, 'error'),
  });

  return (
    <>
      <Card
        title="Tasks" hint="What has to happen for the saving to be delivered" bodyClass="tight"
        actions={abilities.manageTasks && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Icon name="plus" /> Add task</button>}
      >
        {detail.tasks.length === 0 ? <Empty title="No tasks yet">Break the initiative into the steps that actually deliver it.</Empty> : (
          <div className="table-wrap">
            <table className="grid compact">
              <thead>
                <tr>
                  <th>Task</th><th>Assignee</th><th>Status</th><th className="right">Progress</th>
                  <th>Planned end</th><th className="right">Est. saving</th>
                </tr>
              </thead>
              <tbody>
                {detail.tasks.map((t) => {
                  const overdue = t.planned_end && new Date(t.planned_end) < new Date() && !['done', 'cancelled'].includes(t.status);
                  return (
                    <tr key={t.id}>
                      <td>
                        <div className="strong">{t.title}</div>
                        <div className="tiny muted mono">{t.code}</div>
                      </td>
                      <td className="small nowrap">{t.assignee_name || <span className="dim">unassigned</span>}</td>
                      <td>
                        {abilities.manageTasks ? (
                          <select
                            className="select" style={{ padding: '3px 7px', fontSize: 11.5, width: 'auto' }}
                            value={t.status}
                            onChange={(e) => update.mutate({ id: t.id, patch: { status: e.target.value as any } })}
                          >
                            {TASK_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                          </select>
                        ) : <StatusBadge status={t.status} />}
                      </td>
                      <td className="right"><ProgressBar value={t.progress_pct} /></td>
                      <td className={`small nowrap ${overdue ? 'delta down strong' : ''}`}>
                        {dateShort(t.planned_end)}{overdue && ' · overdue'}
                      </td>
                      <td className="right num">{cr(t.estimated_savings_cr)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {adding && <ChildForm
        title="Add a task"
        fields={[
          { key: 'title', label: 'Task', type: 'text', required: true },
          { key: 'planned_start', label: 'Planned start', type: 'date' },
          { key: 'planned_end', label: 'Planned end', type: 'date' },
          { key: 'estimated_savings_cr', label: 'Estimated saving (Rs Cr)', type: 'number' },
          { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY_OPTIONS.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })) },
        ]}
        initial={{ status: 'todo', priority: 'medium', progress_pct: 0 }}
        endpoint={`/initiatives/${detail.id}/tasks`}
        invalidate={['initiative', String(detail.id)]}
        onClose={() => setAdding(false)}
      />}
    </>
  );
}

/* ====================================================================== *
 * Milestones
 * ====================================================================== */

function MilestonesTab({ detail, abilities }: { detail: Detail; abilities: AbilityFlags }) {
  const [adding, setAdding] = useState(false);
  const sorted = [...detail.milestones].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));

  return (
    <>
      <Card
        title="Milestones" hint="The checkpoints the PMO office tracks" bodyClass="tight"
        actions={abilities.manageTasks && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Icon name="plus" /> Add milestone</button>}
      >
        {sorted.length === 0 ? <Empty title="No milestones" /> : (
          <div style={{ padding: '6px 16px 14px' }}>
            {sorted.map((m: Milestone, idx) => (
              <div className="row gap-12" key={m.id} style={{ padding: '11px 0', borderBottom: idx < sorted.length - 1 ? '1px solid var(--ink-150)' : 0 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', flex: '0 0 22px',
                  display: 'grid', placeItems: 'center', color: '#fff', fontSize: 11,
                  background: m.status === 'achieved' ? 'var(--green-600)' : m.status === 'missed' ? 'var(--red-600)' : 'var(--ink-300)',
                }}>
                  {m.status === 'achieved' ? <Icon name="check" style={{ width: 12, height: 12 }} /> : idx + 1}
                </span>
                <div className="grow">
                  <div className="strong" style={{ fontSize: 13 }}>{m.title}</div>
                  <div className="tiny muted">
                    Due {dateShort(m.due_date)}
                    {m.completed_at && ` · completed ${dateShort(m.completed_at)}`}
                  </div>
                </div>
                <StatusBadge status={m.status} />
              </div>
            ))}
          </div>
        )}
      </Card>
      {adding && <ChildForm
        title="Add a milestone"
        fields={[
          { key: 'title', label: 'Milestone', type: 'text', required: true },
          { key: 'due_date', label: 'Due', type: 'date' },
        ]}
        initial={{ status: 'open', sort_order: 100 }}
        endpoint={`/initiatives/${detail.id}/milestones`}
        invalidate={['initiative', String(detail.id)]}
        onClose={() => setAdding(false)}
      />}
    </>
  );
}

/* ====================================================================== *
 * Risks
 * ====================================================================== */

function RisksTab({ detail, abilities }: { detail: Detail; abilities: AbilityFlags }) {
  const [adding, setAdding] = useState(false);
  const tone = (r: Risk) => (r.impact === 'high' && r.likelihood === 'high' ? 'red' : r.impact === 'high' || r.likelihood === 'high' ? 'amber' : '');

  return (
    <>
      <Card
        title="Risks" hint="What could stop the saving being delivered, and what is being done about it" bodyClass="tight"
        actions={abilities.manageTasks && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Icon name="plus" /> Raise risk</button>}
      >
        {detail.risks.length === 0 ? <Empty title="No risks recorded" icon="check">Nothing has been flagged against this initiative.</Empty> : (
          <div className="table-wrap">
            <table className="grid compact">
              <thead>
                <tr><th>Risk</th><th>Impact</th><th>Likelihood</th><th>Mitigation</th><th>Status</th><th>Due</th></tr>
              </thead>
              <tbody>
                {detail.risks.map((r) => (
                  <tr key={r.id}>
                    <td className="strong" style={{ maxWidth: 260 }}>{r.title}</td>
                    <td><span className={`badge ${tone(r)}`}>{r.impact}</span></td>
                    <td><span className="badge">{r.likelihood}</span></td>
                    <td className="small muted" style={{ maxWidth: 340 }}>{r.mitigation || '--'}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="small nowrap">{dateShort(r.due_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {adding && <ChildForm
        title="Raise a risk"
        fields={[
          { key: 'title', label: 'Risk', type: 'text', required: true },
          { key: 'impact', label: 'Impact', type: 'select', options: ['low', 'medium', 'high'].map((v) => ({ value: v, label: v })) },
          { key: 'likelihood', label: 'Likelihood', type: 'select', options: ['low', 'medium', 'high'].map((v) => ({ value: v, label: v })) },
          { key: 'mitigation', label: 'Mitigation', type: 'textarea' },
          { key: 'due_date', label: 'Review by', type: 'date' },
        ]}
        initial={{ status: 'open', impact: 'medium', likelihood: 'medium' }}
        endpoint={`/initiatives/${detail.id}/risks`}
        invalidate={['initiative', String(detail.id)]}
        onClose={() => setAdding(false)}
      />}
    </>
  );
}

/* ====================================================================== *
 * Discussion
 * ====================================================================== */

function Discussion({ detail, abilities }: { detail: Detail; abilities: AbilityFlags }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [body, setBody] = useState('');

  const add = useMutation({
    mutationFn: () => api.post(`/initiatives/${detail.id}/comments`, { body }),
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey: ['initiative', String(detail.id)] });
      push('Comment added.', 'success');
    },
    onError: (e: any) => push(e.message, 'error'),
  });

  return (
    <Card title="Discussion" hint="Kept with the initiative, so context survives a handover">
      {abilities.comment && (
        <div style={{ marginBottom: 18 }}>
          <textarea className="input" value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Add a note for the owner and the PMO office…" />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={!body.trim() || add.isPending} onClick={() => add.mutate()}>
              <Icon name="send" /> Post
            </button>
          </div>
        </div>
      )}

      {detail.comments.length === 0 ? <Empty title="No comments yet" /> : (
        <div className="stack gap-14">
          {detail.comments.map((c) => (
            <div className="row gap-10" key={c.id} style={{ alignItems: 'flex-start' }}>
              <span style={{
                width: 28, height: 28, borderRadius: '50%', flex: '0 0 28px',
                background: 'var(--ink-150)', color: 'var(--ink-600)',
                display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 700,
              }}>{initials(c.user_name)}</span>
              <div className="grow">
                <div className="row gap-8">
                  <span className="strong small">{c.user_name}</span>
                  <span className="tiny muted">{dateTime(c.created_at)}</span>
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 13, lineHeight: 1.6, color: 'var(--ink-700)' }}>{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ====================================================================== *
 * Generic child form
 * ====================================================================== */

interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'date' | 'number' | 'select' | 'textarea';
  required?: boolean;
  options?: { value: string; label: string }[];
}

/**
 * One form component for tasks, milestones and risks.
 *
 * Three near-identical dialogs is three places for a validation rule to drift.
 * The shape is declared per use, the behaviour is written once.
 */
function ChildForm({ title, fields, initial, endpoint, invalidate, onClose }: {
  title: string;
  fields: FieldSpec[];
  initial: Record<string, unknown>;
  endpoint: string;
  invalidate: string[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [form, setForm] = useState<Record<string, any>>({
    ...initial,
    ...Object.fromEntries(fields.map((f) => [f.key, f.type === 'select' ? (f.options?.[0]?.value ?? '') : ''])),
  });

  const save = useMutation({
    mutationFn: () => api.post(endpoint, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invalidate });
      push('Saved.', 'success');
      onClose();
    },
    onError: (e: any) => push(e.message, 'error'),
  });

  const missing = fields.some((f) => f.required && !String(form[f.key] ?? '').trim());

  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={missing || save.isPending} onClick={() => save.mutate()}>
          <Icon name="save" /> {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </>
    }>
      {fields.map((f) => (
        <div className="field" key={f.key}>
          <label>{f.label}{f.required && <span className="delta down"> *</span>}</label>
          {f.type === 'select' ? (
            <select className="select" value={form[f.key] ?? ''} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}>
              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : f.type === 'textarea' ? (
            <textarea className="input" value={form[f.key] ?? ''} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
          ) : (
            <input
              className={`input ${f.type === 'number' ? 'num-input' : ''}`}
              type={f.type} step={f.type === 'number' ? '0.01' : undefined}
              value={form[f.key] ?? ''}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value }))}
            />
          )}
        </div>
      ))}
    </Modal>
  );
}

/* ====================================================================== *
 * Edit initiative
 * ====================================================================== */

function EditInitiative({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data: ref } = useQuery({
    queryKey: ['reference'],
    queryFn: () => api.get<{ departments: any[]; categories: any[]; users: any[] }>('/admin/reference'),
  });

  const [form, setForm] = useState({
    title: detail.title,
    description: detail.description || '',
    status: detail.status,
    priority: detail.priority,
    health: detail.health,
    progress_pct: detail.progress_pct,
    target_savings_cr: detail.target_savings_cr,
    owner_id: detail.owner_id ?? '',
    department_id: detail.department_id ?? '',
    category: detail.category,
    start_date: detail.start_date ?? '',
    due_date: detail.due_date ?? '',
  });

  const save = useMutation({
    mutationFn: () => api.patch(`/initiatives/${detail.id}`, {
      ...form,
      owner_id: form.owner_id === '' ? null : Number(form.owner_id),
      department_id: form.department_id === '' ? null : Number(form.department_id),
      target_savings_cr: Number(form.target_savings_cr),
      progress_pct: Number(form.progress_pct),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['initiative', String(detail.id)] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['initiatives'] });
      push('Initiative updated.', 'success');
      onClose();
    },
    onError: (e: any) => push(e.message, 'error'),
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const departments = (ref?.departments ?? []).filter((d: any) => d.bu_code === detail.bu_code);
  const owners = (ref?.users ?? []).filter((u: any) => u.home_bu === detail.bu_code);

  return (
    <Modal title="Edit initiative" subtitle={`${detail.code} · ${detail.bu_code}`} onClose={onClose} wide footer={
      <>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          <Icon name="save" /> {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </>
    }>
      <div className="field">
        <label>Title</label>
        <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} />
      </div>
      <div className="field">
        <label>Description and measurement basis</label>
        <textarea className="input" value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>

      <div className="field-row three">
        <div className="field">
          <label>Status</label>
          <select className="select" value={form.status} onChange={(e) => set('status', e.target.value)}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Priority</label>
          <select className="select" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
            {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Health (owner assessment)</label>
          <select className="select" value={form.health} onChange={(e) => set('health', e.target.value)}>
            <option value="green">On track</option>
            <option value="amber">Watch</option>
            <option value="red">Off track</option>
          </select>
          <span className="help">Computed position: {statusLabel(detail.health_computed)}</span>
        </div>
      </div>

      <div className="field-row three">
        <div className="field">
          <label>Owner</label>
          <select className="select" value={form.owner_id} onChange={(e) => set('owner_id', e.target.value)}>
            <option value="">Not set</option>
            {owners.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Department</label>
          <select className="select" value={form.department_id} onChange={(e) => set('department_id', e.target.value)}>
            <option value="">Not set</option>
            {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>EBITDA lever</label>
          <select className="select" value={form.category} onChange={(e) => set('category', e.target.value)}>
            {(ref?.categories ?? []).map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className="field-row three">
        <div className="field">
          <label>Full-year target (Rs Cr)</label>
          <input className="input num-input" type="number" step="0.01" value={form.target_savings_cr}
            onChange={(e) => set('target_savings_cr', e.target.value)} />
          <span className="help">Changing this will put the monthly plan out of balance until it is re-spread.</span>
        </div>
        <div className="field">
          <label>Start</label>
          <input className="input" type="date" value={String(form.start_date).slice(0, 10)} onChange={(e) => set('start_date', e.target.value)} />
        </div>
        <div className="field">
          <label>Due</label>
          <input className="input" type="date" value={String(form.due_date).slice(0, 10)} onChange={(e) => set('due_date', e.target.value)} />
        </div>
      </div>

      <SectionTitle hint="Reported progress is separate from money delivered — a task-complete initiative can still be behind on savings.">
        Progress
      </SectionTitle>
      <input type="range" min={0} max={100} value={form.progress_pct} style={{ width: '100%' }}
        onChange={(e) => set('progress_pct', Number(e.target.value))} />
      <div className="row"><span className="grow small muted">0%</span><span className="strong num">{form.progress_pct}%</span><span className="grow small muted right">100%</span></div>
    </Modal>
  );
}
