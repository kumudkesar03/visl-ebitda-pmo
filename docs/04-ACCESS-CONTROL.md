# 04 · Access control

> This document describes the model. The **live** model is rendered inside the
> application at **Administration → Access model**, read directly from the
> server's own grant table. If the two ever disagree, the application is right.

---

## The problem this solves

Section 13.1 of the ESL implementation log records the defect this replaces,
and it is worth quoting the shape of it exactly:

> Dashboard, Initiatives, Tasks, Approvals, Leaderboard, Departments, Savings
> matrix, Owner mapping and Reports all query without a business_unit_id filter.
> Any signed-in user currently sees all 33 initiatives across all six units.
>
> The most serious instance is APPROVALS: an ESL PMO user can approve IOB
> monthly actuals. That is a governance failure with an audit trail attached,
> not a cosmetic issue.

The root cause was that scope was left to each route to remember. Adding a
filter to nine routes fixes the nine routes and does nothing about the tenth.

**Here, scope is resolved once and applied at the data layer.**

```
middleware/auth.js  →  req.scope = rbac.readScope(user)   (once per request)
                       req.writeScope = rbac.writeScope(user)
        ↓
routes/*            →  repo.listInitiatives(req.scope, filters)
        ↓
data/*/repo.js      →  every query filters on that array
```

A repository call with no scope returns **nothing**, not everything. A route
that forgets produces an empty screen — which gets reported and fixed — rather
than another business unit's figures, which does not.

---

## Two dimensions, always applied together

| | |
|---|---|
| **Role** | *what kind of action* — may this person approve at all? |
| **BU scope** | *on which units* — may they approve **this** one? |

Neither is sufficient alone. A BU PMO holds the approve permission, but only
over their own units.

---

## Roles

| Role | Scope | For |
|---|---|---|
| `admin` | All | System administration, user management |
| `visl_pmo` | All | Central programme office. Full governance across the estate |
| `visl_exec` | All, **read-only** | CEO, CFO, business heads |
| `bu_pmo` | Home unit + descendants | Programme office for one business |
| `owner` | Home unit | Owns initiatives: plan, actuals, tasks, risks |
| `contributor` | Home unit | Works assigned tasks, comments |
| `viewer` | Home unit, **read-only** | Analysts, observers |

---

## How scope resolves

A user's visibility is **their home business unit and every descendant of it.**

| Home unit | Role | Sees |
|---|---|---|
| VISL | any global role | VISL, ESL, IOB, IOK, IOG, VAB, HO, FACOR |
| IOB | `bu_pmo` | IOB, IOK, IOG, VAB, HO |
| ESL | `bu_pmo` | ESL |
| IOK | `owner` | IOK |

**Write scope is read scope minus the roll-up nodes.** Consolidated nodes hold
no rows, so nothing can be written against VISL or IOB directly — the leaf-only
rule, enforced in `domain/hierarchy.js`, in the API, and by a `CHECK` constraint
in the database.

Verified behaviour, from a live run against the shipped dataset:

```
ESL PMO   GET /api/initiatives          → 12 rows, all ESL
ESL PMO   GET /api/initiatives?bu=IOK   → 403  "Your access does not extend to IOK."
IOB PMO   GET /api/initiatives          → 27 rows across IOK, IOG, VAB, HO
IOK owner GET /api/approvals            → 403  (no approve permission at all)
IOK owner GET /api/exec/board?bu=VISL   → 403  "Your access does not extend to VISL."
ESL viewer POST /api/initiatives        → 403
```

---

## Approval authority — a leadership decision, not a code path

Section 13.6(b) of the handover asks:

> Do IOK / VAB / IOG / HO approve their own monthly actuals, or does IOB PMO
> approve centrally?

That is not a technical question, and guessing at it would bake an assumption
into the schema. It is therefore a **setting**, changeable at
**System → Approval policy**, taking effect immediately with no migration.

| Mode | IOK actuals approved by | ESL actuals approved by |
|---|---|---|
| `local` | IOK PMO | ESL PMO |
| `central` *(shipped default)* | **IOB PMO** | VISL PMO |
| `visl` | VISL PMO | VISL PMO |

