# 03 · Data model

Schema: `sql/01_schema.sql` · Reference data: `sql/02_reference_data.sql`

---

## The hierarchy, and the one rule everything depends on

`business_units` is self-referencing. `is_consolidated` marks a roll-up node.

```
VISL   consolidated
  ESL         leaf
  IOB    consolidated
    IOK       leaf
    IOG       leaf
    VAB       leaf
    HO        leaf
  FACOR       leaf
```

> **Initiatives attach ONLY to leaf nodes.**
>
> Consolidated nodes never hold rows directly. Every level is therefore the
> exact arithmetic sum of its descendants, and no figure can be double counted.

A row on a consolidated node would overstate every level above it, and the error
would surface as an unexplained variance in a board pack rather than as a failed
insert — so the rule is enforced three times over:

1. `src/domain/hierarchy.js` — the tree, and `leavesOf()`
2. The API — `createInitiative` refuses a consolidated `bu_code`
3. The database — `ck_initiatives_leaf_only`, via `dbo.fn_bu_is_leaf`

`sql/04_verify.sql` section 3 must always return zero rows.

**Adding sub-units later is a data change, not a migration.** Insert children,
set `is_consolidated = 1` on the parent, mirror it in `hierarchy.js`, move the
initiatives. The views expand the tree recursively.

---

## Tables

| Table | Holds |
|---|---|
| `business_units` | The hierarchy above |
| `departments` | BU-qualified. `name` is UNIQUE across the estate |
| `categories` | The ten EBITDA levers |
| `users` | Account, role, home business unit |
| `owner_aliases` | Maps free-text CSV owner names onto accounts |
| `initiatives` | The portfolio. `target_savings_cr` is the full-year commitment |
| `initiative_months` | **One row per initiative per month.** Plan, actual, approval state |
| `tasks` `milestones` `risks` | Delivery detail beneath an initiative |
| `comments` | Discussion, kept with the record so context survives a handover |
| `notifications` | The in-app bell |
| `audit_log` | Every approval, edit and administrative change |
| `settings` | Reporting calendar, approval policy, display options |

### Why department names are BU-qualified

`departments.name` carries a UNIQUE constraint. In the ESL rollout, IOB's
"Commercial" collided with ESL's existing "Commercial"; the statement
terminated, and because the initiative insert joined on department, **no**
departments and **no** initiatives were created (handover s.4).

Names are therefore `Commercial (IOK)`, `Operations (FACOR)` and so on. Beyond
the constraint it is simply correct: with one shared table across six units,
"Finance" alone is ambiguous.

---

## `initiative_months` — where the governance lives

The most important table in the schema. One row per initiative per month;
`period` is always the first of the month.

| `actual_status` | Meaning | Counts as a saving? |
|---|---|---|
| `draft` | The owner's working figure | No |
| `submitted` | In the approval queue | No — reported as *pipeline* |
| `approved` | **Banked** | **Yes** |
| `rejected` | Returned with a reason | No |

Two constraints carry real weight:

- `uq_initiative_period` — one row per initiative per month. Duplicate months
  are the quiet way a total goes wrong.
- `ck_approved_has_approver` — an approved row **must** name who approved it and
  when. Without it an approval can exist with nobody accountable against it,
  which is the first thing any audit of a savings figure will ask for.

An approved month is **locked**: neither its actual nor the plan behind it can
be edited, because changing the plan under a signed number silently restates a
variance leadership has already been shown. A PMO user with `actual:reopen` can
return it to draft — an explicit act, with an audit entry.

---

## Reference data

`sql/02_reference_data.sql` is idempotent and contains **no business figures** —
the hierarchy, the ten levers, default settings and a bootstrap admin with no
password.

Note the `MERGE` on `settings` uses `WHEN NOT MATCHED` only. Re-running the
script must never silently move a live reporting calendar back to the shipped
default.

### Settings that matter

| Key | Default | Effect |
|---|---|---|
| `reporting.closed_through` | `2026-07-01` | Last month settled. Drives plan-to-date, banked, achievement |
| `reporting.submission_period` | `2026-08-01` | The month owners are entering now |
| `approval.mode` | `central` | `local` / `central` / `visl` — see [04](04-ACCESS-CONTROL.md) |
| `approval.self_approval_allowed` | `false` | Maker–checker |
| `reporting.fy_start` | `2026-04-01` | Start of the twelve-month grid |

**`closed_through` and `submission_period` are different months on purpose.**
Setting them the same makes every dashboard understate delivery for the first
fortnight of every month.

---

## Views

Defined in `sql/03_views.sql`, verified by `sql/04_verify.sql`.

| View | Gives |
|---|---|
| `vw_bu_descendants` | Recursive expansion — every node to itself and its descendants |
| `vw_bu_month_leaf` | Leaf-level plan/booked/submitted per month |
| `vw_bu_month` | The same rolled up to every node, with running cumulatives |
| `vw_visl_position` | **One row per business unit** — the executive board reads this |
| `vw_initiative_rollup` | The initiative register with derived financials |
| `vw_approval_queue` | Submitted months awaiting a decision |

`vw_visl_position` is the one to read if you read only one. Note the two
separate CTEs — `init_roll` for counts and targets, `money_roll` for money —
joined 1:1 per unit. That separation is what makes fan-out impossible; see
[05 · Reporting and metrics](05-REPORTING-METRICS.md).

---

## Synthetic data

Rows generated for design review carry `[SYNTHETIC]` in `description`, the same
convention the ESL build used. `sql/99_reset_synthetic.sql` removes them by that
tag and is never run by the migrator.

In `DATA_MODE=synthetic` nothing touches the database at all — the dataset lives
in memory and snapshots to `var/state.json`.
