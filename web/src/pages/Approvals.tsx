import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp, useToast } from '../context/AppContext';
import { PageHeader, SyntheticBanner } from '../components/Shell';
import { Card, Kpi, Empty, Loading, BuTag, Alert } from '../components/Primitives';
import { Icon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { cr, crSigned, pct, varianceTone, relTime } from '../lib/format';
import { APPROVAL_MODE_LABELS } from '../lib/vocabulary';
import type { ApprovalRow, ApprovalMode } from '../types/api';

interface QueueResponse {
  rows: ApprovalRow[];
  mine: number;
  policy: { mode: ApprovalMode; self_approval_allowed: boolean };
  totals: { count: number; value_cr: number; approvable_cr: number };
}

/**
 * THE APPROVALS QUEUE.
 *
 * text.txt 13.1 names this screen as the most serious defect in the system
 * this replaces: an ESL PMO user could approve IOB monthly actuals, and the
 * approval went into the audit trail under their name. That is a governance
 * failure with a paper trail attached.
 *
 * The rules are now visible on the screen rather than only enforced behind it:
 *
 *  - Rows the signed-in user may NOT approve are still listed, greyed, with
 *    the reason stated. Hiding them would leave a PMO lead wondering why their
 *    queue count disagrees with the dashboard; showing them with the reason
 *    teaches the policy.
 *  - The active approval policy is printed in the header. Whether IOK approves
 *    its own months or IOB approves centrally is a leadership decision
 *    (text.txt 13.6b), and the screen says which answer is in force.
 *  - A user can never approve their own submission, whatever their role.
 *  - Returning an entry requires a reason, because the owner has to act on it.
 */
export function Approvals() {
  const { session } = useApp();
  const qc = useQueryClient();
  const { push } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [returning, setReturning] = useState<ApprovalRow[] | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api.get<QueueResponse>('/approvals'),
  });

  const rows = data?.rows ?? [];
  const approvable = useMemo(() => rows.filter((r) => r.can_approve), [rows]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['approvals'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['exec'] });
    setSelected(new Set());
  };

  const decideOne = useMutation({
    mutationFn: ({ id, decision, note }: { id: number; decision: string; note?: string }) =>
      api.post(`/approvals/${id}/${decision}`, { note }),
    onSuccess: (_d, v) => { refresh(); push(v.decision === 'approve' ? 'Approved. The owner has been notified.' : 'Returned to the owner.', 'success'); },
    onError: (e: any) => push(e.message, 'error'),
  });

  const decideBulk = useMutation({
    mutationFn: ({ ids, decision, note }: { ids: number[]; decision: string; note?: string }) =>
      api.post<{ succeeded: number; failed: number; results: { id: number; error: string | null }[] }>(`/approvals/bulk/${decision}`, { ids, note }),
    onSuccess: (res, v) => {
      refresh();
      if (res.failed > 0) {
        const first = res.results.find((r) => r.error);
        push(`${res.succeeded} ${v.decision}d, ${res.failed} refused — ${first?.error ?? ''}`, 'error');
      } else {
        push(`${res.succeeded} entries ${v.decision}d. Owners have been notified.`, 'success');
      }
    },
    onError: (e: any) => push(e.message, 'error'),
  });

  const toggle = (id: number) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const busy = decideOne.isPending || decideBulk.isPending;
  const selectedRows = rows.filter((r) => selected.has(r.id));

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle={data ? `${data.mine} awaiting your decision · policy: ${APPROVAL_MODE_LABELS[data.policy.mode]}` : 'Loading…'}
      >
        {selected.size > 0 && (
          <div className="row gap-8">
            <span className="small muted">{selected.size} selected</span>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setReturning(selectedRows)}>
              <Icon name="x" /> Return
            </button>
            <button
              className="btn btn-success btn-sm" disabled={busy}
              onClick={() => decideBulk.mutate({ ids: [...selected], decision: 'approve' })}
            >
              <Icon name="check" /> Approve {selected.size}
            </button>
          </div>
        )}
      </PageHeader>

      <div className="content">
        <SyntheticBanner />

        {isLoading || !data ? <Card><Loading rows={6} /></Card> : (
          <>
            <div className="kpi-band" style={{ marginBottom: 14 }}>
              <Kpi label="Entries submitted" value={data.totals.count} accent="navy"
                sub={<span className="muted">across your scope</span>}
                basis={`Reporting month ${session.settings.submission_period ? new Date(session.settings.submission_period).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : '--'}`} />
              <Kpi label="Value awaiting approval" value={cr(data.totals.value_cr)} unit="Cr" accent="amber"
                sub={<span className="muted">not yet counted as banked</span>}
                basis="Becomes booked savings once approved" />
              <Kpi label="Yours to decide" value={data.mine} accent={data.mine > 0 ? 'blue' : 'navy'}
                sub={<span className="muted">{cr(data.totals.approvable_cr)} Cr</span>}
                basis={`Under the ${data.policy.mode} approval policy`} />
              <Kpi label="Outside your authority" value={data.totals.count - data.mine} accent="navy"
                sub={<span className="muted">shown greyed with the reason</span>}
                basis="Another unit's PMO holds the decision" />
            </div>

            {data.totals.count > data.mine && (
              <Alert tone="info">
                Some entries below sit outside your approval authority and are shown greyed.
                Under the <b>{data.policy.mode}</b> policy, approval for a unit rests with the authority named on
                each row. An administrator can change the policy under System.
              </Alert>
            )}

            <Card bodyClass="tight">
              {rows.length === 0 ? (
                <Empty title="Nothing awaiting approval" icon="check">
                  Every submitted month in your scope has been decided. Owners will appear here as they submit.
                </Empty>
              ) : (
                <div className="table-wrap">
                  <table className="grid">
                    <thead>
                      <tr>
                        <th style={{ width: 34 }}>
                          <input
                            type="checkbox"
                            checked={approvable.length > 0 && selected.size === approvable.length}
                            onChange={(e) => setSelected(e.target.checked ? new Set(approvable.map((r) => r.id)) : new Set())}
                            title="Select everything you can approve"
                          />
                        </th>
                        <th>Initiative</th>
                        <th>Unit</th>
                        <th>Month</th>
                        <th className="right">Plan</th>
                        <th className="right">Submitted</th>
                        <th className="right">Variance</th>
                        <th>Remarks</th>
                        <th>Submitted by</th>
                        <th style={{ width: 170 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} style={r.can_approve ? undefined : { opacity: 0.55 }}>
                          <td>
                            <input
                              type="checkbox" disabled={!r.can_approve}
                              checked={selected.has(r.id)} onChange={() => toggle(r.id)}
                            />
                          </td>
                          <td style={{ maxWidth: 260 }}>
                            <Link to={`/initiatives/${r.initiative_id}`} className="strong">{r.initiative_title}</Link>
                            <div className="tiny muted mono">{r.initiative_code}</div>
                          </td>
                          <td><BuTag code={r.bu_code} /></td>
                          <td className="small nowrap strong">{r.label}</td>
                          <td className="right num muted">{cr(r.plan_cr)}</td>
                          <td className="right num strong">{cr(r.actual_cr)}</td>
                          <td className={`right num delta ${varianceTone(r.variance_cr)}`}>
                            {crSigned(r.variance_cr)}
                            {r.variance_pct !== null && <div className="tiny">{pct(r.variance_pct, 0)}</div>}
                          </td>
                          <td className="small muted" style={{ maxWidth: 240 }}>{r.remarks || '--'}</td>
                          <td className="small nowrap">
                            {r.submitted_by_name}
                            <div className="tiny muted">{relTime(r.submitted_at)}</div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {r.can_approve ? (
                              <span className="row gap-6" style={{ justifyContent: 'flex-end' }}>
                                <button className="btn btn-outline btn-xs" disabled={busy} onClick={() => setReturning([r])}>
                                  Return
                                </button>
                                <button className="btn btn-success btn-xs" disabled={busy}
                                  onClick={() => decideOne.mutate({ id: r.id, decision: 'approve' })}>
                                  <Icon name="check" style={{ width: 12, height: 12 }} /> Approve
                                </button>
                              </span>
                            ) : (
                              <span className="tiny muted" title={r.blocked_reason || ''}>
                                <Icon name="shield" style={{ width: 12, height: 12 }} /> {r.blocked_reason}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <p className="tiny muted" style={{ marginTop: 12 }}>
              A saving counts towards the drive only once the month is approved. Approving records your name,
              the time and the figure in the audit trail.
              {!data.policy.self_approval_allowed && ' You cannot approve an entry you submitted yourself.'}
            </p>
          </>
        )}
      </div>

      {returning && (
        <ReturnDialog
          rows={returning}
          busy={busy}
          onClose={() => setReturning(null)}
          onConfirm={(note) => {
            if (returning.length === 1) decideOne.mutate({ id: returning[0].id, decision: 'reject', note });
            else decideBulk.mutate({ ids: returning.map((r) => r.id), decision: 'reject', note });
            setReturning(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Returning an entry always requires a reason.
 *
 * The owner has to do something with it, and "rejected" with no explanation
 * produces a phone call rather than a corrected figure. The note goes into the
 * mail, the in-app notification and the audit entry.
 */
function ReturnDialog({ rows, onConfirm, onClose, busy }: {
  rows: ApprovalRow[]; onConfirm: (note: string) => void; onClose: () => void; busy: boolean;
}) {
  const [note, setNote] = useState('');
  const presets = [
    'Benefit basis not agreed with Finance. Please attach the reconciliation and resubmit.',
    'Figure does not match the supporting calculation. Please review and resubmit.',
    'This appears to include a benefit already booked under another initiative.',
    'Baseline used is not the one agreed at initiative approval.',
  ];

  return (
    <Modal
      title={rows.length === 1 ? 'Return for revision' : `Return ${rows.length} entries for revision`}
      subtitle={rows.length === 1 ? `${rows[0].initiative_code} · ${rows[0].label}` : undefined}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={!note.trim() || busy} onClick={() => onConfirm(note.trim())}>
            <Icon name="send" /> Return to owner
          </button>
        </>
      }
    >
      <Alert tone="amber">
        The owner will receive this reason by mail and in the application. The entry stops counting towards
        booked savings until it is corrected and approved.
      </Alert>

      <div className="field">
        <label>Reason for returning</label>
        <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Say what needs to change, specifically enough to act on." />
      </div>

      <div className="stack gap-6">
        <span className="tiny upper muted">Common reasons</span>
        {presets.map((p) => (
          <button key={p} className="btn btn-outline btn-xs" style={{ textAlign: 'left', justifyContent: 'flex-start' }}
            onClick={() => setNote(p)}>
            {p}
          </button>
        ))}
      </div>

      {rows.length > 1 && (
        <div style={{ marginTop: 16 }}>
          <span className="tiny upper muted">Applies to</span>
          <div className="stack gap-4" style={{ marginTop: 6, maxHeight: 150, overflowY: 'auto' }}>
            {rows.map((r) => (
              <div className="row gap-8 small" key={r.id}>
                <span className="mono tiny">{r.initiative_code}</span>
                <span className="truncate grow">{r.initiative_title}</span>
                <span className="num">{cr(r.actual_cr)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
