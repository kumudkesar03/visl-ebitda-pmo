/* =====================================================================
   VISL EBITDA Drive PMO - reference data
   ---------------------------------------------------------------------
   Business unit hierarchy, EBITDA levers and the default settings.
   Idempotent: safe to re-run. Contains NO business figures.
   ===================================================================== */

SET NOCOUNT ON;

/* ---------------------------------------------------------------------
   BUSINESS UNITS

       VISL  (consolidated)
         +-- ESL                     leaf
         +-- IOB  (consolidated)
         |     +-- IOK               leaf
         |     +-- IOG               leaf
         |     +-- VAB               leaf
         |     +-- HO                leaf
         +-- FACOR                   leaf

   ESL or FACOR can gain sub-units later by inserting children and setting
   is_consolidated = 1 on the parent. No other change is needed: the views
   expand the tree recursively and the application reads it as data.
   --------------------------------------------------------------------- */

MERGE dbo.business_units AS t
USING (VALUES
    ('VISL',  N'Vedanta Iron & Steel',      N'VISL',  NULL,    1, '#0b3d6e', 10),
    ('ESL',   N'ESL Steel Limited',         N'ESL',   'VISL',  0, '#0062ae', 20),
    ('IOB',   N'Iron Ore Business',         N'IOB',   'VISL',  1, '#4d8f2a', 30),
    ('IOK',   N'Iron Ore Karnataka',        N'IOK',   'IOB',   0, '#1f8a7a', 40),
    ('IOG',   N'Iron Ore Goa',              N'IOG',   'IOB',   0, '#6a55a8', 50),
    ('VAB',   N'Value Added Business',      N'VAB',   'IOB',   0, '#b7791f', 60),
    ('HO',    N'IOB Head Office',           N'HO',    'IOB',   0, '#6b7178', 70),
    ('FACOR', N'Ferro Alloys Corporation',  N'FACOR', 'VISL',  0, '#b4452f', 80)
) AS s (code, name, short_name, parent_code, is_consolidated, accent, sort_order)
ON t.code = s.code
WHEN MATCHED THEN UPDATE SET
    t.name = s.name, t.short_name = s.short_name,
    t.is_consolidated = s.is_consolidated, t.accent = s.accent, t.sort_order = s.sort_order
WHEN NOT MATCHED THEN
    INSERT (code, name, short_name, is_consolidated, accent, sort_order)
    VALUES (s.code, s.name, s.short_name, s.is_consolidated, s.accent, s.sort_order);
GO

/* Parents are resolved in a second pass so insert order does not matter. */
UPDATE c SET parent_id = p.id
FROM dbo.business_units c
JOIN (VALUES
    ('ESL','VISL'), ('IOB','VISL'), ('FACOR','VISL'),
    ('IOK','IOB'), ('IOG','IOB'), ('VAB','IOB'), ('HO','IOB')
) AS m(child, parent) ON m.child = c.code
JOIN dbo.business_units p ON p.code = m.parent;
GO

/* ---------------------------------------------------------------------
   EBITDA LEVERS
   --------------------------------------------------------------------- */

MERGE dbo.categories AS t
USING (VALUES
    ('RAW', N'Raw material & sourcing', '#0062ae', 10),
    ('ENE', N'Energy & fuel',           '#d08a1c', 20),
    ('LOG', N'Logistics & freight',     '#4d8f2a', 30),
    ('YLD', N'Yield & recovery',        '#6a55a8', 40),
    ('CON', N'Contracts & manpower',    '#1f8a7a', 50),
    ('SPR', N'Stores & spares',         '#b4452f', 60),
    ('WCP', N'Working capital',         '#8a9a1e', 70),
    ('SLS', N'Sales realisation',       '#b0487a', 80),
    ('OVH', N'Overheads & admin',       '#5f6b76', 90),
    ('DIG', N'Digital & automation',    '#2c4f9e', 100)
) AS s (code, name, accent, sort_order)
ON t.code = s.code
WHEN MATCHED THEN UPDATE SET t.name = s.name, t.accent = s.accent, t.sort_order = s.sort_order
WHEN NOT MATCHED THEN INSERT (code, name, accent, sort_order) VALUES (s.code, s.name, s.accent, s.sort_order);
GO

/* ---------------------------------------------------------------------
   SETTINGS
   ---------------------------------------------------------------------
   reporting.closed_through and reporting.submission_period are the two
   most important rows in this table. They are DIFFERENT months on purpose:

     closed_through    - last month settled for reporting. Drives
                         plan-to-date, banked-to-date and achievement.
     submission_period - the month owners are entering now.

   On 10 September a drive reports July closed while August is still being
   collected. Setting them to the same month makes every dashboard
   understate delivery for the first fortnight of every month.

   approval.mode answers the open governance question in the handover
   (text.txt 13.6b) - see docs/04-ACCESS-CONTROL.md.
   --------------------------------------------------------------------- */

MERGE dbo.settings AS t
USING (VALUES
    ('reporting.fy_label',              N'FY 2026-27'),
    ('reporting.fy_start',              N'2026-04-01'),
    ('reporting.closed_through',        N'2026-07-01'),
    ('reporting.submission_period',     N'2026-08-01'),
    ('approval.mode',                   N'central'),
    ('approval.self_approval_allowed',  N'false'),
    ('display.currency',                N'INR_CR'),
    ('display.default_basis',           N'plan_to_date'),
    ('mail.digest_enabled',             N'true'),
    ('mail.reminder_day',               N'5'),
    ('dataset.kind',                    N'live')
) AS s (skey, svalue)
ON t.skey = s.skey
/* Existing values are NOT overwritten - re-running this script must never
   silently move a live reporting calendar back to the shipped default. */
WHEN NOT MATCHED THEN INSERT (skey, svalue) VALUES (s.skey, s.svalue);
GO

/* ---------------------------------------------------------------------
   BOOTSTRAP ADMINISTRATOR
   ---------------------------------------------------------------------
   Created without a password. Set one with:
       npm run seed -- --admin <employee_id> --password "<value>"
   which writes a bcrypt hash. Never store a plaintext password here.

   text.txt 1.3(b)/(e): dotenv truncates unquoted values at '#'. Keep
   passwords in .env to letters, digits, hyphen and underscore.
   --------------------------------------------------------------------- */

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE role = 'admin')
INSERT INTO dbo.users (employee_id, name, email, role, home_business_unit_id, designation, ad_user, is_active)
SELECT N'pmo.admin', N'PMO Administrator', N'pmo.admin@vedanta.co.in', 'admin', b.id, N'System Administrator', 0, 1
FROM dbo.business_units b WHERE b.code = 'VISL';
GO

PRINT 'Reference data applied.';
SELECT b.code, b.name, p.code AS parent, b.is_consolidated
FROM dbo.business_units b LEFT JOIN dbo.business_units p ON p.id = b.parent_id
ORDER BY b.sort_order;
GO
