import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useApp } from '../context/AppContext';
import { PageHeader, SyntheticBanner } from '../components/Shell';
import { WindowNote } from '../components/BuPicker';
import { Card, Kpi, RatioKpi, KpiSkeleton, HealthDot, BuTag, Empty, DualBar, StatusBadge } from '../components/Primitives';
import { MonthlyDelivery, ComparisonBars, MixDoughnut } from '../components/Charts';
import { Icon } from '../components/Icons';
import { cr, pct, crSigned, varianceTone, achievementTone } from '../lib/format';
import { statusLabel } from '../lib/vocabulary';
import type { Headline, MonthPoint, UnitSummary, Initiative, BusinessUnit, Window } from '../types/api';

interface DashboardResponse {
  node: BusinessUnit;
  window: Window;
  headline: Headline;
  series: MonthPoint[];
  breakdown: UnitSummary[];
  byCategory: { code: string; name: string; accent?: string; target_cr: number; booked_ptd_cr: number; plan_ptd_cr: number; count: number }[];
  atRisk: Initiative[];
  topDelivering: Initiative[];
  counts: { initiatives: number; status: Record<string, number>; health: Record<string, number>; awaitingApproval: number };
}

/**
 * The operational dashboard.
 *
 * Where the executive board asks "will the year land", this asks "what is my
 * team doing this month". It is the screen a BU PMO lead lives in, so it
 * leads with the breakdown one level down - the units or departments they
 * actually chase - rather than with the consolidated number they already know.
 */
