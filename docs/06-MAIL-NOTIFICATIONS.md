# 06 · Mail and notifications

---

## Outbox mode is the default, and it is the point

With `SMTP_ENABLED=false` — the shipped default — every message the system would
send is **rendered in full and written to `var/outbox`**, and nothing is
delivered.

The **Mail outbox** screen reads that directory, so the complete notification
design — who gets what, when, and exactly what it says — can be read and signed
off by the business before a single mail reaches an employee's inbox.

The ESL handover set `SMTP_ENABLED=false` to prevent mail reaching real staff.
Here that is not a mute switch, it is a review mode: you can run both scheduled
jobs on demand from the screen, generate the full set of messages, and read them.

Turning it on is one line, and nothing else changes:

```ini
SMTP_ENABLED=true
```

---

## Who is told what

One module decides recipients — `src/services/notifications.js` — so the answer
cannot drift between the in-app bell and the mail. Both are raised together.

| Event | In-app | Mail template | To |
|---|:-:|---|---|
| Actual submitted | ● | `actual_submitted` | Everyone holding approval authority for that unit under the active policy |
| Actual approved | ● | `actual_approved` | The initiative owner |
| Actual returned | ● | `actual_returned` | The initiative owner, **with the reason** |
| Monthly window open | ● | `submission_reminder` | Each owner with an unsubmitted month — **one mail per owner**, listing everything outstanding |
| Weekly position | | `exec_digest` | Leadership and PMO, **scoped to each recipient's own visibility** |
| Milestone due | ● | `milestone_due` | The initiative owner |

Two deliberate choices:

- **One reminder per owner, not per initiative.** An owner with five outstanding
  months gets one mail listing five rows. Five separate mails is how people start
  filtering the sender.
- **The digest is scoped per recipient.** An IOK PMO lead's digest contains IOK,
  not VISL. It is generated through the same `readScope()` the API uses, so a
  mail cannot show someone figures the application would refuse them.

Notifications are **best-effort**. A mail server outage must never roll back an
approval that has already been recorded; failures are logged and swallowed.

If the configured approval authority has no active PMO account, submissions
escalate to VISL PMO rather than sitting in a queue nobody owns.

---

## Design of the messages

Table-based layout with inline styles, because Outlook on the corporate desktop
is the reader and it ignores most of a stylesheet. Navy header carrying the
Vedanta Iron & Steel identity, figures in a key–value table, one call to action.

Every message that carries a savings figure also carries the sentence that stops
the wrong argument:

> Achievement is measured against plan for closed months only. Target delivered
> is measured against the full-year commitment. The two are different questions
> and will not agree.

And in the footer:

> Figures shown are as recorded in the system at the time of sending and are
> subject to PMO approval.

---

## Scheduling

**Off by default.** `MAIL_CRON_ENABLED=false`. A scheduler that starts sending on
first boot is how a test deployment mails four hundred employees at 07:00.

```ini
MAIL_CRON_ENABLED=true
MAIL_REMINDER_CRON=0 9 * * *     # daily 09:00 - submission reminders
MAIL_DIGEST_CRON=0 7 * * 1       # Monday 07:00 - leadership digest
```

Enable only after the outbox has been reviewed and the recipient list confirmed.
Both jobs can be run on demand at any time from **Administration → Mail outbox**,
which is how you populate the outbox for a review.

---

## Go-live checklist

1. Run both jobs from the Mail outbox screen.
2. Read every template through **Preview** — it renders exactly as the recipient
   will see it.
3. Confirm the recipient lists, especially the digest: check that a BU PMO lead
   sees only their own units.
4. Confirm `MAIL_FROM` is a monitored no-reply address.
5. Set `SMTP_ENABLED=true`, restart, and send one reminder to yourself first.
6. Only then set `MAIL_CRON_ENABLED=true`.

---

## Adding a template

1. Add it to `templates` in `src/services/mailer.js`, returning `{subject, html}`
   and composing with the shared `shell()` so it inherits the identity.
2. Raise it from `src/services/notifications.js` alongside the in-app
   notification for the same event — never one without the other.
3. Generate one and read it in the outbox before wiring it to a trigger.
