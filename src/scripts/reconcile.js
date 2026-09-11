'use strict';

/**
 * Reconciliation gate.  `npm run check:metrics`
 *
 * Asserts the invariants that the reporting layer must never break. Run it
 * against the synthetic dataset in CI, and against the live database after any
 * change to a view or an aggregation.
 *
 * text.txt section 8 describes how the fan-out defect was found: VISL plan
 * showed 670.34 Cr against a 105.58 Cr target, and IOK's 207.55 turned out to
 * be 29.65 x 7 initiatives. The defect was only visible because somebody added
 * the children up by hand. This script does that addition on every run, so the
 * same class of defect fails a build instead of reaching a board pack.
 */

const H = require('../domain/hierarchy');
const M = require('../domain/metrics');
const repo = require('../data');

const TOLERANCE = 0.005; // half a paisa per crore - anything larger is real

const checks = [];
let failed = 0;

function assert(name, ok, detail) {
  checks.push({ name, ok, detail });
  if (!ok) failed += 1;
}

function near(a, b) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= TOLERANCE;
}

async function main() {
  const ctx = await repo.reportingContext();
  const { initiatives, monthRows, periods, closedThrough } = ctx;
  const roll = M.rollup({ initiatives, monthRows, periods, closedThrough });

  const MONEY = ['target_cr', 'plan_fy_cr', 'plan_ptd_cr', 'booked_ptd_cr', 'booked_fy_cr', 'submitted_cr'];

  /* 1. Every consolidated node equals the sum of its immediate children. */
  for (const unit of H.ALL) {
    const kids = H.childrenOf(unit.code);
    if (!kids.length) continue;
    const node = roll.nodes[unit.code];

    for (const field of MONEY) {
      const childSum = kids.reduce((a, k) => a + roll.nodes[k.code][field], 0);
      assert(
        `${unit.code}.${field} = sum(${kids.map((k) => k.code).join('+')})`,
        near(node[field], childSum),
        `node=${node[field].toFixed(4)} children=${childSum.toFixed(4)}`,
      );
    }

    const childCount = kids.reduce((a, k) => a + roll.nodes[k.code].initiative_count, 0);
    assert(
      `${unit.code}.initiative_count = sum(children)`,
      node.initiative_count === childCount,
      `node=${node.initiative_count} children=${childCount}`,
    );
  }

  /* 2. Consolidated nodes hold no initiatives of their own. */
  const consolidated = H.ALL.filter((u) => u.consolidated).map((u) => u.code);
  const misplaced = initiatives.filter((i) => consolidated.includes(String(i.bu_code).toUpperCase()));
  assert(
    'no initiative is attached directly to a consolidated node',
    misplaced.length === 0,
    misplaced.map((i) => `${i.code}->${i.bu_code}`).join(', ') || 'none',
  );

  /* 3. Every initiative sits on a business unit that exists. */
  const orphans = initiatives.filter((i) => !H.exists(i.bu_code));
  assert('every initiative has a valid business unit', orphans.length === 0,
    orphans.map((i) => i.code).join(', ') || 'none');

  /* 4. Monthly plan foots to the full-year target at every node.
        This is the check that would have caught the 670.34 against 105.58. */
  for (const code of roll.order) {
    const n = roll.nodes[code];
    assert(
      `${code}: sum(monthly plan) = sum(initiative targets)`,
      near(n.plan_fy_cr, n.target_cr),
      `plan=${n.plan_fy_cr.toFixed(4)} target=${n.target_cr.toFixed(4)}`,
    );
  }

  /* 5. Booked never exceeds reported, and approved-only is respected. */
  for (const code of roll.order) {
    const n = roll.nodes[code];
    const anyStatus = M.sumOver(n.series, roll.window.all, 'actual_cr');
    assert(`${code}: booked <= total reported`, n.booked_fy_cr <= anyStatus + TOLERANCE,
      `booked=${n.booked_fy_cr.toFixed(4)} reported=${anyStatus.toFixed(4)}`);
  }

  /* 6. No ratio was built from mismatched windows. This is the 396.8% guard:
        plan-to-date achievement must use the closed window on BOTH sides. */
  for (const code of roll.order) {
    const n = roll.nodes[code];
    const a = n.achievement_ptd;
    assert(
      `${code}: achievement_ptd denominator = plan over closed months`,
      near(a.denominator, n.plan_ptd_cr),
      `denominator=${a.denominator} plan_ptd=${n.plan_ptd_cr}`,
    );
    assert(
      `${code}: achievement_ptd numerator = booked over closed months`,
      near(a.numerator, n.booked_ptd_cr),
      `numerator=${a.numerator} booked_ptd=${n.booked_ptd_cr}`,
    );
    assert(
      `${code}: every ratio states its basis`,
      !!a.basis && !!n.target_delivered.basis,
      `${a.basis} / ${n.target_delivered.basis}`,
    );
  }

  /* 7. Cumulative series is monotonic and ends at the full-year figure. */
  for (const code of roll.order) {
    const n = roll.nodes[code];
    const last = n.series[n.series.length - 1];
    assert(`${code}: cumulative plan ends at full-year plan`,
      near(last.cum_plan_cr, n.plan_fy_cr),
      `cum=${last.cum_plan_cr} fy=${n.plan_fy_cr}`);
    const monotonic = n.series.every((s, i, arr) => i === 0 || s.cum_booked_cr >= arr[i - 1].cum_booked_cr - TOLERANCE);
    assert(`${code}: cumulative booked never decreases`, monotonic, '');
  }

  /* ------------------------------- report -------------------------------- */
  const pad = (s, n) => String(s).padEnd(n);
  console.log('');
  console.log(`VISL EBITDA Drive PMO - reconciliation  (${repo.mode()} data)`);
  console.log(`Window: ${roll.window.label}   |   ${initiatives.length} initiatives   |   tolerance ${TOLERANCE} Cr`);
  console.log('-'.repeat(78));
  for (const c of checks) {
    if (!c.ok) console.log(`FAIL  ${pad(c.name, 56)} ${c.detail}`);
  }
  console.log(`${checks.length - failed} passed, ${failed} failed, ${checks.length} total`);
  console.log('');

  if (failed === 0) {
    console.log('RECONCILIATION TABLE');
    console.log('-'.repeat(78));
    console.log(`${pad('Unit', 10)}${pad('Init', 6)}${pad('Target', 11)}${pad('Plan FY', 11)}${pad('Booked PTD', 12)}Achv PTD`);
    for (const code of roll.order) {
      const n = roll.nodes[code];
      const indent = '  '.repeat(n.bu.depth);
      console.log(
        pad(indent + code, 10)
        + pad(n.initiative_count, 6)
        + pad(n.target_cr.toFixed(2), 11)
        + pad(n.plan_fy_cr.toFixed(2), 11)
        + pad(n.booked_ptd_cr.toFixed(2), 12)
        + (n.achievement_ptd.pct === null ? '--' : `${n.achievement_ptd.pct.toFixed(1)}%`),
      );
    }
    console.log('');
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Reconciliation failed to run:', err);
  process.exit(2);
});