The application shows the active policy in the Approvals header, and rows
outside the signed-in user's authority are listed **greyed with the reason
stated** rather than hidden. Hiding them leaves a PMO lead wondering why their
queue count disagrees with the dashboard; showing them teaches the policy.

### Maker–checker

**A user can never approve an entry they submitted themselves** — any role,
administrators included. It is a separate check from the role grant, because it
is a different kind of rule. It can be disabled at
`approval.self_approval_allowed`, which is there for small units with one PMO
person, and is marked *not recommended* on the screen.

---

## Permission reference

Route guards use these strings, and so does the client's navigation — the
sidebar is built from the same permission list the API enforces, so the menu and
the API cannot drift apart.

| Permission | admin | visl_pmo | visl_exec | bu_pmo | owner | contributor | viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `initiative:view` | ● | ● | ● | ● | ● | ● | ● |
| `report:view` | ● | ● | ● | ● | ● | ● | ● |
| `exec:view` | ● | ● | ● | ● | ● | ● | ● |
| `report:export` | ● | ● | ● | ● | ● | | |
| `comment:write` | ● | ● | ● | ● | ● | ● | |
| `task:update:assigned` | ● | ● | | ● | ● | ● | |
| `initiative:edit:own` | ● | | | | ● | | |
| `plan:edit:own` | ● | | | | ● | | |
| `actual:submit:own` | ● | | | | ● | | |
| `task:manage:own` | ● | | | | ● | | |
| `risk:manage:own` | ● | | | | ● | | |
| `initiative:create` | ● | ● | | ● | | | |
| `initiative:edit:any` | ● | ● | | ● | | | |
| `plan:edit:any` | ● | ● | | ● | | | |
| `actual:submit:any` | ● | ● | | ● | | | |
| `actual:approve` | ● | ● | | ● | | | |
| `actual:reopen` | ● | ● | | ● | | | |
| `task:manage:any` | ● | ● | | ● | | | |
| `risk:manage:any` | ● | ● | | ● | | | |
| `masterdata:manage` | ● | ● | | ● | | | |
| `audit:view` | ● | ● | | ● | | | |
| `initiative:delete` | ● | ● | | | | | |
| `mail:manage` | ● | ● | | | | | |
| `user:manage` | ● | | | | | | |
| `settings:manage` | ● | | | | | | |

`:own` permissions apply only where the signed-in user is the initiative's
owner. `:any` applies across their whole write scope.

---

## What a locked month means

An **approved** month is locked. Its plan and its actual are a signed figure
that leadership has already been shown.

- The owner cannot edit it.
- The plan behind it cannot be changed — that would silently restate a variance
  already reported.
- A PMO user with `actual:reopen` can return it to draft. That is an explicit
  act with an audit entry, not an edit.

---

## Active Directory

`AUTH_MODE=local` is sufficient for development and for the review build.

Section 13.4 of the handover flags that ESL, IOB and FACOR appear to sit behind
**different directories** — the tenant shows a separate directory sync account
per business. The answer changes
the work materially, so `AD_DIRECTORIES` is **keyed by business unit code from
the start** rather than being a single flat block that would need restructuring
later:

```ini
AD_DIRECTORIES={"ESL":{"url":"ldaps://esl-dc:636","baseDN":"DC=esl,DC=local"}, "IOB":{...}}
```

Confirm the directory topology with the AD team before building this out. Role
and home business unit remain application-side regardless: AD answers *who you
are*, this system answers *what you may see*.

---

## Adding a business unit later

ESL or FACOR gaining sub-units is a data change, not a migration:

1. Insert the children in `business_units` with the parent set.
2. Set `is_consolidated = 1` on the parent.
3. Add the same rows to `UNITS` in `src/domain/hierarchy.js`.
4. Move the affected initiatives onto the new leaves.
5. Run `npm run check:metrics` and `sql/04_verify.sql`.

The views expand the tree recursively; the roll-up needs no change.
