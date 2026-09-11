/* =====================================================================
   VISL EBITDA Drive PMO - schema
   Target: Azure SQL Database (also runs on SQL Server 2019+)
   Idempotent: safe to run repeatedly. Batches separated by GO.
   ---------------------------------------------------------------------
   RUN THIS AGAINST THE APPLICATION DATABASE, NOT master.
   Confirm before you start:   SELECT DB_NAME();

   Azure SQL notes carried forward from the ESL handover (text.txt s.1):
     - USE <database> is not supported. Set the database in the connection.
     - CREATE DATABASE needs Azure syntax (EDITION / SERVICE_OBJECTIVE) and
       is therefore NOT in this script - see docs/01-SETUP.md.
     - Serverless tiers auto-pause. The first query after idle takes 30-60s.
   ===================================================================== */

/* ---------------------------------------------------------------------
   BUSINESS UNITS - the dimension everything else hangs from
   ---------------------------------------------------------------------
   Self-referencing hierarchy. is_consolidated marks a roll-up node.

   GOVERNING RULE: initiatives attach ONLY to leaf nodes. Consolidated
   nodes never hold rows directly, so every level is the exact arithmetic
   sum of its descendants and no figure can be double counted. The rule is
   enforced by ck_initiatives_leaf_only below AND in application code.
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.business_units', 'U') IS NULL
CREATE TABLE dbo.business_units (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    code            NVARCHAR(20)  NOT NULL UNIQUE,
    name            NVARCHAR(150) NOT NULL,
    short_name      NVARCHAR(40)  NULL,
    parent_id       INT NULL REFERENCES dbo.business_units(id),
    is_consolidated BIT NOT NULL DEFAULT 0,
    accent          NVARCHAR(20)  NULL,
    sort_order      INT NOT NULL DEFAULT 100,
    is_active       BIT NOT NULL DEFAULT 1,
    created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* ---------------------------------------------------------------------
   DEPARTMENTS
   ---------------------------------------------------------------------
   name is UNIQUE across the whole estate, which is why department names
   are BU-qualified ("Commercial (IOK)"). text.txt s.4 records the load
   failure caused by IOB's "Commercial" colliding with ESL's.
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.departments', 'U') IS NULL
CREATE TABLE dbo.departments (
    id               INT IDENTITY(1,1) PRIMARY KEY,
    name             NVARCHAR(150) NOT NULL UNIQUE,
    code             NVARCHAR(30)  NULL UNIQUE,
    business_unit_id INT NOT NULL REFERENCES dbo.business_units(id),
    sort_order       INT NOT NULL DEFAULT 100,
    is_active        BIT NOT NULL DEFAULT 1,
    created_at       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* ---------------------------------------------------------------------
   USERS
   ---------------------------------------------------------------------
   home_business_unit_id plus role is the whole access model. A user sees
   their home unit and every descendant of it; global roles see all.
   See docs/04-ACCESS-CONTROL.md and src/domain/rbac.js - the two must
   agree, and the role CHECK constraint below is the contract.
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.users', 'U') IS NULL
CREATE TABLE dbo.users (
    id                    INT IDENTITY(1,1) PRIMARY KEY,
    employee_id           NVARCHAR(120) NOT NULL UNIQUE,  -- sAMAccountName for AD users
    name                  NVARCHAR(200) NOT NULL,
    email                 NVARCHAR(200) NULL,
    role                  NVARCHAR(20)  NOT NULL DEFAULT 'viewer',
    home_business_unit_id INT NULL REFERENCES dbo.business_units(id),
    designation           NVARCHAR(150) NULL,
    phone                 NVARCHAR(60)  NULL,
    ad_user               BIT NOT NULL DEFAULT 0,
    password_hash         NVARCHAR(255) NULL,             -- local accounts only
    is_active             BIT NOT NULL DEFAULT 1,
    last_login            DATETIME2 NULL,
    created_at            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ck_users_role CHECK (role IN
        ('admin','visl_pmo','visl_exec','bu_pmo','owner','contributor','viewer'))
);
GO

/* Maps free-text owner names arriving from a savings-plan CSV onto real
   accounts, so one mapping fixes every initiative that name owns. */
