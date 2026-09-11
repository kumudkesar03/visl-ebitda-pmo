import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useApp } from '../context/AppContext';
import { PageHeader, SyntheticBanner } from '../components/Shell';
import { BuPicker, WindowNote } from '../components/BuPicker';
import { Card, Kpi, RatioKpi, KpiSkeleton, Loading, HealthDot, BuTag, Alert, Empty } from '../components/Primitives';
import { CumulativeDelivery, MonthlyDelivery, ConcentrationCurve, Legend } from '../components/Charts';
import { Icon } from '../components/Icons';
import { cr, pct, crSigned, varianceTone, achievementTone } from '../lib/format';
import { CHART } from '../lib/vocabulary';
import type { Headline, MonthPoint, UnitSummary, Initiative, BusinessUnit, Window } from '../types/api';

interface BridgeStep { key: string; label: string; value: number; kind: string }

interface BoardResponse {
  node: BusinessUnit;
  window: Window;
  headline: Headline;
  series: MonthPoint[];
  hierarchy: (UnitSummary & { depth: number; is_consolidated: boolean })[];
  bridge: BridgeStep[];
  concentration: { points: { rank: number; code: string; title: string; target_cr: number; cumulative_pct: number }[]; top5_pct: number; top10_pct: number; total_cr: number };
  risks: Initiative[];
  laggards: UnitSummary[];
  generated_at: string;
}

/**
 * THE EXECUTIVE BOARD.
 *
 * Built for one specific reading: a CEO or CFO with ninety seconds before a
 * review. Every design decision here follows from that.
 *
 *  - The two achievement numbers appear TOGETHER and LABELLED. They answer
 *    different questions and will never agree, and the single biggest reporting
 *    failure in the predecessor system (text.txt 13.5) was showing one of them
 *    without saying which.
 *  - The bridge is the first chart, because "will the year land" is the first
 *    question, and it decomposes the answer into banked, in-approval, still
 *    planned, and the genuinely unplanned gap.
 *  - The hierarchy table foots. Children sum to their parent, exactly, and the
 *    reconciliation gate asserts it on every build.
 *  - Nothing is presented as a verdict. Under-plan early in a year is
 *    arithmetic, not underperformance, and the page says so where it matters
 *    rather than leaving a red number to be misread.
 */
