/* =====================================================================
   VISL EBITDA Drive PMO - departments (master data)
   ---------------------------------------------------------------------
   Departments are not created by 01..04 and there is no screen for them
   yet, so they are loaded here. Initiatives, the CSV plan loader and the
   Performance screen's department view all rely on this table.

   RULES
     - Attach each department to a REPORTING unit (ESL, IOK, IOG, VAB, HO,
       FACOR), never to a roll-up (VISL, IOB).
     - Names are UNIQUE across the whole estate, so qualify them with the
       unit: 'Commercial (IOK)', not 'Commercial'. text.txt s.4 records the
       ESL load that failed when IOB's "Commercial" collided with ESL's.
     - The CSV loader matches the plan file's "department" column to
       departments.name EXACTLY - use the same text in both.

   Idempotent: re-running updates existing rows and adds new ones. Rows
   are never deleted here - set is_active = 0 to retire a department.

   Edit the list, then run it in SSMS against VISL_PMO as visl_owner.
   `npm run migrate` does not run this file.
   ===================================================================== */

SET NOCOUNT ON;

MERGE dbo.departments AS t
USING (VALUES
    /* (name,                           code,        unit,    sort) */
    /* ---- Replace this sample with the real list from each PMO. ---- */
    (N'Operations (ESL)',               'ESL-OPS',   'ESL',   10),
    (N'Commercial (ESL)',               'ESL-COM',   'ESL',   20),
    (N'Maintenance (ESL)',              'ESL-MNT',   'ESL',   30),
    (N'Operations (IOK)',               'IOK-OPS',   'IOK',   10),
    (N'Commercial (IOK)',               'IOK-COM',   'IOK',   20),
    (N'Operations (IOG)',               'IOG-OPS',   'IOG',   10),
    (N'Logistics (IOG)',                'IOG-LOG',   'IOG',   20),
    (N'Operations (VAB)',               'VAB-OPS',   'VAB',   10),
    (N'Finance (HO)',                   'HO-FIN',    'HO',    10),
    (N'Procurement (HO)',               'HO-PRC',    'HO',    20),
    (N'Operations (FACOR)',             'FAC-OPS',   'FACOR', 10),
    (N'Commercial (FACOR)',             'FAC-COM',   'FACOR', 20)
) AS s (name, code, unit, sort_order)
ON t.name = s.name
WHEN MATCHED THEN UPDATE SET
    t.code = s.code,
    t.business_unit_id = (SELECT id FROM dbo.business_units WHERE code = s.unit),
    t.sort_order = s.sort_order,
    t.is_active = 1
WHEN NOT MATCHED THEN
    INSERT (name, code, business_unit_id, sort_order, is_active)
    VALUES (s.name, s.code, (SELECT id FROM dbo.business_units WHERE code = s.unit), s.sort_order, 1);
GO

/* Guard: no department may sit on a roll-up node. Must return zero rows. */
SELECT d.name AS department_on_rollup, b.code
FROM dbo.departments d JOIN dbo.business_units b ON b.id = d.business_unit_id
WHERE b.is_consolidated = 1;
GO

PRINT 'Departments applied.';
SELECT b.code AS unit, d.name, d.code, d.is_active
FROM dbo.departments d JOIN dbo.business_units b ON b.id = d.business_unit_id
ORDER BY b.sort_order, d.sort_order;
GO
