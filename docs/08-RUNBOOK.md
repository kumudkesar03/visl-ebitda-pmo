# 08 · Runbook

---

## The monthly cycle

The rhythm the application is built around. Dates assume a close in the first
week; adjust to your own calendar.

| When | Who | What |
|---|---|---|
| 1st | PMO | Set **System → Reporting calendar → Collection month** to the month just ended |
| 1st | System | Submission reminders go out (or run them from Mail outbox) |
| 1st–7th | Owners | Enter actuals on **My work**, submit for approval |
| 5th–10th | PMO | Work the **Approvals** queue. Approve, or return with a reason |
| 10th | PMO | Chase anything still unsubmitted — the count is on the dashboard |
| 10th | PMO | Move **Closed through** forward to that month. *This is the act that publishes the month.* |
| 10th | PMO | `npm run check:metrics`; in SQL, `sql/04_verify.sql` |
| 11th | Leadership | Executive board reflects the closed month. Print the board pack |

> **Move `closed_through` only when the month is genuinely settled.** It is the
> switch that moves plan-to-date, banked-to-date and achievement. Moving it early
> publishes an incomplete month as if it were final.

---

## Year end

1. Close the final month as above.
2. Export the year — **Dashboard → Export** per unit — and archive.
3. Set `reporting.fy_start` and `reporting.fy_label` to the new year.
4. Set `closed_through` to the month before the new year starts.
5. Load the new savings plans: `npm run seed -- --plan … --bu …`
6. Run `npm run check:metrics` and `sql/04_verify.sql`.

Prior-year data is not deleted; initiatives carry their own dates.

---

## Before any leadership review

- [ ] Open the application **15 minutes early** if the database is on a
      serverless tier — the first query after idle takes 30–60 seconds.
- [ ] Confirm `closed_through` is the month you intend to present.
- [ ] Work the approvals queue to zero, or be ready to explain the pipeline
      figure — it is on the board as *Awaiting approval*.
- [ ] `npm run check:metrics` → 0 failures.
- [ ] Read the executive board's timing sentence and check it says what you
      expect for this point in the year.
- [ ] If running on synthetic data, **say so** — the banner is on every screen,
      but say it anyway.

---

## Backups

The database is the system of record; back it up per corporate policy. On Azure
SQL, confirm point-in-time retention matches your actual requirement rather than
the default.

Also worth keeping: `var/outbox/` if mail is being treated as an audit artefact,
and `.env` in your secrets store — **never in git**.

`var/state.json` is synthetic-mode scratch. It does not need backing up and
should not exist on a production host.

---

## Common failures

**Everything reads zero.**
Check the reporting calendar. If `closed_through` sits before the first month
with approved actuals, plan-to-date and banked-to-date are legitimately zero.

**A unit looks too high; a parent does not equal the sum of its children.**
Run `npm run check:metrics` and `sql/04_verify.sql` section 4. Then check
section 3 — an initiative attached to a roll-up node double counts at every
level above it.

**Pages render empty and `/api/initiatives` returns 500.**
A view is missing. `SELECT name FROM sys.views WHERE name LIKE 'vw_%'` should
return six. Re-run `sql/03_views.sql`.

**"Login failed" from the application but the same credentials work in SSMS.**
Almost always the `#` truncation in `.env`. Reset the secret to letters, digits,
hyphen and underscore.

**Error 916, cannot access `master`.**
The connection did not name a database. See [01 · Setup](01-SETUP.md).

**A PMO lead says the approvals queue is missing rows.**
Check `approval.mode`. Under `central`, IOK's actuals go to **IOB** PMO, not IOK
PMO. Those rows are visible to them greyed, with the reason stated.

**Someone cannot see a business unit they expect to.**
**Administration → Users & roles** shows a concrete *Sees* column per account.
Visibility is home unit plus descendants; change the home unit or the role.

**First request of the morning is very slow.**
Serverless auto-pause. Expected. Accept it, or move to a provisioned tier.

---

## Health checks

```bash
curl -s http://localhost:4010/api/health
# {"ok":true,"dataMode":"mssql","mailMode":"outbox","node":"v22.x"}

npm run check:metrics
pm2 status
pm2 logs visl-ebitda-pmo --lines 100
```

---

## Deploying a change

```bash
git pull
npm ci
npm run build
npm run check:metrics
npx tsc -p web/tsconfig.json --noEmit
pm2 reload visl-ebitda-pmo
```

If the change touched `sql/`, apply it and re-run `sql/04_verify.sql`.

If it touched `src/domain/metrics.js` or any view, **`check:metrics` is not
optional** — that module and those views are the reason the numbers can be
trusted.
