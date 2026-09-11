# VISL EBITDA Drive PMO

Consolidated governance for the Vedanta Iron & Steel EBITDA cost-reduction drive,
across all three businesses and every reporting unit beneath them.

```
VISL  (consolidated)
  ├── ESL      ESL Steel Limited
  ├── IOB      Iron Ore Business  (consolidated)
  │     ├── IOK    Iron Ore Karnataka
  │     ├── IOG    Iron Ore Goa
  │     ├── VAB    Value Added Business
  │     └── HO     IOB Head Office
  └── FACOR    Ferro Alloys Corporation
```

It is a successor to the ESL PMO Tracker, not a port of it. The design brief
came from the implementation work log in that project (`text.txt`), and the
defects and open items recorded there are addressed here by construction rather
than by patch. Section 13 of that log — "Open items" — is the specification
this build was written against; see [`docs/07-HANDOVER-RESPONSE.md`](docs/07-HANDOVER-RESPONSE.md)
for the item-by-item answer.

---

## Run it now, without a database

The application ships with a complete, deterministic synthetic dataset: 48
initiatives across all six reporting units, a full twelve-month plan, four
closed months of approved actuals and a live approval queue. Every screen and
every workflow — including approvals and mail — works end to end with no
database at all.

```bash
npm install
npm run build
npm start
```

Open <http://localhost:4010/app>. The sign-in page lists design-review accounts;
the password for all of them is `demo1234`.

| Sign in as | Role | Sees |
|---|---|---|
| `visl.ceo` | Leadership | Everything, read-only |
| `visl.pmo1` | VISL PMO | Everything, full governance |
| `iob.pmo` | Business Unit PMO | IOK, IOG, VAB, HO |
| `esl.pmo` | Business Unit PMO | ESL only |
| `iok.own1` | Initiative Owner | IOK only, own initiatives |
| `esl.view1` | Viewer | ESL only, read-only |
| `kumud.kesar` | Administrator | Everything, plus user administration |

Signing in as each of these is the fastest way to review the access model —
it is the same model the API enforces, not a demonstration of one.

> **Every figure in synthetic mode is illustrative and is not reported business
> result.** The application says so on every screen while that mode is active.

---

## What it does

**Reporting for leadership.** An executive board built for a CEO or CFO with
ninety seconds before a review: where the full-year target stands, whether the
year will land, which units are behind and how concentrated the risk is. It
prints to a board pack.

**Delivery for the people doing the work.** Owners book their month in the
application, not in a spreadsheet — plan and actuals are both editable in place,
with the rules that make the numbers trustworthy enforced at the point of entry.

**Governance that holds.** Monthly actuals move draft → submitted → approved,
and *only approved figures count as savings*. Approval authority is scoped to
the business unit, a user can never approve their own submission, and every
decision lands in the audit trail with a name and a time against it.

**Access control that is real.** A user sees their home business unit and
everything beneath it. An ESL PMO user cannot read IOB initiatives, and cannot
approve IOB actuals. This is the defect recorded in section 13.1 of the ESL
handover, closed at the data layer rather than in each route.

**Mail intimations you can approve before they send.** With SMTP disabled — the
default — every message the system would send is rendered in full and held in a
reviewable outbox. Nothing reaches an employee until the business has read the
wording and switched SMTP on.

---

## Documentation

| | |
|---|---|
| [01 Setup](docs/01-SETUP.md) | Local run, Azure SQL deployment, the environment gotchas that cost time last round |
| [02 Architecture](docs/02-ARCHITECTURE.md) | How it fits together, and the repository contract that makes the database swappable |
| [03 Data model](docs/03-DATA-MODEL.md) | Tables, the leaf-only rule, and why department names are BU-qualified |
| [04 Access control](docs/04-ACCESS-CONTROL.md) | Roles, scope, the permission matrix and the approval policy |
| [05 Reporting & metrics](docs/05-REPORTING-METRICS.md) | Every formula, and how the 396.8% and fan-out defects are prevented |
| [06 Mail & notifications](docs/06-MAIL-NOTIFICATIONS.md) | Templates, triggers, outbox mode, scheduling |
| [07 Handover response](docs/07-HANDOVER-RESPONSE.md) | Point-by-point answer to section 13 of the ESL work log |
| [08 Runbook](docs/08-RUNBOOK.md) | Monthly cycle, year-end, backups, common failures |

---

## Project layout

```
server.js                 Express app, security headers, static client, scheduler
sql/                      Deploy in numeric order: 01 schema, 02 reference, 03 views, 04 verify
src/
  config/env.js           Every environment value, declared once
  domain/
    hierarchy.js          The VISL tree and the leaf-only rule
    rbac.js               Roles, permissions, scope, approval authority
    metrics.js            THE FORMULA LAYER - every savings figure comes from here
  data/
    index.js              Dispatcher: synthetic or mssql, chosen by DATA_MODE
    synthetic/            Deterministic in-memory dataset, fully writable
    mssql/                Azure SQL / SQL Server, same interface
  middleware/auth.js      Session, and where BU scope is resolved once per request
  routes/                 API
  services/               mailer, notifications
  scripts/reconcile.js    npm run check:metrics - the reconciliation gate
web/                      React + TypeScript client (Vite), built into public/
```

---

## Quality gates

```bash
npm run check:metrics    # every parent equals the sum of its children
npx tsc -p web/tsconfig.json --noEmit
npm run build
```

`check:metrics` is the one to run in CI. It asserts that no consolidated figure
double counts, that monthly plan foots to the full-year target at every node,
that no percentage was built from mismatched windows, and that every ratio
carries the basis it was measured on. Against the shipped dataset it runs 72
assertions. The SQL twin of the same checks is `sql/04_verify.sql`.

---

## Connecting the real database

One line in `.env`:

```ini
DATA_MODE=mssql
```

Then deploy `sql/01` → `sql/04` and load your savings plan. Nothing in the
application layer changes: the route code never learns which repository it is
talking to. Full instructions in [docs/01-SETUP.md](docs/01-SETUP.md).
