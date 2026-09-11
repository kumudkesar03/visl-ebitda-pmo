# 07 · Response to the ESL handover

Section 13 of the ESL implementation work log (`text.txt`, 08 Sep 2026) lists
what was outstanding. This is the point-by-point answer.

---

## 13.1 — Business unit scoping · **BLOCKING** → Closed

> The /visl console is correctly scoped. The main application is NOT. […] Any
> signed-in user currently sees all 33 initiatives across all six units. The
> most serious instance is APPROVALS: an ESL PMO user can approve IOB monthly
> actuals.

**Closed at the data layer, not per route.** Scope is resolved once in
`middleware/auth.js` from the signed-in user's role and home business unit, and
handed to every repository call as an explicit array. A call with no scope
returns nothing rather than everything — so a route that forgets fails visibly
instead of leaking.

Approval carries a second, independent check: authority over the deciding unit
under the configured policy, plus a maker–checker rule that no role can bypass.

Verified live:

```
ESL PMO   GET /api/initiatives          → 12 rows, all ESL
ESL PMO   GET /api/initiatives?bu=IOK   → 403 "Your access does not extend to IOK."
ESL PMO   approvals queue               → 7 rows, all ESL
IOK owner GET /api/approvals            → 403
```

See [04 · Access control](04-ACCESS-CONTROL.md).

---

## 13.2 — Real ESL data → Structural gap closed; figures still yours to load

The ESL placeholder scaffold with empty monthly cells is gone. ESL is modelled
as a full reporting unit with a complete twelve-month plan in the synthetic
dataset, so `VISL plan == VISL target` at every level and the 8.43 Cr
explanation is no longer needed.

The genuine plan still has to come from the ESL PMO team. Load it with:

```bash
npm run seed -- --plan ./savings-plan-ESL.csv --bu ESL
```

Nothing is written unless every row's twelve months foot to its own target.

---

## 13.3 — In-application data entry ("no Excel") → Closed

> Monthly actuals can already be entered in the application. Initiatives and the
> monthly PLAN still arrive only via CSV seeding. Closing this requires new API
> routes and React screens under web/.

Both are now editable in the application:

- **Initiatives** — raised and edited in full, with the twelve-month grid created
  automatically so a new initiative can be planned against immediately.
- **Monthly plan** — editable in place on the initiative page, validated against
  the full-year target, with a running total that turns amber the moment it does
  not foot. Approved months are locked.
- **Actuals** — entered on the initiative page or, for owners, on **My work**,
  which shows only the current month's outstanding submissions.

CSV loading is retained for the initial year-one bulk load. It is no longer the
only path.

---

## 13.4 — Per-business-unit Active Directory → Prepared, not built

> ESL, IOB and FACOR appear to use separate directories […] This should be
> confirmed with the AD team, as the answer changes the work materially. Leave
> until last; AUTH_MODE=local is sufficient for development.

Agreed, and left until last. What has changed is that `AD_DIRECTORIES` is
**keyed by business unit code from the start**, so confirming a multi-directory
topology later means adding entries rather than restructuring the configuration:

```ini
AD_DIRECTORIES={"ESL":{"url":"ldaps://esl-dc:636","baseDN":"..."},"IOB":{...}}
```

Role and home business unit stay application-side either way. AD answers *who
you are*; this system answers *what you may see*.

**Still needed from the AD team:** confirmation of the directory topology and
bind accounts for each.

---

## 13.5 — Plan achievement 396.8% → Closed structurally

> It compares three months of booked actuals against one month of plan.

A percentage can no longer be constructed without its basis. `ratio()` is the
only function that produces one, it returns the numerator, denominator, basis
and window together, the client type is `Ratio` rather than `number`, and the
KPI tile renders the basis in the tile.

The two figures that were being confused are now reported **side by side and
labelled**: *Achievement (plan-to-date)* and *Target delivered (full year)*.

`npm run check:metrics` recomputes both sides of every ratio independently and
fails if either was drawn from a different window than it claims.

---

