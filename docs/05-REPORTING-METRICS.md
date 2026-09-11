# 05 · Reporting and metrics

Every savings figure this application shows — dashboard tile, chart axis,
exported cell, board pack, mail digest — is produced by **one module**:
`src/domain/metrics.js`. Nothing else divides one money column by another.

The SQL views in `sql/03_views.sql` compute the same figures for reporting
tools. `npm run check:metrics` and `sql/04_verify.sql` assert that the two
agree.

---

## The vocabulary

| Term | Means |
|---|---|
| **Target** | The full-year commitment. Sum of `initiatives.target_savings_cr`. |
| **Plan** | The monthly spread of that commitment. Should foot to target. |
| **Reported** | Any actual entered, whatever its status. Not a result. |
| **Booked** | **Approved actuals only. This is the savings number.** |
| **Pipeline** | Submitted, awaiting approval. Real work, not yet counted. |
| **Closed month** | A month settled for reporting. Set at `reporting.closed_through`. |
| **Collection month** | The month owners are entering now. `reporting.submission_period`. |

> **Booked counts approved actuals only.** A saving does not count towards the
> drive until the PMO office has approved the month. This is the governance rule
> expressed as arithmetic, and it is why `booked_cr` and `reported_cr` are
> separate columns everywhere.

---

## The two achievement figures

They answer different questions, they will never agree, and reporting either
one without saying which is how a dashboard ends up showing 396.8%.

### Achievement (plan-to-date)

```
booked over CLOSED months  ÷  plan over THE SAME CLOSED months
```

*"Are we hitting the run rate we committed to?"* Moves month to month. The
operational number, and what a PMO lead chases.

### Target delivered (full year)

```
booked, all months  ÷  full-year target
```

*"How much of the year's promise is banked?"* Rises monotonically, never
exceeds 100% in a normal year. The number for the board.

At the shipped dataset, VISL reads **92.0% achievement** and **19.7% target
delivered** on the same screen at the same moment. Both are correct. The
executive board shows them side by side, each labelled with its basis.

---

## How 396.8% happened, and why it cannot happen here

Section 13.5 of the ESL handover:

> "Plan achievement" displays 396.8%. It compares three months of booked
> actuals against one month of plan.

Three months of delivery over one month of plan. Three structural defences now
stand in the way:

**1. Ratios can only be built one way.** `ratio()` is the only function that
produces a percentage. It takes a numerator, a denominator, a `basis` string and
a `window` string, and returns all four together:

```js
{ pct: 92.0, numerator: 21.0177, denominator: 22.8318,
  basis: 'plan-to-date', window: 'Apr 26 to Jul 26' }
```

**2. The type system enforces it.** The client type is `Ratio`, not `number`.
A component cannot render an achievement figure without also holding the label
that says what it is achievement *against*, and the KPI tile prints that label
in the tile — not in a tooltip nobody opens.

**3. The gate asserts it.** `npm run check:metrics` recomputes every ratio's
numerator and denominator independently and fails the build if either was drawn
from a different window than it claims. `sql/04_verify.sql` does the same in SQL.

**A zero denominator returns `null`, never `Infinity` and never a number.** The
UI renders an em dash. The system does not invent performance where there is
nothing to measure against.

---

## How fan-out happened, and why it cannot happen here

Section 13.8:

> `vw_visl_bu_summary` was materially over-stating plan_cr and booked_cr. VISL
> plan showed 670.34 Cr against an annual target of 105.58 Cr. […] IOK showed
> plan 207.55, which is exactly 29.65 (the true figure) × 7 (the number of IOK
> initiatives).

The view joined `initiatives` to the aggregated month figures in a single query,
so each month total repeated once per initiative.

**Counts and money are now reduced in separate passes and joined 1:1 per
business unit** — in `rollup()` in the metrics module, and in two distinct CTEs
(`init_roll`, `money_roll`) in `vw_visl_position`. There is no query in the
system where a month total can meet an initiative row.

The reconciliation gate adds every parent's children on every run:

