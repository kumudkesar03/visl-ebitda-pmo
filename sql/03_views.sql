/* =====================================================================
   VISL EBITDA Drive PMO - consolidation views
   ---------------------------------------------------------------------
   THE FORMULA LAYER, IN SQL.

   These views must agree, to the paisa, with src/domain/metrics.js. Run
   `npm run check:metrics` after any change here: it asserts that every
   parent equals the sum of its children and that no ratio was built from
   mismatched windows.

   TWO DEFECTS FROM THE ESL BUILD ARE STRUCTURALLY PREVENTED HERE.

   1. FAN-OUT (text.txt s.8). vw_visl_bu_summary used to join initiatives
      to aggregated month figures in ONE query, repeating each month total
      once per initiative in that unit. VISL plan showed 670.34 Cr against
      a 105.58 Cr target; IOK showed 207.55, which is 29.65 x 7 initiatives.
      Every view below aggregates counts and money in SEPARATE CTEs and
      joins them 1:1 per business unit. Fan-out is not possible.

   2. MISMATCHED WINDOWS (text.txt s.13.5). "Plan achievement 396.8%" came
      from dividing three months of booked actuals by one month of plan.
      vw_visl_position computes both sides over the SAME window, taken from
      settings, and exposes the window it used so the caller can label it.
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. Hierarchy expansion
   ---------------------------------------------------------------------
   Maps every unit to itself and all descendants. This is what lets any
   node be queried and return the correct aggregate:
       IOK  -> IOK
       IOB  -> IOB + IOK + IOG + VAB + HO
       VISL -> everything
   Mirrors H.descendantsOf() in src/domain/hierarchy.js.
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.vw_bu_descendants', 'V') IS NOT NULL DROP VIEW dbo.vw_bu_descendants;
GO
CREATE VIEW dbo.vw_bu_descendants AS
WITH tree AS (
    SELECT  b.id AS ancestor_id, b.id AS descendant_id, 0 AS depth
    FROM    dbo.business_units b
    UNION ALL
    SELECT  t.ancestor_id, c.id, t.depth + 1
    FROM    tree t
    JOIN    dbo.business_units c ON c.parent_id = t.descendant_id
)
SELECT ancestor_id, descendant_id, depth FROM tree;
GO

/* ---------------------------------------------------------------------
   2. Leaf-level month figures
   ---------------------------------------------------------------------
   One row per LEAF business unit per period. Because initiatives can only
   attach to leaves, this is the complete base of the pyramid.

   booked_cr counts approved rows ONLY. That is the governance rule
   expressed as arithmetic: a saving does not count until the PMO office
   has approved the month. submitted_cr is carried separately as pipeline
   so nobody has to choose between honesty and completeness.
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.vw_bu_month_leaf', 'V') IS NOT NULL DROP VIEW dbo.vw_bu_month_leaf;
GO
CREATE VIEW dbo.vw_bu_month_leaf AS
SELECT
    i.business_unit_id,
    m.period,
    SUM(m.plan_cr)                                                              AS plan_cr,
    SUM(ISNULL(m.actual_cr, 0))                                                 AS reported_cr,
    SUM(CASE WHEN m.actual_status = 'approved'  THEN ISNULL(m.actual_cr,0) ELSE 0 END) AS booked_cr,
    SUM(CASE WHEN m.actual_status = 'submitted' THEN ISNULL(m.actual_cr,0) ELSE 0 END) AS submitted_cr,
    SUM(CASE WHEN m.actual_status = 'rejected'  THEN ISNULL(m.actual_cr,0) ELSE 0 END) AS rejected_cr
FROM dbo.initiative_months m
JOIN dbo.initiatives i ON i.id = m.initiative_id AND i.is_active = 1
GROUP BY i.business_unit_id, m.period;
GO

/* ---------------------------------------------------------------------
   3. Month series for EVERY node
   ---------------------------------------------------------------------
   Leaf figures rolled up through vw_bu_descendants. A consolidated node
   gets the sum of its leaves; a leaf gets itself. One row per node per
   period, with a running cumulative for the delivery curve.
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.vw_bu_month', 'V') IS NOT NULL DROP VIEW dbo.vw_bu_month;
GO
CREATE VIEW dbo.vw_bu_month AS
WITH rolled AS (
    SELECT
        d.ancestor_id AS business_unit_id,
        l.period,
        SUM(l.plan_cr)      AS plan_cr,
        SUM(l.reported_cr)  AS reported_cr,
        SUM(l.booked_cr)    AS booked_cr,
        SUM(l.submitted_cr) AS submitted_cr,
        SUM(l.rejected_cr)  AS rejected_cr
    FROM dbo.vw_bu_descendants d
    JOIN dbo.vw_bu_month_leaf l ON l.business_unit_id = d.descendant_id
    GROUP BY d.ancestor_id, l.period
)
SELECT
    b.code AS bu_code,
    b.name AS bu_name,
    r.business_unit_id,
    r.period,
    r.plan_cr,
    r.reported_cr,
    r.booked_cr,
    r.submitted_cr,
    r.rejected_cr,
    r.booked_cr - r.plan_cr AS variance_cr,
    SUM(r.plan_cr)   OVER (PARTITION BY r.business_unit_id ORDER BY r.period
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_plan_cr,
    SUM(r.booked_cr) OVER (PARTITION BY r.business_unit_id ORDER BY r.period
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_booked_cr
FROM rolled r
JOIN dbo.business_units b ON b.id = r.business_unit_id;
GO

/* ---------------------------------------------------------------------
   4. THE POSITION VIEW - one row per business unit
   ---------------------------------------------------------------------
   This is the view the executive board and every export read from.

   FAN-OUT PREVENTION: initiative counts/targets and monetary figures are
   built in two SEPARATE CTEs (init_roll and money_roll) and joined 1:1 on
   business_unit_id. Neither can multiply the other.

   WINDOW DISCIPLINE: plan_ptd_cr and booked_ptd_cr are both restricted to
   periods <= settings 'reporting.closed_through'. They are the numerator
   and denominator of achievement_ptd and they cannot diverge, because
   they are filtered by the same predicate in the same CTE.
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.vw_visl_position', 'V') IS NOT NULL DROP VIEW dbo.vw_visl_position;
GO
CREATE VIEW dbo.vw_visl_position AS
WITH cfg AS (
    SELECT
        TRY_CONVERT(DATE, (SELECT svalue FROM dbo.settings WHERE skey = 'reporting.closed_through')) AS closed_through,
        TRY_CONVERT(DATE, (SELECT svalue FROM dbo.settings WHERE skey = 'reporting.fy_start'))       AS fy_start
),
/* CTE A: counts and full-year commitment. Touches initiatives only. */
init_roll AS (
    SELECT
        d.ancestor_id AS business_unit_id,
        COUNT(i.id)                    AS initiative_count,
        SUM(i.target_savings_cr)       AS target_cr,
        SUM(CASE WHEN i.health = 'red'   THEN 1 ELSE 0 END) AS red_count,
        SUM(CASE WHEN i.health = 'amber' THEN 1 ELSE 0 END) AS amber_count,
        SUM(CASE WHEN i.health = 'green' THEN 1 ELSE 0 END) AS green_count
    FROM dbo.vw_bu_descendants d
    JOIN dbo.initiatives i
      ON i.business_unit_id = d.descendant_id AND i.is_active = 1
    GROUP BY d.ancestor_id
),
/* CTE B: money. Touches month rows only. Never joined to initiatives. */
money_roll AS (
    SELECT
        m.business_unit_id,
        SUM(m.plan_cr)                                                     AS plan_fy_cr,
        SUM(CASE WHEN m.period <= c.closed_through THEN m.plan_cr   ELSE 0 END) AS plan_ptd_cr,
        SUM(CASE WHEN m.period <= c.closed_through THEN m.booked_cr ELSE 0 END) AS booked_ptd_cr,
        SUM(CASE WHEN m.period >  c.closed_through THEN m.plan_cr   ELSE 0 END) AS open_plan_cr,
        SUM(m.booked_cr)                                                   AS booked_fy_cr,
        SUM(m.submitted_cr)                                                AS submitted_cr
    FROM dbo.vw_bu_month m
    CROSS JOIN cfg c
    GROUP BY m.business_unit_id
)
SELECT
    b.id AS business_unit_id,
    b.code            AS bu_code,
    b.name            AS bu_name,
    b.is_consolidated,
    b.sort_order,
    (SELECT closed_through FROM cfg) AS closed_through,

    ISNULL(ir.initiative_count, 0)   AS initiative_count,
    ISNULL(ir.target_cr, 0)          AS target_cr,
    ISNULL(ir.green_count, 0)        AS green_count,
    ISNULL(ir.amber_count, 0)        AS amber_count,
    ISNULL(ir.red_count, 0)          AS red_count,

    ISNULL(mr.plan_fy_cr, 0)         AS plan_fy_cr,
    ISNULL(mr.plan_ptd_cr, 0)        AS plan_ptd_cr,
    ISNULL(mr.booked_ptd_cr, 0)      AS booked_ptd_cr,
    ISNULL(mr.booked_fy_cr, 0)       AS booked_fy_cr,
    ISNULL(mr.submitted_cr, 0)       AS submitted_cr,
    ISNULL(mr.open_plan_cr, 0)       AS open_plan_cr,

    ISNULL(mr.booked_ptd_cr, 0) - ISNULL(mr.plan_ptd_cr, 0) AS variance_ptd_cr,
    ISNULL(ir.target_cr, 0)     - ISNULL(mr.booked_fy_cr, 0) AS gap_to_target_cr,
    ISNULL(mr.booked_fy_cr, 0)  + ISNULL(mr.open_plan_cr, 0) AS forecast_fy_cr,

    /* Achievement against plan for CLOSED MONTHS ONLY. Both sides of this
       ratio come from the same CTE filtered by the same predicate. */
    CASE WHEN ISNULL(mr.plan_ptd_cr, 0) > 0
         THEN CAST(100.0 * mr.booked_ptd_cr / mr.plan_ptd_cr AS DECIMAL(9,2))
         END AS achievement_ptd_pct,

    /* Share of the FULL-YEAR commitment banked. A different question, and
       it will not agree with the figure above. Report both, labelled. */
    CASE WHEN ISNULL(ir.target_cr, 0) > 0
         THEN CAST(100.0 * ISNULL(mr.booked_fy_cr,0) / ir.target_cr AS DECIMAL(9,2))
         END AS target_delivered_pct,

    CASE WHEN ISNULL(ir.target_cr, 0) > 0
         THEN CAST(100.0 * ISNULL(mr.plan_fy_cr,0) / ir.target_cr AS DECIMAL(9,2))
         END AS plan_coverage_pct
