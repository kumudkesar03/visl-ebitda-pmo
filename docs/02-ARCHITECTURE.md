# 02 · Architecture

```
Browser ── React 18 + TypeScript (Vite) ── built into public/
   │
   │  same-origin JSON over /api, session in an httpOnly cookie
   ▼
Express (server.js)
   │  helmet CSP, rate-limited sign-in, morgan
   ├── middleware/auth.js     verifies session, RESOLVES BU SCOPE ONCE
   ├── routes/*               thin: authorise, delegate, shape the response
   ├── domain/                hierarchy · rbac · metrics   (no I/O, pure logic)
   ├── services/              mailer · notifications
   └── data/index.js          ── DATA_MODE ──┬── synthetic/repo.js  (in memory)
                                             └── mssql/repo.js      (Azure SQL)
```

---

## The one idea worth understanding

**The route layer never learns which repository it is talking to.**

`src/data/index.js` picks an implementation from `DATA_MODE` and re-exports it.
`synthetic/repo.js` and `mssql/repo.js` export exactly the same 34 names. That
is what allowed the whole application — every screen, the approval workflow, the
mail — to be built, reviewed and signed off before the database existed, and to
be switched over by changing one line in `.env`.

It is also a permanent testing property, not a scaffold to be thrown away: the
synthetic mode is deterministic, so the reconciliation gate has a fixed dataset
to assert against on every CI run.

**If you add a method to one repository you must add it to the other.** This
one-liner proves they match:

```bash
node -e "const a=Object.keys(require('./src/data/synthetic/repo')).sort(),
         b=Object.keys(require('./src/data/mssql/repo')).sort();
         console.log(JSON.stringify(a)===JSON.stringify(b)?'EXACT':'MISMATCH')"
```

---

## Where the logic lives

`src/domain/` is pure: no database, no HTTP, no framework. It is where the rules
that must never differ between the two data modes are kept.

| Module | Owns |
|---|---|
| `hierarchy.js` | The VISL tree, descendants, leaves, the leaf-only rule |
| `rbac.js` | Roles, permissions, BU scope, approval authority |
| `metrics.js` | **Every savings formula.** Rounding boundary. Reporting window. |

Because it is pure it is trivially testable, and because both repositories
import the same `metrics.js`, synthetic and live figures cannot drift apart.

The SQL views in `sql/03_views.sql` compute the same aggregates for reporting
tools that talk to the database directly. `sql/04_verify.sql` is their twin of
`npm run check:metrics`.

---

## Request path, end to end

Booking and approving a month:

```
Owner → PUT /api/initiatives/12/actuals/2026-08-01  {actual_cr, action:'submit'}
          ├ requireAuth              → req.user, req.scope, req.writeScope
          ├ canBookActual()          → owner of this initiative, in write scope?
          ├ repo.saveActual()        → status 'submitted', submitted_by, audit row
          └ notify.onActualSubmitted() (fire and forget)
                ├ approversFor(bu, policy)  → who holds authority
                ├ repo.pushNotification()   → in-app bell
                └ mailer.send()             → outbox or SMTP

PMO   → POST /api/approvals/482/approve
          ├ requirePermission('actual:approve')
          ├ rbac.canApprove(user, bu, policy)   → authority over the deciding node
          ├ rbac.isSelfApproval()               → refuse own submission
          ├ repo.decideActual()                 → 'approved', approver, audit row
          └ notify.onActualDecided()            → owner told, in-app and by mail
```

The mail is deliberately fire-and-forget: the approval is already recorded, and
a mail server outage must never roll it back.

---

## Client

Two entry points, not one SPA: `login.html` (unauthenticated, carries the
corporate identity) and `app.html` (the authenticated shell).

- **@tanstack/react-query** for server state. `refetchOnWindowFocus` is **off** —
  financial figures must not silently change under someone mid-sentence in a
  review. Mutations invalidate explicitly.
- **Navigation is built from permissions**, the same strings the API enforces,
  so the sidebar and the API cannot disagree about what a role may do.
- **Chart.js**, registered piecewise so the bundle carries only the controllers
  actually used.
- No icon font, no CSS framework, no CDN.

### Content Security Policy

`script-src 'self'`, no inline script, nothing loaded from a CDN. A plant
network cannot be assumed to reach the public internet, and a dashboard that
renders blank because cdnjs is unreachable is worse than one that was never
built. Every dependency is bundled from `node_modules`.

The one relaxation is the mail preview: `frame-ancestors 'self'` scoped to that
single response so the outbox can show a message exactly as its recipient will
see it. That response gets a *tighter* policy than the app in every other
respect — `default-src 'none'`, no script at all.

---

## What runs on a schedule

Nothing, by default. `MAIL_CRON_ENABLED=false` ships off, because a scheduler
that starts sending on first boot is how a test deployment mails four hundred
employees at 07:00. Both jobs can be run on demand from the Mail outbox screen.

| Job | Default | Does |
|---|---|---|
| Submission reminders | `0 9 * * *` | One mail per owner listing everything outstanding for the collection month |
| Leadership digest | `0 7 * * 1` | Weekly position, scoped to each recipient's own visibility |