export function ExecBoard() {
  const { bu, session } = useApp();
  const { data, isLoading } = useQuery({
    queryKey: ['exec', bu],
    queryFn: () => api.get<BoardResponse>(`/exec/board${qs({ bu })}`),
    enabled: !!bu,
  });

  const h = data?.headline;

  return (
    <>
      <PageHeader
        title="Executive board"
        subtitle={data ? <WindowNote label={`${session.settings.fy_label} · ${data.window.label}`} closedCount={data.window.closedCount} totalCount={data.window.totalCount} /> : 'Loading…'}
      >
        <BuPicker />
        <button className="btn btn-outline btn-sm no-print" onClick={() => window.print()}>
          <Icon name="print" /> Board pack
        </button>
      </PageHeader>

      <div className="content">
        <SyntheticBanner />

        {isLoading || !data || !h ? <KpiSkeleton count={5} /> : (
          <>
            {/* ---------------------------------------------------------- *
                Headline band
             * ---------------------------------------------------------- */}
            <div className="kpi-band" style={{ marginBottom: 14 }}>
              <Kpi
                label="Full-year target"
                value={cr(h.target_cr)} unit="Cr"
                accent="navy"
                sub={<span className="muted">{h.initiative_count} initiatives · {data.node.name}</span>}
                basis={`Committed for ${session.settings.fy_label}`}
              />
              <Kpi
                label="Banked to date"
                value={cr(h.booked_ptd_cr)} unit="Cr"
                accent="green"
                delta={{ value: h.variance_ptd_cr }}
                sub={<span className="muted">vs plan {cr(h.plan_ptd_cr)}</span>}
                basis={`Approved actuals only · ${data.window.label}`}
              />
              <RatioKpi
                label="Achievement"
                ratio={h.achievement_ptd}
                sub={<span className="muted">against plan for closed months</span>}
              />
              <RatioKpi
                label="Target delivered"
                ratio={h.target_delivered}
                accent="blue"
                sub={<span className="muted">of the full-year commitment</span>}
              />
              <Kpi
                label="Forecast full year"
                value={cr(h.forecast_fy_cr)} unit="Cr"
                accent={h.forecast_vs_target.pct !== null && h.forecast_vs_target.pct >= 98 ? 'green' : 'amber'}
                sub={<span className="muted">{pct(h.forecast_vs_target.pct)} of target</span>}
                basis="Banked plus remaining plan delivered in full"
              />
            </div>

            {/* The one sentence that stops the wrong argument. */}
            <TimingNote headline={h} window={data.window} />

            {/* ---------------------------------------------------------- *
                Bridge + cumulative
             * ---------------------------------------------------------- */}
            <div className="grid-cards cols-2" style={{ marginBottom: 14 }}>
              <Card
                title="Where the full-year target stands"
                hint="Every bar is a real position, and the four below the target add up to it"
              >
                <Bridge steps={data.bridge} target={h.target_cr} />
              </Card>

              <Card
                title="Delivery against the curve"
                hint="Cumulative, so a slow month shows as a widening gap rather than a single dip"
              >
                <CumulativeDelivery
                  series={data.series}
                  closedThrough={data.window.closedThrough}
                  target={h.target_cr}
                  height={252}
                />
              </Card>
            </div>

            {/* ---------------------------------------------------------- *
                Hierarchy
             * ---------------------------------------------------------- */}
            <Card
              title="Position by business unit"
              hint="Consolidated rows are the exact sum of the reporting units beneath them"
              className="no-break"
              bodyClass="tight"
              style={{ marginBottom: 14 }}
              footer="Booked counts approved actuals only. A saving does not count towards the drive until the PMO office has approved the month."
            >
              <HierarchyTable rows={data.hierarchy} />
            </Card>

            {/* ---------------------------------------------------------- *
                Risk concentration and the units to watch
             * ---------------------------------------------------------- */}
            <div className="grid-cards cols-2-1" style={{ marginBottom: 14 }}>
              <Card
                title="Monthly delivery"
                hint="Plan in grey; delivery in blue with anything still in the approval queue stacked in amber"
              >
                <MonthlyDelivery series={data.series} closedThrough={data.window.closedThrough} height={244} />
              </Card>

              <Card
                title="Concentration of the target"
                hint="How much of the year rests on how few initiatives"
              >
                <ConcentrationCurve points={data.concentration.points} height={168} />
                <div className="stack gap-6" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--ink-150)' }}>
                  <div className="row">
                    <span className="small grow">Top 5 initiatives</span>
                    <span className="small strong num">{pct(data.concentration.top5_pct, 0)} of target</span>
                  </div>
                  <div className="row">
                    <span className="small grow">Top 10 initiatives</span>
                    <span className="small strong num">{pct(data.concentration.top10_pct, 0)} of target</span>
                  </div>
                  <p className="tiny muted" style={{ margin: '6px 0 0' }}>
                    A steep curve means a small number of initiatives carry the year, and one slipping moves the
                    consolidated number. A shallow curve means the risk is spread.
                  </p>
                </div>
              </Card>
            </div>

            {/* ---------------------------------------------------------- *
                Attention
             * ---------------------------------------------------------- */}
            <div className="grid-cards cols-2">
              <Card
                title="Requiring attention"
                hint="Largest exposure first, weighted for those already off track"
                bodyClass="tight"
              >
                {data.risks.length === 0
                  ? <Empty title="Nothing flagged" icon="check">No initiative in this scope is off track or carrying an open risk.</Empty>
                  : (
                    <div className="table-wrap">
                      <table className="grid compact">
                        <thead>
                          <tr>
                            <th>Initiative</th>
                            <th>Unit</th>
                            <th className="right">Target</th>
                            <th className="right">Achv</th>
                            <th className="right">Risks</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {data.risks.map((i) => (
                            <tr key={i.id}>
                              <td>
                                <Link to={`/initiatives/${i.id}`} className="strong">{i.title}</Link>
                                <div className="tiny muted mono">{i.code} · {i.owner_name}</div>
                              </td>
                              <td><BuTag code={i.bu_code} /></td>
                              <td className="right num">{cr(i.target_savings_cr)}</td>
                              <td className={`right num strong ${achievementTone(i.achievement_ptd.pct) === 'red' ? 'delta down' : ''}`}>
                                {pct(i.achievement_ptd.pct, 0)}
                              </td>
                              <td className="right num">{i.open_risks || '--'}</td>
                              <td><HealthDot health={i.health} label={false} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </Card>

              <Card title="Units furthest behind plan" hint="Reporting units only, ranked by achievement to date">
                {data.laggards.length === 0 ? <Loading rows={3} /> : (
                  <div className="stack gap-14">
                    {data.laggards.map((u) => (
                      <div key={u.code}>
                        <div className="row gap-8" style={{ marginBottom: 5 }}>
                          <BuTag code={u.code} accent={u.accent} />
                          <span className="small grow truncate">{u.name}</span>
                          <span className={`small strong num delta ${varianceTone(u.variance_ptd_cr)}`}>
                            {crSigned(u.variance_ptd_cr)} Cr
                          </span>
                        </div>
                        <div className="row gap-8">
                          <span className={`bar ${achievementTone(u.achievement_pct)}`} style={{ flex: 1 }}>
                            <span style={{ width: `${Math.min(100, u.achievement_pct || 0)}%` }} />
                          </span>
                          <span className="small num" style={{ width: 42, textAlign: 'right' }}>{pct(u.achievement_pct, 0)}</span>
                        </div>
                        <div className="tiny muted" style={{ marginTop: 3 }}>
                          Booked {cr(u.booked_ptd_cr)} against plan {cr(u.plan_ptd_cr)} Cr
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <p className="tiny muted" style={{ marginTop: 16 }}>
              Generated {new Date(data.generated_at).toLocaleString('en-GB')} · scope {session.scope.join(', ')} ·
              approvals under the <b>{session.settings.approval_mode}</b> policy
            </p>
          </>
        )}
      </div>
    </>
  );
}

/* ====================================================================== *
 * The timing note
 * ====================================================================== */

/**
 * text.txt 9(b) makes the point precisely: a negative variance early in the
 * year is arithmetic, not underperformance, and presenting it without that
 * context invites the wrong conversation. Rather than leave it to whoever is
 * presenting to remember, the page computes elapsed plan weighting and states
 * the position in a sentence.
 */
function TimingNote({ headline, window: win }: { headline: Headline; window: Window }) {
  const elapsed = headline.elapsed_share.pct;
  const delivered = headline.target_delivered.pct;
  if (elapsed === null || delivered === null) return null;

  const onTrack = delivered >= elapsed * 0.9;
  return (
    <Alert tone={onTrack ? 'neutral' : 'amber'}>
      <b>{win.closedCount} of {win.totalCount} months are closed</b>, carrying{' '}
      <b>{pct(elapsed, 0)}</b> of the year&rsquo;s plan weighting. {pct(delivered, 0)} of the full-year target is
      banked. {onTrack
        ? ' Delivery is broadly in line with elapsed plan; the variance figure above is against plan-to-date and should be read with that in mind.'
        : ' Delivery is behind elapsed plan weighting, which is a genuine gap rather than a timing effect.'}
    </Alert>
  );
}

/* ====================================================================== *
 * Bridge
 * ====================================================================== */

function Bridge({ steps, target }: { steps: BridgeStep[]; target: number }) {
  const scale = target > 0 ? target : 1;
  const colours: Record<string, string> = {
    total: 'var(--navy-800)',
    positive: CHART.approved,
    pipeline: CHART.pipeline,
    planned: CHART.plan,
    gap: '#c0332e',
  };

  return (
    <>
      <div className="bridge">
        {steps.map((s) => {
          const magnitude = Math.abs(s.value);
          return (
            <div className="bridge-row" key={s.key}>
              <div className="bridge-label">{s.label}</div>
              <div className="bridge-track">
                <div
                  className="bridge-fill"
                  style={{
                    left: 0,
                    width: `${Math.max(0.6, Math.min(100, (magnitude / scale) * 100))}%`,
                    background: colours[s.kind] || 'var(--ink-300)',
                    opacity: s.kind === 'planned' ? 0.75 : 1,
                  }}
                />
              </div>
              <div className="bridge-value">{cr(magnitude)}</div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--ink-150)' }}>
        <Legend items={[
          { label: 'Banked', color: CHART.approved },
          { label: 'Awaiting approval', color: CHART.pipeline },
          { label: 'Planned, not yet due', color: CHART.plan },
          { label: 'Unplanned gap', color: '#c0332e' },
        ]} />
        <p className="tiny muted" style={{ margin: '8px 0 0' }}>
          The unplanned gap is the part of the full-year commitment with no monthly plan behind it at all.
          It is the number that needs new initiatives rather than better delivery.
        </p>
      </div>
    </>
  );
}

/* ====================================================================== *
 * Hierarchy table
 * ====================================================================== */

function HierarchyTable({ rows }: { rows: (UnitSummary & { depth: number; is_consolidated: boolean })[] }) {
  return (
    <div className="table-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th>Business unit</th>
            <th className="right">Initiatives</th>
            <th className="right">Target</th>
            <th className="right">Plan to date</th>
            <th className="right">Banked</th>
            <th className="right">Variance</th>
            <th className="right">Achievement</th>
            <th className="right">Target delivered</th>
            <th style={{ width: 110 }}>Health</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className={r.is_consolidated ? 'group-row' : undefined}>
              <td className={r.depth === 1 ? 'indent-1' : r.depth >= 2 ? 'indent-2' : ''}>
                <span className="row gap-8">
                  <i className="dot" style={{ background: r.accent || 'var(--ink-300)' }} />
                  <b>{r.code}</b>
                  <span className="muted small truncate">{r.name}</span>
                  {r.is_consolidated && <span className="badge" style={{ fontSize: 10 }}>roll-up</span>}
                </span>
              </td>
              <td className="right num">{r.initiative_count}</td>
              <td className="right num strong">{cr(r.target_cr)}</td>
              <td className="right num muted">{cr(r.plan_ptd_cr)}</td>
              <td className="right num strong">{cr(r.booked_ptd_cr)}</td>
              <td className={`right num delta ${varianceTone(r.variance_ptd_cr)}`}>{crSigned(r.variance_ptd_cr)}</td>
              <td className="right">
                <span className={`badge ${achievementTone(r.achievement_pct)}`}>{pct(r.achievement_pct, 0)}</span>
              </td>
              <td className="right num">{pct(r.target_delivered_pct, 0)}</td>
              <td>
                <span className="row gap-4">
                  {(['green', 'amber', 'red'] as const).map((k) => (
                    (r.health_counts[k] || 0) > 0 && (
                      <span className="row gap-4" key={k} title={`${r.health_counts[k]} ${k}`}>
                        <i className={`dot ${k}`} />
                        <span className="tiny num">{r.health_counts[k]}</span>
                      </span>
                    )
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="total-row">
            <td>Consolidated</td>
            <td className="right num">{rows[0]?.initiative_count ?? 0}</td>
            <td className="right num">{cr(rows[0]?.target_cr ?? 0)}</td>
            <td className="right num">{cr(rows[0]?.plan_ptd_cr ?? 0)}</td>
            <td className="right num">{cr(rows[0]?.booked_ptd_cr ?? 0)}</td>
            <td className="right num">{crSigned(rows[0]?.variance_ptd_cr ?? 0)}</td>
            <td className="right num">{pct(rows[0]?.achievement_pct ?? null, 0)}</td>
            <td className="right num">{pct(rows[0]?.target_delivered_pct ?? null, 0)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
