# 01 · Setup

Two paths. Start with the first — it needs nothing but Node.

---

## A. Design review (no database)

```bash
npm install
npm run build
npm start
```

<http://localhost:4010/app> · password for every demo account: `demo1234`

The dataset is deterministic: the same figures appear on every restart, so a
screenshot taken today matches the live screen next week. Edits you make during
a review are real and persist to `var/state.json`; reset from **System →
Reset to generated baseline**, or delete that file.

For development with hot reload:

```bash
npm run dev        # API on :4010, Vite on :5173 with /api proxied
```

Work at <http://localhost:5173/app.html>.

---

## B. Company deployment (Azure SQL)

### 1. Create the database

`CREATE DATABASE` is **not** in the migration scripts. Azure SQL needs its own
syntax and the tier is a commercial decision, so it is a deliberate manual step.
In SSMS, connected to `master`:

```sql
CREATE DATABASE VISL_PMO
  (EDITION = 'GeneralPurpose', SERVICE_OBJECTIVE = 'GP_S_Gen5_2');
```

> **On tier choice.** `GP_S_Gen5_1` is serverless and auto-pauses when idle; the
> first query after a quiet period takes 30–60 seconds. That is survivable for a
> development database and painful for one that a CEO opens on a Monday morning.
> Either move to a provisioned tier for production, or accept it and open the
> application fifteen minutes before any review.

> **On placement.** The ESL database was hosted on a shared production BI server,
> alongside live production databases. A VISL-level application spanning
> three businesses should have its own server with its own backup and lifecycle
> policy. Raise this before go-live, not after.

### 2. Create the application login

The application must **not** connect as the server administrator. That account has rights
across every database on the server, including live production data that has
nothing to do with this system.

On `master`:

```sql
CREATE LOGIN visl_app WITH PASSWORD = 'UseALongValueWithoutHashOrDollar';
-- Grants nothing, but allows a connection that does not name a database.
-- Without this you will hit error 916.
CREATE USER visl_app FOR LOGIN visl_app;
```

On `VISL_PMO`:

```sql
CREATE USER visl_app FOR LOGIN visl_app;
ALTER ROLE db_owner ADD MEMBER visl_app;
```

### 3. Configure

```bash
cp .env.example .env
```

Set `DATA_MODE=mssql`, the `DB_*` values, and a real `JWT_SECRET`.

> **The password rule.** dotenv truncates an unquoted value at `#`. In the ESL
> deployment this silently shortened the database password and produced a login
> failure that looked like wrong credentials, then did the same thing to the
> bootstrap admin password. **Use only letters, digits, hyphen and underscore in
> every secret in `.env`.**

### 4. Deploy the schema

```bash
npm run migrate
```

The runner confirms it is connected to the right database before it writes
anything, splits each file on `GO` (SQL Server requires `CREATE VIEW` to be
first in its batch), and stops on the first error with the failing statement.

To run the scripts in SSMS instead, execute them in numeric order. Before you
start, confirm the session is on the right database — opening a `.sql` file
resets the context, which is how the ESL setup ended up querying `sys.tables` on
`master` and finding nothing:

```sql
SELECT DB_NAME();   -- must be VISL_PMO
```

| File | What it does |
|---|---|
| `sql/01_schema.sql` | Tables, constraints, indexes |
| `sql/02_reference_data.sql` | BU hierarchy, EBITDA levers, default settings, bootstrap admin |
| `sql/03_views.sql` | The consolidation views |
| `sql/04_verify.sql` | **Verification. Run it. Resolve every FAIL.** |
| `sql/99_reset_synthetic.sql` | Removes rows tagged `[SYNTHETIC]`. Never run by the migrator. |

### 5. Verify

```sql
-- In SSMS, against VISL_PMO
:r sql/04_verify.sql
```

It checks that every required object exists, that no initiative sits on a
roll-up node, that every parent equals the sum of its children, that plan foots
to target, and that no percentage was built from mismatched windows.

Then the application-side twin:

```bash
npm run check:metrics
```

### 6. Set the administrator password

```bash
npm run seed -- --admin pmo.admin --password "ALongValueWithoutHashOrDollar"
```

The password is stored as a bcrypt hash. This step is independent of any data
load: a bad CSV later cannot leave you locked out, which is what happened when
these were combined in one script.

### 7. Load the savings plan

```bash
npm run seed -- --plan ./savings-plan-IOK.csv --bu IOK
```

CSV needs a header row with `code, title, department, owner, category,
target_cr`, plus one column per month headed `Apr-26 … Mar-27`.

**Nothing is written until the whole file validates.** Every row's twelve months
must foot to its own `target_cr`. A plan that does not foot is the commonest
defect in a spreadsheet-sourced load and it surfaces later as an unexplained gap
on the executive board.

### 8. Run

```bash
npm run build
npm start
# or, under PM2:
pm2 start ecosystem.config.js --env production
pm2 save && pm2 startup
```

---

## Node version

`package.json` requires Node ≥ 18.18. The ESL host ran 18.20.4 and installed
several Azure packages with `EBADENGINE` warnings because they wanted v22+.
**Deploy on Node 20 LTS or 22 LTS** and clear those warnings before production.

```bash
node --version
```

---

## Reverse proxy

Serve over HTTPS and set `COOKIE_SECURE=true`. The application sets
`X-Forwarded-*`-aware `trust proxy`, so client IPs land correctly in the audit
trail.

```nginx
location / {
    proxy_pass         http://127.0.0.1:4010;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    # A cold serverless database can take a minute on the first request.
    proxy_read_timeout 120s;
}
```

---

## Troubleshooting

**Error 916 — "The server principal is not able to access the database 'master'".**
The login has a user in `VISL_PMO` but not in `master`, and something connected
without naming a database. In SSMS set *Options → Connection Properties →
Connect to database = VISL_PMO*. Or create the (permissionless) user on `master`
as in step 2.

**"Login failed" from the application, but the same credentials work in SSMS.**
Almost always the `#` truncation in `.env`. Reset the password to alphanumerics,
hyphens and underscores.

**Pages render empty, `/api/initiatives` returns 500.**
A view is missing — usually because `01_schema.sql` aborted part way. Some
export/import tools widen `NVARCHAR` columns to `NVARCHAR(MAX)`, which SQL
Server cannot index, and the script stops there.

```sql
SELECT name FROM sys.views WHERE name LIKE 'vw_%';
```

**First request of the day takes a minute.** Serverless auto-pause. Expected.

**Everything reads zero.** Check the reporting calendar under **System**.
If `closed_through` is before the first month with approved actuals, plan-to-date
and banked-to-date are both legitimately zero.