IF OBJECT_ID('dbo.owner_aliases', 'U') IS NULL
CREATE TABLE dbo.owner_aliases (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    raw_name   NVARCHAR(200) NOT NULL UNIQUE,
    user_id    INT NULL REFERENCES dbo.users(id),
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* ---------------------------------------------------------------------
   CATEGORIES - the EBITDA levers
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.categories', 'U') IS NULL
CREATE TABLE dbo.categories (
    code       NVARCHAR(10)  NOT NULL PRIMARY KEY,
    name       NVARCHAR(120) NOT NULL,
    accent     NVARCHAR(20)  NULL,
    sort_order INT NOT NULL DEFAULT 100
);
GO

/* ---------------------------------------------------------------------
   INITIATIVES
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.initiatives', 'U') IS NULL
CREATE TABLE dbo.initiatives (
    id                INT IDENTITY(1,1) PRIMARY KEY,
    code              NVARCHAR(30)  NOT NULL UNIQUE,
    title             NVARCHAR(500) NOT NULL,
    description       NVARCHAR(MAX) NULL,
    business_unit_id  INT NOT NULL REFERENCES dbo.business_units(id),
    department_id     INT NULL REFERENCES dbo.departments(id),
    owner_id          INT NULL REFERENCES dbo.users(id),
    owner_name_raw    NVARCHAR(200) NULL,
    category_code     NVARCHAR(10)  NULL REFERENCES dbo.categories(code),
    status            NVARCHAR(20)  NOT NULL DEFAULT 'not_started',
    priority          NVARCHAR(20)  NOT NULL DEFAULT 'medium',
    health            NVARCHAR(20)  NOT NULL DEFAULT 'green',
    progress_pct      DECIMAL(5,2)  NOT NULL DEFAULT 0,
    target_savings_cr DECIMAL(18,4) NOT NULL DEFAULT 0,
    start_date        DATE NULL,
    due_date          DATE NULL,
    is_active         BIT NOT NULL DEFAULT 1,
    created_by        INT NULL REFERENCES dbo.users(id),
    updated_by        INT NULL REFERENCES dbo.users(id),
    created_at        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ck_init_status   CHECK (status   IN ('not_started','in_progress','at_risk','on_hold','completed','cancelled')),
    CONSTRAINT ck_init_priority CHECK (priority IN ('low','medium','high','critical')),
    CONSTRAINT ck_init_health   CHECK (health   IN ('green','amber','red'))
);
GO

/* The leaf-only rule, enforced by the database rather than trusted.
   A row on a consolidated node would silently double count at every level
   above it, and the error would surface as an unexplained variance in a
   board pack rather than as a failed insert. */
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'fn_bu_is_leaf')
    EXEC('CREATE FUNCTION dbo.fn_bu_is_leaf(@id INT) RETURNS BIT AS
          BEGIN
            DECLARE @c BIT;
            SELECT @c = is_consolidated FROM dbo.business_units WHERE id = @id;
            RETURN CASE WHEN @c = 0 THEN 1 ELSE 0 END;
          END');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_initiatives_leaf_only')
    ALTER TABLE dbo.initiatives WITH NOCHECK
        ADD CONSTRAINT ck_initiatives_leaf_only
        CHECK (dbo.fn_bu_is_leaf(business_unit_id) = 1);
GO