FROM dbo.business_units b
LEFT JOIN init_roll  ir ON ir.business_unit_id = b.id
LEFT JOIN money_roll mr ON mr.business_unit_id = b.id
WHERE b.is_active = 1;
GO

/* ---------------------------------------------------------------------
   5. Initiative register with its own derived figures
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.vw_initiative_rollup', 'V') IS NOT NULL DROP VIEW dbo.vw_initiative_rollup;
GO
CREATE VIEW dbo.vw_initiative_rollup AS
WITH cfg AS (
    SELECT TRY_CONVERT(DATE, (SELECT svalue FROM dbo.settings WHERE skey = 'reporting.closed_through')) AS closed_through
),
money AS (
    SELECT
        m.initiative_id,
        SUM(m.plan_cr) AS plan_fy_cr,
        SUM(CASE WHEN m.period <= c.closed_through THEN m.plan_cr ELSE 0 END) AS plan_ptd_cr,
        SUM(CASE WHEN m.period <= c.closed_through AND m.actual_status = 'approved'
                 THEN ISNULL(m.actual_cr,0) ELSE 0 END) AS booked_ptd_cr,
        SUM(CASE WHEN m.actual_status = 'approved'  THEN ISNULL(m.actual_cr,0) ELSE 0 END) AS booked_fy_cr,
        SUM(CASE WHEN m.actual_status = 'submitted' THEN ISNULL(m.actual_cr,0) ELSE 0 END) AS submitted_cr
    FROM dbo.initiative_months m CROSS JOIN cfg c
    GROUP BY m.initiative_id
),
work AS (
    SELECT
        initiative_id,
        COUNT(*)                                         AS task_count,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS task_done,
        SUM(CASE WHEN status NOT IN ('done','cancelled')
                  AND planned_end IS NOT NULL
                  AND planned_end < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS task_overdue
    FROM dbo.tasks GROUP BY initiative_id
),
risk AS (
    SELECT initiative_id, COUNT(*) AS open_risks
    FROM dbo.risks WHERE status IN ('open','mitigating') GROUP BY initiative_id
)
SELECT
    i.id, i.code, i.title, i.description,
    b.code AS bu_code, b.name AS bu_name, i.business_unit_id,
    d.name AS department_name, i.department_id,
    u.name AS owner_name, u.email AS owner_email, i.owner_id,
    c.code AS category, c.name AS category_name,
    i.status, i.priority, i.health, i.progress_pct,
    i.target_savings_cr, i.start_date, i.due_date,
    ISNULL(mo.plan_fy_cr, 0)    AS plan_fy_cr,
    ISNULL(mo.plan_ptd_cr, 0)   AS plan_ptd_cr,
    ISNULL(mo.booked_ptd_cr, 0) AS booked_ptd_cr,
    ISNULL(mo.booked_fy_cr, 0)  AS booked_fy_cr,
    ISNULL(mo.submitted_cr, 0)  AS submitted_cr,
    ISNULL(mo.booked_ptd_cr,0) - ISNULL(mo.plan_ptd_cr,0) AS variance_ptd_cr,
    CASE WHEN ISNULL(mo.plan_ptd_cr,0) > 0
         THEN CAST(100.0 * mo.booked_ptd_cr / mo.plan_ptd_cr AS DECIMAL(9,2)) END AS achievement_ptd_pct,
    ISNULL(w.task_count, 0)   AS task_count,
    ISNULL(w.task_done, 0)    AS task_done,
    ISNULL(w.task_overdue, 0) AS task_overdue,
    ISNULL(r.open_risks, 0)   AS open_risks
FROM dbo.initiatives i
JOIN dbo.business_units b ON b.id = i.business_unit_id
LEFT JOIN dbo.departments d ON d.id = i.department_id
LEFT JOIN dbo.users u       ON u.id = i.owner_id
LEFT JOIN dbo.categories c  ON c.code = i.category_code
LEFT JOIN money mo ON mo.initiative_id = i.id
LEFT JOIN work  w  ON w.initiative_id  = i.id
LEFT JOIN risk  r  ON r.initiative_id  = i.id
WHERE i.is_active = 1;
GO

/* ---------------------------------------------------------------------
   6. Approval queue
   --------------------------------------------------------------------- */

IF OBJECT_ID('dbo.vw_approval_queue', 'V') IS NOT NULL DROP VIEW dbo.vw_approval_queue;
GO
CREATE VIEW dbo.vw_approval_queue AS
SELECT
    m.id, m.initiative_id, m.period, m.plan_cr, m.actual_cr,
    m.remarks, m.submitted_by, m.submitted_at,
    i.code AS initiative_code, i.title AS initiative_title,
    b.code AS bu_code, b.id AS business_unit_id,
    i.owner_id, ow.name AS owner_name, d.name AS department_name,
    sb.name AS submitted_by_name,
    ISNULL(m.actual_cr,0) - m.plan_cr AS variance_cr
FROM dbo.initiative_months m
JOIN dbo.initiatives i    ON i.id = m.initiative_id AND i.is_active = 1
JOIN dbo.business_units b ON b.id = i.business_unit_id
LEFT JOIN dbo.departments d ON d.id = i.department_id
LEFT JOIN dbo.users ow ON ow.id = i.owner_id
LEFT JOIN dbo.users sb ON sb.id = m.submitted_by
WHERE m.actual_status = 'submitted';
GO

PRINT 'Views created. Verify with 04_verify.sql before using the application.';
GO
