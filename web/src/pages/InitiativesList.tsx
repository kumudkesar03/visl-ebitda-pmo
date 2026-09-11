import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useApp, useToast } from '../context/AppContext';
import { PageHeader, SyntheticBanner } from '../components/Shell';
import { BuPicker } from '../components/BuPicker';
import { Card, Empty, Loading, HealthDot, BuTag, StatusBadge, DualBar, ProgressBar, Alert } from '../components/Primitives';
import { Icon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { cr, pct, crSigned, varianceTone, achievementTone, dateShort } from '../lib/format';
import { STATUS_OPTIONS, PRIORITY_OPTIONS, statusLabel, PRIORITY_LABELS } from '../lib/vocabulary';
import type { Initiative, BusinessUnit, User } from '../types/api';

interface Reference {
  businessUnits: BusinessUnit[];
  departments: { id: number; name: string; bu_code: string }[];
  categories: { code: string; name: string }[];
  users: User[];
  writeScope: string[];
}

type SortKey = 'code' | 'title' | 'target_savings_cr' | 'booked_ptd_cr' | 'achievement' | 'progress_pct';

export function InitiativesList() {
  const { bu, can } = useApp();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'target_savings_cr', dir: -1 });

  const filters = {
    status: params.get('status') || '',
    health: params.get('health') || '',
    category: params.get('category') || '',
    q: params.get('q') || '',
  };

  const { data, isLoading } = useQuery({
    queryKey: ['initiatives', bu, filters],
    queryFn: () => api.get<{ rows: Initiative[] }>(`/initiatives${qs({ bu, ...filters })}`),
    enabled: !!bu,
  });

  const { data: ref } = useQuery({
    queryKey: ['reference'],
    queryFn: () => api.get<Reference>('/admin/reference'),
  });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    const key = sort.key;
    return [...list].sort((a, b) => {
      const av = key === 'achievement' ? (a.achievement_ptd.pct ?? -1) : (a as any)[key];
      const bv = key === 'achievement' ? (b.achievement_ptd.pct ?? -1) : (b as any)[key];
      if (typeof av === 'string') return av.localeCompare(bv) * sort.dir;
      return ((av ?? 0) - (bv ?? 0)) * sort.dir;
    });
  }, [data, sort]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    target: acc.target + r.target_savings_cr,
    plan: acc.plan + r.plan_ptd_cr,
    booked: acc.booked + r.booked_ptd_cr,
  }), { target: 0, plan: 0, booked: 0 }), [rows]);

  const maxBar = Math.max(...rows.map((r) => Math.max(r.plan_ptd_cr, r.booked_ptd_cr)), 0.01);

  const header = (key: SortKey, label: string, right = false) => (
    <th
      className={right ? 'right' : ''}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === -1 ? 1 : -1 }))}
    >
      {label}
      {sort.key === key && <span className="dim"> {sort.dir === -1 ? '▼' : '▲'}</span>}
    </th>
  );

  return (
    <>
      <PageHeader title="Initiatives" subtitle={`${rows.length} in scope · ${cr(totals.target)} Cr committed`}>
        <BuPicker />
        {can('initiative:create') && (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New initiative
          </button>
        )}
      </PageHeader>

      <div className="content">
        <SyntheticBanner />

        <div className="filter-bar">
          <span className="row gap-6 muted small"><Icon name="filter" /> Filter</span>
          <input
            className="input search" placeholder="Search code, title or owner…"
            defaultValue={filters.q}
            onChange={(e) => setFilter('q', e.target.value)}
          />
          <select className="select" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <select className="select" value={filters.health} onChange={(e) => setFilter('health', e.target.value)}>
            <option value="">All health</option>
            <option value="green">On track</option>
            <option value="amber">Watch</option>
            <option value="red">Off track</option>
          </select>
          <select className="select" value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
            <option value="">All levers</option>
            {(ref?.categories ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          {(filters.status || filters.health || filters.category || filters.q) && (
            <button className="btn btn-ghost btn-sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              <Icon name="x" /> Clear
            </button>
          )}
          <span className="grow" />
          <span className="small muted">
            Booked {cr(totals.booked)} of {cr(totals.plan)} Cr planned to date
          </span>
        </div>

        <Card bodyClass="tight">
          {isLoading ? <div style={{ padding: 18 }}><Loading rows={8} /></div>
            : rows.length === 0 ? (
              <Empty title="No initiatives match">
                Adjust the filters, or raise a new initiative if this unit has nothing recorded yet.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      {header('code', 'Code')}
                      {header('title', 'Initiative')}
                      <th>Unit</th>
                      <th>Owner</th>
                      <th>Status</th>
                      {header('target_savings_cr', 'Target', true)}
                      <th style={{ width: 108 }}>Plan vs booked</th>
                      {header('booked_ptd_cr', 'Booked', true)}
                      <th className="right">Variance</th>
                      {header('achievement', 'Achv', true)}
                      {header('progress_pct', 'Progress', true)}
                      <th style={{ width: 30 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((i) => (
                      <tr key={i.id}>
                        <td className="code">{i.code}</td>
                        <td style={{ maxWidth: 320 }}>
                          <Link to={`/initiatives/${i.id}`} className="strong">{i.title}</Link>
                          <div className="tiny muted truncate">{i.category_name} · {i.department_name}</div>
                        </td>
                        <td><BuTag code={i.bu_code} /></td>
                        <td className="small nowrap">{i.owner_name || <span className="dim">unassigned</span>}</td>
                        <td><StatusBadge status={i.status} /></td>
                        <td className="right num strong">{cr(i.target_savings_cr)}</td>
                        <td><DualBar plan={i.plan_ptd_cr} actual={i.booked_ptd_cr} max={maxBar} /></td>
                        <td className="right num">{cr(i.booked_ptd_cr)}</td>
                        <td className={`right num delta ${varianceTone(i.variance_ptd_cr)}`}>{crSigned(i.variance_ptd_cr)}</td>
                        <td className="right">
                          <span className={`badge ${achievementTone(i.achievement_ptd.pct)}`}>{pct(i.achievement_ptd.pct, 0)}</span>
                        </td>
                        <td className="right"><ProgressBar value={i.progress_pct} /></td>
                        <td>
                          <HealthDot
                            health={i.health}
                            label={false}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="total-row">
                      <td colSpan={5}>{rows.length} initiatives</td>
                      <td className="right num">{cr(totals.target)}</td>
                      <td />
                      <td className="right num">{cr(totals.booked)}</td>
                      <td className="right num">{crSigned(totals.booked - totals.plan)}</td>
                      <td className="right num">{pct(totals.plan > 0 ? (totals.booked / totals.plan) * 100 : null, 0)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </Card>
      </div>

      {creating && ref && <CreateInitiative reference={ref} onClose={() => setCreating(false)} />}
    </>
  );
}

/* ====================================================================== *
 * Create
 * ====================================================================== */

/**
 * Raising an initiative.
 *
 * The business unit list offers only LEAF units, because a consolidated node
 * holds no rows - that is the rule the whole roll-up depends on. The server
 * enforces it too; offering the choice and then rejecting it would just be a
 * worse way of teaching the same rule.
 */
function CreateInitiative({ reference, onClose }: { reference: Reference; onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const writable = reference.businessUnits.filter((b) => reference.writeScope.includes(b.code));

  const [form, setForm] = useState({
    bu_code: writable[0]?.code || '',
    title: '',
    description: '',
    department_id: '',
    owner_id: '',
    category: reference.categories[0]?.code || '',
    priority: 'medium',
    target_savings_cr: '',
    start_date: '',
    due_date: '',
  });

  const departments = reference.departments.filter((d) => d.bu_code === form.bu_code);
  const owners = reference.users.filter((u) => u.home_bu === form.bu_code);

  const save = useMutation({
    mutationFn: () => api.post('/initiatives', {
      ...form,
      department_id: form.department_id ? Number(form.department_id) : null,
      owner_id: form.owner_id ? Number(form.owner_id) : null,
      target_savings_cr: Number(form.target_savings_cr) || 0,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['initiatives'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      push('Initiative raised. Set the monthly plan next.', 'success');
      onClose();
    },
    onError: (e: any) => push(e.message, 'error'),
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      title="Raise an initiative"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!form.title.trim() || !form.bu_code || save.isPending}
            onClick={() => save.mutate()}
          >
            <Icon name="save" /> {save.isPending ? 'Saving…' : 'Create initiative'}
          </button>
        </>
      }
    >
      {writable.length === 0 && (
        <Alert tone="amber">
          Your access does not include any reporting unit you can write to, so an initiative cannot be raised
          from this account.
        </Alert>
      )}

      <div className="field-row">
        <div className="field">
          <label>Reporting unit</label>
          <select className="select" value={form.bu_code} onChange={(e) => { set('bu_code', e.target.value); set('department_id', ''); set('owner_id', ''); }}>
            {writable.map((b) => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
          </select>
          <span className="help">Initiatives attach to reporting units only. VISL and IOB are roll-ups.</span>
        </div>
        <div className="field">
          <label>EBITDA lever</label>
          <select className="select" value={form.category} onChange={(e) => set('category', e.target.value)}>
            {reference.categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Title</label>
        <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Coke rate reduction in blast furnace" />
      </div>

      <div className="field">
        <label>What is being done, and how the saving is measured</label>
        <textarea className="input" value={form.description} onChange={(e) => set('description', e.target.value)}
          placeholder="State the lever, the baseline and the measurement basis agreed with Finance." />
        <span className="help">The measurement basis is what the PMO office will check against when approving monthly actuals.</span>
      </div>

      <div className="field-row three">
        <div className="field">
          <label>Department</label>
          <select className="select" value={form.department_id} onChange={(e) => set('department_id', e.target.value)}>
            <option value="">Not set</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Owner</label>
          <select className="select" value={form.owner_id} onChange={(e) => set('owner_id', e.target.value)}>
            <option value="">Not set</option>
            {owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Priority</label>
          <select className="select" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
            {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </div>
      </div>

      <div className="field-row three">
        <div className="field">
          <label>Full-year target (Rs Cr)</label>
          <input className="input num-input" type="number" step="0.01" value={form.target_savings_cr}
            onChange={(e) => set('target_savings_cr', e.target.value)} placeholder="0.00" />
        </div>
        <div className="field">
          <label>Start</label>
          <input className="input" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
        </div>
        <div className="field">
          <label>Due</label>
          <input className="input" type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
        </div>
      </div>

      <Alert tone="info">
        The twelve-month plan grid is created empty with the initiative. Set the monthly split on the
        initiative page — the system will check that the months add up to the full-year target.
      </Alert>
      <div className="tiny muted">Created {dateShort(new Date().toISOString())}</div>
    </Modal>
  );
}