/* ---------------------------------------------------------------------
   INITIATIVE MONTHS - the plan and actual grid
   ---------------------------------------------------------------------
   One row per initiative per month. period is always the 1st.

   actual_status drives the whole governance model:
     draft     - the owner's working figure, counts for nothing
     submitted - in the approval queue, reported as pipeline
     approved  - BANKED. This is the only status that counts as a saving.
     rejected  - returned to the owner with a reason
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.initiative_months', 'U') IS NULL
CREATE TABLE dbo.initiative_months (
    id             INT IDENTITY(1,1) PRIMARY KEY,
    initiative_id  INT NOT NULL REFERENCES dbo.initiatives(id) ON DELETE CASCADE,
    period         DATE NOT NULL,
    plan_cr        DECIMAL(18,4) NOT NULL DEFAULT 0,
    actual_cr      DECIMAL(18,4) NULL,
    actual_status  NVARCHAR(20)  NOT NULL DEFAULT 'draft',
    remarks        NVARCHAR(MAX) NULL,
    submitted_by   INT NULL REFERENCES dbo.users(id),
    submitted_at   DATETIME2 NULL,
    approved_by    INT NULL REFERENCES dbo.users(id),
    approved_at    DATETIME2 NULL,
    rejection_note NVARCHAR(1000) NULL,
    updated_at     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_initiative_period UNIQUE (initiative_id, period),
    CONSTRAINT ck_actual_status CHECK (actual_status IN ('draft','submitted','approved','rejected')),
    /* An approved row must record who approved it and when. Without this an
       approval can exist with no accountable name against it, which is the
       one thing an audit of a savings figure will always ask for. */
    CONSTRAINT ck_approved_has_approver CHECK (
        actual_status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
GO

/* ---------------------------------------------------------------------
   DELIVERY: tasks, milestones, risks
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.tasks', 'U') IS NULL
CREATE TABLE dbo.tasks (
    id                   INT IDENTITY(1,1) PRIMARY KEY,
    initiative_id        INT NOT NULL REFERENCES dbo.initiatives(id) ON DELETE CASCADE,
    code                 NVARCHAR(40) NULL,
    title                NVARCHAR(500) NOT NULL,
    description          NVARCHAR(MAX) NULL,
    assignee_id          INT NULL REFERENCES dbo.users(id),
    status               NVARCHAR(20) NOT NULL DEFAULT 'todo',
    priority             NVARCHAR(20) NOT NULL DEFAULT 'medium',
    weight               DECIMAL(6,2)  NOT NULL DEFAULT 1,
    progress_pct         DECIMAL(5,2)  NOT NULL DEFAULT 0,
    planned_start        DATE NULL,
    planned_end          DATE NULL,
    actual_start         DATE NULL,
    actual_end           DATE NULL,
    estimated_savings_cr DECIMAL(18,4) NOT NULL DEFAULT 0,
    created_by           INT NULL REFERENCES dbo.users(id),
    created_at           DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at           DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ck_task_status   CHECK (status   IN ('todo','in_progress','blocked','review','done','cancelled')),
    CONSTRAINT ck_task_priority CHECK (priority IN ('low','medium','high','critical'))
);
GO

IF OBJECT_ID('dbo.milestones', 'U') IS NULL
CREATE TABLE dbo.milestones (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    initiative_id INT NOT NULL REFERENCES dbo.initiatives(id) ON DELETE CASCADE,
    title         NVARCHAR(400) NOT NULL,
    due_date      DATE NULL,
    completed_at  DATE NULL,
    status        NVARCHAR(20) NOT NULL DEFAULT 'open',
    sort_order    INT NOT NULL DEFAULT 100,
    created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ck_ms_status CHECK (status IN ('open','achieved','missed','cancelled'))
);
GO

IF OBJECT_ID('dbo.risks', 'U') IS NULL
CREATE TABLE dbo.risks (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    initiative_id INT NOT NULL REFERENCES dbo.initiatives(id) ON DELETE CASCADE,
    title         NVARCHAR(400) NOT NULL,
    description   NVARCHAR(MAX) NULL,
    impact        NVARCHAR(20) NOT NULL DEFAULT 'medium',
    likelihood    NVARCHAR(20) NOT NULL DEFAULT 'medium',
    mitigation    NVARCHAR(MAX) NULL,
    owner_id      INT NULL REFERENCES dbo.users(id),
    status        NVARCHAR(20) NOT NULL DEFAULT 'open',
    due_date      DATE NULL,
    created_by    INT NULL REFERENCES dbo.users(id),
    created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ck_risk_impact     CHECK (impact     IN ('low','medium','high')),
    CONSTRAINT ck_risk_likelihood CHECK (likelihood IN ('low','medium','high')),
    CONSTRAINT ck_risk_status     CHECK (status     IN ('open','mitigating','closed','accepted'))
);
GO

/* ---------------------------------------------------------------------
   COLLABORATION AND GOVERNANCE
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.comments', 'U') IS NULL
CREATE TABLE dbo.comments (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    entity_type NVARCHAR(30) NOT NULL,   -- 'initiative' | 'task'
    entity_id   INT NOT NULL,
    user_id     INT NULL REFERENCES dbo.users(id),
    body        NVARCHAR(MAX) NOT NULL,
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID('dbo.audit_log', 'U') IS NULL
CREATE TABLE dbo.audit_log (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id     INT NULL,
    actor_name  NVARCHAR(200) NULL,
    action      NVARCHAR(80) NOT NULL,
    entity_type NVARCHAR(40) NULL,
    entity_id   INT NULL,
    details     NVARCHAR(MAX) NULL,
    ip          NVARCHAR(60) NULL,
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID('dbo.notifications', 'U') IS NULL
CREATE TABLE dbo.notifications (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES dbo.users(id),
    type       NVARCHAR(40) NOT NULL DEFAULT 'info',
    title      NVARCHAR(300) NOT NULL,
    body       NVARCHAR(MAX) NULL,
    link       NVARCHAR(400) NULL,
    is_read    BIT NOT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID('dbo.settings', 'U') IS NULL
CREATE TABLE dbo.settings (
    skey       NVARCHAR(80) NOT NULL PRIMARY KEY,
    svalue     NVARCHAR(MAX) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by INT NULL
);
GO

/* ---------------------------------------------------------------------
   INDEXES
   ---------------------------------------------------------------------
   NOTE (text.txt s.2): some export/import tools widen NVARCHAR columns to
   NVARCHAR(MAX), which SQL Server cannot index. If this script aborts
   part way, check for widened columns before re-running.
   --------------------------------------------------------------------- */

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_bu_parent')
    CREATE INDEX ix_bu_parent ON dbo.business_units(parent_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_dept_bu')
    CREATE INDEX ix_dept_bu ON dbo.departments(business_unit_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_users_bu')
    CREATE INDEX ix_users_bu ON dbo.users(home_business_unit_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_users_role')
    CREATE INDEX ix_users_role ON dbo.users(role);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_init_bu')
    CREATE INDEX ix_init_bu ON dbo.initiatives(business_unit_id) INCLUDE (target_savings_cr, status, health);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_init_owner')
    CREATE INDEX ix_init_owner ON dbo.initiatives(owner_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_init_dept')
    CREATE INDEX ix_init_dept ON dbo.initiatives(department_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_im_initiative')
    CREATE INDEX ix_im_initiative ON dbo.initiative_months(initiative_id) INCLUDE (period, plan_cr, actual_cr, actual_status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_im_period_status')
    CREATE INDEX ix_im_period_status ON dbo.initiative_months(period, actual_status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_tasks_initiative')
    CREATE INDEX ix_tasks_initiative ON dbo.tasks(initiative_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_tasks_assignee')
    CREATE INDEX ix_tasks_assignee ON dbo.tasks(assignee_id, status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_risks_initiative')
    CREATE INDEX ix_risks_initiative ON dbo.risks(initiative_id, status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_ms_initiative')
    CREATE INDEX ix_ms_initiative ON dbo.milestones(initiative_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_comments_entity')
    CREATE INDEX ix_comments_entity ON dbo.comments(entity_type, entity_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_notif_user')
    CREATE INDEX ix_notif_user ON dbo.notifications(user_id, is_read);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_audit_created')
    CREATE INDEX ix_audit_created ON dbo.audit_log(created_at DESC);
GO

PRINT 'Schema applied. Next: 02_reference_data.sql, then 03_views.sql';
GO