export function Dashboard() {
  const { bu, session, can } = useApp();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', bu],
    queryFn: () => api.get<DashboardResponse>(`/dashboard${qs({ bu })}`),
    enabled: !!bu,
  });

  const h = data?.headline;

  return (
    <>
      <PageHeader
        title={data ? data.node.name : 'Dashboard'}
        subtitle={data
          ? <WindowNote label={`${session.settings.fy_label} · ${data.window.label}`} closedCount={data.window.closedCount} totalCount={data.window.totalCount} />
          : 'Loading…'}
      >
        {can('report:export') && (
          <a className="btn btn-outline btn-sm" href={`/api/export/matrix.xlsx${qs({ bu })}`}>
            <Icon name="download" /> Export
          </a>
        )}
      </PageHeader>

      <div className="content">
        <SyntheticBanner />

        {isLoading || !data || !h ? <KpiSkeleton count={5} /> : (
          <>
            <div className="kpi-band" style={{ marginBottom: 14 }}>
              <Kpi
                label="Full-year target"
                value={cr(h.target_cr)} unit="Cr" accent="navy"
                sub={<span className="muted">{h.initiative_count} initiatives</span>}
                basis={`Committed for ${session.settings.fy_label}`}
              />
              <Kpi
                label="Plan to date"
                value={cr(h.plan_ptd_cr)} unit="Cr" accent="blue"
                sub={<span className="muted">{pct(h.elapsed_share.pct, 0)} of the year&rsquo;s plan</span>}
                basis={`Closed months · ${data.window.label}`}
              />
              <Kpi
                label="Booked to date"
                value={cr(h.booked_ptd_cr)} unit="Cr" accent="green"
                delta={{ value: h.variance_ptd_cr }}
                sub={<span className="muted">variance to plan</span>}
                basis="Approved actuals only"
              />
              <RatioKpi label="Achievement" ratio={h.achievement_ptd} />
              <Kpi
                label="Awaiting approval"
                value={cr(h.submitted_cr)} unit="Cr"
                accent={data.counts.awaitingApproval > 0 ? 'amber' : 'navy'}
                sub={
                  data.counts.awaitingApproval > 0 && can('actual:approve')
                    ? <Link to="/approvals">{data.counts.awaitingApproval} entries to review →</Link>
                    : <span className="muted">{data.counts.awaitingApproval} entries submitted</span>
                }
                basis="Submitted but not yet counted as banked"
              />
            </div>

            <div className="grid-cards cols-2-1" style={{ marginBottom: 14 }}>
              <Card
                title="Monthly delivery against plan"
                hint="Open months are shown faded — nothing has been reported against them yet"
              >
                <MonthlyDelivery series={data.series} closedThrough={data.window.closedThrough} height={250} />
              </Card>

              <Card title="Portfolio health" hint={`${h.initiative_count} active initiatives`}>
                <HealthSplit counts={data.counts.health} total={h.initiative_count} />
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--ink-150)' }}>
                  <div className="upper muted" style={{ marginBottom: 9 }}>By status</div>
                  <div className="stack gap-7">
                    {Object.entries(data.counts.status)
                      .sort((a, b) => b[1] - a[1])
                      .map(([k, v]) => (
                        <div className="row gap-8" key={k}>
                          <StatusBadge status={k} />
                          <span className="grow" />
                          <span className="small num strong">{v}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </Card>
            </div>

            <div className="grid-cards cols-2-1" style={{ marginBottom: 14 }}>
              <Card
                title={data.node.is_consolidated || data.node.consolidated ? 'By reporting unit' : 'By department'}
                hint="Plan to date against booked to date"
                bodyClass="tight"
              >
                <BreakdownTable rows={data.breakdown} />
              </Card>

              <Card title="By EBITDA lever" hint="Full-year target split across cost levers">
                <MixDoughnut
                  rows={data.byCategory.map((c) => ({ name: c.name, value: c.target_cr, accent: c.accent }))}
                  height={150}
                />
              </Card>
            </div>

            <div className="grid-cards cols-2" style={{ marginBottom: 14 }}>
              <Card title="Delivery by lever" hint="Plan to date against booked to date">
                {data.byCategory.length === 0 ? <Empty title="No categories" /> : (
                  <ComparisonBars
                    rows={data.byCategory.slice(0, 8).map((c) => ({
                      name: c.name, plan: c.plan_ptd_cr, booked: c.booked_ptd_cr, accent: c.accent,
                    }))}
                    height={Math.max(190, data.byCategory.slice(0, 8).length * 34)}
                  />
                )}
              </Card>

              <Card title="Delivering strongest" hint="By value banked this year" bodyClass="tight">
                <InitiativeMiniTable rows={data.topDelivering} showAchievement />
              </Card>
            </div>

            <Card
              title="Needs attention"
              hint="Off track, flagged at risk, or carrying an open risk while running behind plan"
              bodyClass="tight"
              actions={<Link className="btn btn-outline btn-sm" to="/initiatives?health=amber">View all</Link>}
            >
              {data.atRisk.length === 0
                ? <Empty title="Nothing needs attention" icon="check">Every initiative in this scope is on plan with no open risk against it.</Empty>
                : <InitiativeMiniTable rows={data.atRisk} showAchievement showStatus />}
            </Card>
          </>
        )}
      </div>
    </>
  );
}

/* ====================================================================== *
 * Health split
 * ====================================================================== */

/**
 * Health as a single proportional bar rather than three numbers.
 *
 * "Nine red out of forty-eight" is a fact you have to compute; a bar that is
 * one-fifth red is a fact you see. The counts are still printed beneath for
 * anyone who needs the exact figure.
 */
function HealthSplit({ counts, total }: { counts: Record<string, number>; total: number }) {
  const order: ('green' | 'amber' | 'red')[] = ['green', 'amber', 'red'];
  const labels = { green: 'On track', amber: 'Watch', red: 'Off track' };
  const safeTotal = total > 0 ? total : 1;

  return (
    <>
      <div className="row" style={{ height: 12, borderRadius: 20, overflow: 'hidden', background: 'var(--ink-150)' }}>
        {order.map((k) => {
          const v = counts[k] || 0;
          if (!v) return null;
          return (
            <span
              key={k}
              title={`${v} ${labels[k]}`}
              style={{
                width: `${(v / safeTotal) * 100}%`,
                // The parent is a flex row centring its children, which collapses
                // a span with no height of its own to nothing. Stretch it.
                alignSelf: 'stretch',
                background: k === 'green' ? 'var(--green-600)' : k === 'amber' ? 'var(--amber-600)' : 'var(--red-600)',
              }}
            />
          );
        })}
      </div>
      <div className="row gap-16" style={{ marginTop: 11 }}>
        {order.map((k) => (
          <div className="stack" key={k}>
            <span className="row gap-6">
              <i className={`dot ${k}`} />
              <span className="tiny muted">{labels[k]}</span>
            </span>
            <span className="num strong" style={{ fontSize: 17, marginTop: 1 }}>{counts[k] || 0}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ====================================================================== *
 * Breakdown table
 * ====================================================================== */

function BreakdownTable({ rows }: { rows: UnitSummary[] }) {
  if (!rows.length) return <Empty title="Nothing to break down" />;
  const max = Math.max(...rows.map((r) => Math.max(r.plan_ptd_cr, r.booked_ptd_cr)), 0.01);

  return (
    <div className="table-wrap">
      <table className="grid compact">
        <thead>
          <tr>
            <th>Unit</th>
            <th className="right">Target</th>
            <th style={{ width: 110 }}>Plan vs booked</th>
            <th className="right">Booked</th>
            <th className="right">Variance</th>
            <th className="right">Achv</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td>
                <span className="row gap-8">
                  {r.accent && <i className="dot" style={{ background: r.accent }} />}
                  <span className="truncate strong">{r.name}</span>
                </span>
                <span className="tiny muted">{r.initiative_count} initiatives</span>
              </td>
              <td className="right num">{cr(r.target_cr)}</td>
              <td><DualBar plan={r.plan_ptd_cr} actual={r.booked_ptd_cr} max={max} /></td>
              <td className="right num strong">{cr(r.booked_ptd_cr)}</td>
              <td className={`right num delta ${varianceTone(r.variance_ptd_cr)}`}>{crSigned(r.variance_ptd_cr)}</td>
              <td className="right">
                <span className={`badge ${achievementTone(r.achievement_pct)}`}>{pct(r.achievement_pct, 0)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ====================================================================== *
 * Compact initiative table
 * ====================================================================== */

export function InitiativeMiniTable({ rows, showAchievement, showStatus }: {
  rows: Initiative[]; showAchievement?: boolean; showStatus?: boolean;
}) {
  if (!rows.length) return <Empty title="Nothing here" />;
  return (
    <div className="table-wrap">
      <table className="grid compact">
        <thead>
          <tr>
            <th>Initiative</th>
            <th>Unit</th>
            {showStatus && <th>Status</th>}
            <th className="right">Target</th>
            <th className="right">Booked</th>
            {showAchievement && <th className="right">Achv</th>}
            <th style={{ width: 26 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id}>
              <td>
                <Link to={`/initiatives/${i.id}`} className="strong">{i.title}</Link>
                <div className="tiny muted">
                  <span className="mono">{i.code}</span> · {i.owner_name || 'unassigned'}
                </div>
              </td>
              <td><BuTag code={i.bu_code} /></td>
              {showStatus && <td><span className="tiny">{statusLabel(i.status)}</span></td>}
              <td className="right num">{cr(i.target_savings_cr)}</td>
              <td className="right num strong">{cr(i.booked_ptd_cr)}</td>
              {showAchievement && (
                <td className="right">
                  <span className={`badge ${achievementTone(i.achievement_ptd.pct)}`}>{pct(i.achievement_ptd.pct, 0)}</span>
                </td>
              )}
              <td><HealthDot health={i.health} label={false} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