```
$ npm run check:metrics

VISL EBITDA Drive PMO - reconciliation  (synthetic data)
Window: Apr 26 to Jul 26   |   48 initiatives   |   tolerance 0.005 Cr
------------------------------------------------------------------------------
72 passed, 0 failed, 72 total

Unit      Init  Target     Plan FY    Booked PTD  Achv PTD
VISL      48    111.40     111.40     21.02       92.0%
  ESL     12    34.00      34.00      6.67        93.6%
  IOB     27    58.00      58.00      10.21       90.0%
    IOK   9     21.00      21.00      3.79        95.3%
    IOG   7     13.50      13.50      2.10        81.2%
    VAB   6     14.20      14.20      2.39        84.3%
    HO    5     9.30       9.30       1.92        99.3%
  FACOR   9     19.40      19.40      4.14        94.8%
```

`34.00 + 58.00 + 19.40 = 111.40`. `21.00 + 13.50 + 14.20 + 9.30 = 58.00`. Exactly.

---

## Rounding

**Money is carried at four decimal places everywhere and rounded to two only by
the display formatters.**

Round a business unit to paise, add four of them, and the parent disagrees with
its own children by a paisa or two. That is precisely the signature of the
fan-out defect and it will be read as one in a review. Round once, at the edge,
after every addition is done.

This was a real defect during this build: the first reconciliation run failed on
four assertions with differences of exactly ₹0.01. The fix was moving the
rounding boundary, not widening the tolerance.

---

## The reporting window

```
closed_through    = 2026-07-01     ← last month settled for reporting
submission_period = 2026-08-01     ← the month being collected now
```

**These are different months on purpose.** On 10 September a drive reports July
as closed while August sits in the approval cycle. Collapsing the two — treating
the month still being collected as if it were closed — makes every dashboard
understate delivery in the first fortnight of every month, every month.

Both are edited at **System → Reporting calendar**, and `sql/04_verify.sql`
warns if they are set to the same month.

---

## Timing, not underperformance

Section 9(b) of the handover:

> Variance is negative at every level, achievement around 29–32%. This is
> arithmetic, not underperformance. […] Do not present the negative variance
> figure without this context.

Leaving that to whoever is presenting is how it gets forgotten. The executive
board computes **elapsed plan weighting** and states the position in a sentence
above the charts:

> *4 of 12 months are closed, carrying 21% of the year's plan weighting. 20% of
> the full-year target is banked. Delivery is broadly in line with elapsed plan;
> the variance figure above is against plan-to-date and should be read with that
> in mind.*

If delivery genuinely lags elapsed weighting, the same sentence says so instead.

---

## Derived figures

| Figure | Formula |
|---|---|
| `variance_ptd_cr` | booked-to-date − plan-to-date |
| `gap_to_target_cr` | target − booked (full year) |
| `forecast_fy_cr` | booked + plan remaining in open months |
| `plan_coverage` | plan (full year) ÷ target — is the year fully planned? |
| `elapsed_share` | plan-to-date ÷ plan full-year — how much of the year has run |

### The target bridge

The first chart on the executive board, because *"will the year land"* is the
first question. Each bar is a real position and the four below the target sum
to it:

```
Full-year target        111.40
  Banked (approved)      21.95
  Awaiting approval       4.66
  Planned, months ahead  88.57
  Unplanned gap           0.00   ← target − the three above
```

The **unplanned gap** is the part of the commitment with no monthly plan behind
it at all. It is the number that needs *new initiatives*, not better delivery —
a different management action from a variance, and worth separating.

### Concentration

How much of the year rests on how few initiatives. A steep curve means a handful
of big bets carry the number and one slipping moves the consolidated figure; a
shallow curve means risk is spread. Leadership asks this constantly and usually
has to work it out by hand.

---

## Computed health

Owner-assessed health is kept, but a computed position is shown beside it:

| Condition | Health |
|---|---|
| Completed | green |
| Overdue and not complete | red |
| Achievement ≥ 90% | green |
| Achievement ≥ 70% | amber |
| Otherwise | red |

Where the two diverge, the initiative page says so plainly — *"the owner has
marked this green, its delivery position computes to amber"*. That is
information for the monthly review, not an accusation, and it is worded that way.

---

## "Needs attention", defined once

An initiative qualifies when it is **off track on health, flagged at risk by its
owner, or carrying an open risk while also running behind plan.**

An open risk on an initiative delivering 109% of plan is a risk being managed,
not one for a board pack — surfacing it trains people to ignore the list. And
the *same* definition serves both the dashboard and the executive board: a CEO
shown ten items and a PMO lead shown none, from the same data on the same
morning, destroys trust in both screens.