## 13.6 — Decisions required from leadership → Two answered in code, one still open

**(a) Does a VISL-level PMO user see consolidated figures across all three
businesses?** — *Implemented as yes.* `visl_pmo` and `visl_exec` are global
roles. If leadership decides otherwise, it is a role change per user, not a
code change.

**(b) Do IOK/VAB/IOG/HO approve their own actuals, or does IOB PMO approve
centrally?** — *Made a setting rather than an assumption.* `approval.mode` takes
`local`, `central` or `visl`, changeable at **System → Approval policy**, taking
effect immediately across every queue with no migration. Shipped default is
`central`. The Access model screen shows a side-by-side table of who approves
whom under each option — take that screen into the meeting.

**(c) Can any user see data belonging to another business unit?** — *Implemented
as no,* except for global roles. **This one still needs a decision.** Specifically:
should a FACOR PMO lead be able to see ESL's initiative titles for
benchmarking? Today they cannot. If the answer is yes, it wants a read-only
cross-unit role rather than widening anyone's home scope.

---

## 13.7 — Technical debt

| Item | Status |
|---|---|
| Node 18.20.4 with EBADENGINE warnings | `engines` now requires ≥18.18; **deploy on Node 20 or 22 LTS**. Documented in [01 · Setup](01-SETUP.md). |
| ESL_PMO sits on an IOB production BI server | **Still open — an infrastructure decision.** A VISL-level application spanning three businesses needs its own server with its own backup and lifecycle policy. Raise before go-live. |
| Credentials used during setup should be rotated | **Still open — an operational task.** Rotate `visl_app` and the bootstrap admin before go-live. `.env.example` documents the `#`-truncation trap that made this painful. |
| `ecosystem.config.js` points at `/home/esl/ESL_PMO_OFFICE` | Fixed. Resolves `cwd` at load time via `__dirname` rather than hardcoding a path. |

---

## Carried forward from sections 1–9

Environment lessons that cost time in the ESL setup, now written into the
scripts and configuration rather than left in a document:

| Handover note | Where it lives now |
|---|---|
| 1.3(b)/(e) — dotenv truncates at `#` | Warning block at the top of `.env.example`, repeated in [01 · Setup](01-SETUP.md) |
| 1.3(a) — error 916, connecting to `master` | `migrate.js` refuses to run unless `DB_NAME()` matches; setup doc covers the SSMS fix |
| 1.3(c) — empty `sys.tables`, wrong DB context | Same check; `sql/04_verify.sql` prints `DB_NAME()` first |
| 1.3(d) — seed aborted on a missing CSV, leaving no admin | Admin password is set **first and independently**; a bad CSV cannot lock you out |
| 1.1 — serverless auto-pause, 30–60s first query | Timeouts raised to 90s; documented; noted in the PM2 config |
| 2 — missing view ⇒ empty pages and HTTP 500 | `sql/04_verify.sql` section 1 checks every required object |
| 4 — department name collision across BUs | Names are BU-qualified by design; documented in [03 · Data model](03-DATA-MODEL.md) |
| 5 — leaf-only rule | Enforced in `hierarchy.js`, in the API, and by a `CHECK` constraint |
| 6 — synthetic data tagged `[SYNTHETIC]` | Same convention; `sql/99_reset_synthetic.sql` clears it |
| 8 — fan-out defect | Separate CTEs; reconciliation gate on every run |
| 9(b) — negative variance is timing, not failure | Computed and stated as a sentence on the executive board |
| 12 — CSP blocks inline script; no CDN on a plant network | Same CSP; everything bundled from `node_modules` |

---

## Still open, and owned elsewhere

1. **Genuine savings plans** for ESL, IOB and FACOR (PMO teams).
2. **Approval policy decision** — 13.6(b) (leadership).
3. **Cross-unit visibility decision** — 13.6(c) (leadership).
4. **AD topology confirmation** — 13.4 (AD team).
5. **Dedicated database server** — 13.7 (infrastructure).
6. **Credential rotation** before go-live (operations).
