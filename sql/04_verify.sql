/* =====================================================================
   VISL EBITDA Drive PMO - post-deployment verification
   ---------------------------------------------------------------------
   Run this after 01, 02 and 03, and again after ANY change to a view.
   It is the SQL twin of `npm run check:metrics`.

   Every section prints either OK or FAIL. Do not put the application in
   front of leadership with a FAIL outstanding.
   ===================================================================== */

SET NOCOUNT ON;
PRINT '=== VISL EBITDA Drive PMO - verification ===';
PRINT CONCAT('Database: ', DB_NAME(), '   User: ', SUSER_SNAME());
PRINT '';

/* ---------------------------------------------------------------------
   1. Objects present
   ---------------------------------------------------------------------
   text.txt s.2: if a view is missing the pages render empty and the API
   returns HTTP 500. Some export/import tools widen NVARCHAR columns to
   NVARCHAR(MAX), which cannot be indexed, aborting the schema part way.
   --------------------------------------------------------------------- */
PRINT '--- 1. Required objects ---';
;WITH required AS (
    SELECT 'business_units' AS name, 'U' AS type UNION ALL
    SELECT 'departments','U' UNION ALL SELECT 'users','U' UNION ALL
    SELECT 'categories','U' UNION ALL SELECT 'initiatives','U' UNION ALL
    SELECT 'initiative_months','U' UNION ALL SELECT 'tasks','U' UNION ALL
    SELECT 'milestones','U' UNION ALL SELECT 'risks','U' UNION ALL
    SELECT 'comments','U' UNION ALL SELECT 'audit_log','U' UNION ALL
    SELECT 'notifications','U' UNION ALL SELECT 'settings','U' UNION ALL
    SELECT 'owner_aliases','U' UNION ALL
    SELECT 'vw_bu_descendants','V' UNION ALL SELECT 'vw_bu_month_leaf','V' UNION ALL
    SELECT 'vw_bu_month','V' UNION ALL SELECT 'vw_visl_position','V' UNION ALL
    SELECT 'vw_initiative_rollup','V' UNION ALL SELECT 'vw_approval_queue','V'
)
SELECT
    r.name,
    r.type,
    CASE WHEN OBJECT_ID('dbo.' + r.name, r.type) IS NULL THEN 'FAIL - MISSING' ELSE 'OK' END AS status
FROM required r
ORDER BY CASE WHEN OBJECT_ID('dbo.' + r.name, r.type) IS NULL THEN 0 ELSE 1 END, r.name;

/* ---------------------------------------------------------------------
   2. Hierarchy shape
   --------------------------------------------------------------------- */
PRINT '';
PRINT '--- 2. Business unit hierarchy ---';
SELECT
    REPLICATE('    ', d.depth) + b.code AS unit,
    b.name,
    CASE WHEN b.is_consolidated = 1 THEN 'roll-up' ELSE 'reporting unit' END AS kind
FROM dbo.business_units b
JOIN dbo.vw_bu_descendants d
  ON d.descendant_id = b.id
 AND d.ancestor_id = (SELECT id FROM dbo.business_units WHERE code = 'VISL')
ORDER BY b.sort_order;

/* ---------------------------------------------------------------------
   3. THE LEAF-ONLY RULE
   ---------------------------------------------------------------------
   An initiative on a consolidated node double counts at every level above
   it. This must return zero rows, always.
   --------------------------------------------------------------------- */
PRINT '';
PRINT '--- 3. Initiatives attached to consolidated nodes (must be empty) ---';
SELECT i.code, i.title, b.code AS attached_to
FROM dbo.initiatives i
JOIN dbo.business_units b ON b.id = i.business_unit_id
WHERE b.is_consolidated = 1;

IF EXISTS (SELECT 1 FROM dbo.initiatives i
           JOIN dbo.business_units b ON b.id = i.business_unit_id
           WHERE b.is_consolidated = 1)
    PRINT 'FAIL - initiatives are attached to roll-up nodes. Every figure above them is overstated.';
ELSE
    PRINT 'OK - no initiative sits on a roll-up node.';

/* ---------------------------------------------------------------------
   4. RECONCILIATION - parent must equal the sum of its children
   ---------------------------------------------------------------------
   This is the check that catches fan-out. text.txt s.8: VISL plan showed
   670.34 Cr against a 105.58 Cr target because a view multiplied month
   totals by the initiative count.
   --------------------------------------------------------------------- */
PRINT '';
PRINT '--- 4. Reconciliation: parent vs sum of children ---';
;WITH child_sum AS (
    SELECT
        p.id AS parent_id,
        SUM(cp.initiative_count) AS child_initiatives,
        SUM(cp.target_cr)        AS child_target,
        SUM(cp.plan_fy_cr)       AS child_plan,
        SUM(cp.booked_ptd_cr)    AS child_booked
    FROM dbo.business_units p
    JOIN dbo.business_units c        ON c.parent_id = p.id
    JOIN dbo.vw_visl_position cp     ON cp.business_unit_id = c.id
    GROUP BY p.id
)
SELECT
    p.code AS parent,
    pp.initiative_count AS parent_init,  cs.child_initiatives AS child_init,
    pp.target_cr        AS parent_target, cs.child_target      AS child_target,
    pp.plan_fy_cr       AS parent_plan,   cs.child_plan        AS child_plan,
    pp.booked_ptd_cr    AS parent_booked, cs.child_booked      AS child_booked,
    CASE WHEN pp.initiative_count = cs.child_initiatives
          AND ABS(pp.target_cr     - cs.child_target) < 0.005
          AND ABS(pp.plan_fy_cr    - cs.child_plan)   < 0.005
          AND ABS(pp.booked_ptd_cr - cs.child_booked) < 0.005
         THEN 'OK' ELSE 'FAIL - DOES NOT RECONCILE' END AS status
FROM child_sum cs
JOIN dbo.business_units p     ON p.id = cs.parent_id
JOIN dbo.vw_visl_position pp  ON pp.business_unit_id = p.id
ORDER BY p.sort_order;

/* ---------------------------------------------------------------------
   5. Plan must foot to target
   --------------------------------------------------------------------- */
PRINT '';
PRINT '--- 5. Monthly plan vs full-year target ---';
SELECT
    bu_code, initiative_count, target_cr, plan_fy_cr,
    plan_fy_cr - target_cr AS drift,
    CASE WHEN ABS(plan_fy_cr - target_cr) < 0.005 THEN 'OK'
         WHEN plan_fy_cr = 0 THEN 'WARN - no monthly plan loaded'
         ELSE 'WARN - plan does not foot to target' END AS status
FROM dbo.vw_visl_position
ORDER BY sort_order;

/* ---------------------------------------------------------------------
   6. Window discipline - the 396.8% guard
   ---------------------------------------------------------------------
   Achievement must be booked-over-closed-months divided by
   plan-over-the-same-closed-months. Recomputed here independently of the
   view and compared. text.txt s.13.5.
   --------------------------------------------------------------------- */
PRINT '';
PRINT '--- 6. Achievement recomputed independently of the view ---';
;WITH cfg AS (
    SELECT TRY_CONVERT(DATE,(SELECT svalue FROM dbo.settings WHERE skey='reporting.closed_through')) AS ct
),
recomputed AS (
    SELECT
        m.business_unit_id,
        SUM(CASE WHEN m.period <= c.ct THEN m.plan_cr   ELSE 0 END) AS plan_ptd,
        SUM(CASE WHEN m.period <= c.ct THEN m.booked_cr ELSE 0 END) AS booked_ptd
    FROM dbo.vw_bu_month m CROSS JOIN cfg c
    GROUP BY m.business_unit_id
)
SELECT
    v.bu_code,
    v.plan_ptd_cr, r.plan_ptd,
    v.booked_ptd_cr, r.booked_ptd,
    v.achievement_ptd_pct,
    CASE WHEN r.plan_ptd > 0 THEN CAST(100.0*r.booked_ptd/r.plan_ptd AS DECIMAL(9,2)) END AS recomputed_pct,
    CASE WHEN ABS(ISNULL(v.plan_ptd_cr,0) - ISNULL(r.plan_ptd,0)) < 0.005
          AND ABS(ISNULL(v.booked_ptd_cr,0) - ISNULL(r.booked_ptd,0)) < 0.005
         THEN 'OK' ELSE 'FAIL - window mismatch' END AS status
FROM dbo.vw_visl_position v
JOIN recomputed r ON r.business_unit_id = v.business_unit_id
ORDER BY v.sort_order;

/* ---------------------------------------------------------------------
   7. Reporting calendar sanity
   --------------------------------------------------------------------- */
PRINT '';
PRINT '--- 7. Reporting calendar ---';
SELECT
    (SELECT svalue FROM dbo.settings WHERE skey='reporting.fy_label')          AS fy,
    (SELECT svalue FROM dbo.settings WHERE skey='reporting.closed_through')    AS closed_through,
    (SELECT svalue FROM dbo.settings WHERE skey='reporting.submission_period') AS collecting,
    (SELECT svalue FROM dbo.settings WHERE skey='approval.mode')               AS approval_mode,
    CASE WHEN (SELECT svalue FROM dbo.settings WHERE skey='reporting.closed_through')
            = (SELECT svalue FROM dbo.settings WHERE skey='reporting.submission_period')
         THEN 'WARN - closed month and collection month are the same; delivery will read low'
         ELSE 'OK' END AS status;

/* ---------------------------------------------------------------------
   8. Approved rows must name an approver
   --------------------------------------------------------------------- */
PRINT '';
PRINT '--- 8. Approved months without an approver (must be empty) ---';
SELECT m.id, i.code, m.period, m.actual_cr
FROM dbo.initiative_months m
JOIN dbo.initiatives i ON i.id = m.initiative_id
WHERE m.actual_status = 'approved' AND (m.approved_by IS NULL OR m.approved_at IS NULL);

PRINT '';
PRINT '=== Verification complete. Resolve every FAIL before go-live. ===';
GO
