/* =====================================================================
   VISL EBITDA Drive PMO - remove synthetic data
   ---------------------------------------------------------------------
   Deletes every row generated for design review, matched on the
   [SYNTHETIC] tag in initiatives.description.

   RUN THIS BEFORE THE SYSTEM CARRIES REAL FIGURES.

   Never run by `npm run migrate` - the migrator skips 99_*.

   LEAVES UNTOUCHED:
     - business_units and the hierarchy
     - departments, categories, settings
     - users
     - every view
   ===================================================================== */

SET NOCOUNT ON;
BEGIN TRANSACTION;

DECLARE @ids TABLE (id INT PRIMARY KEY);
INSERT INTO @ids (id)
SELECT id FROM dbo.initiatives WHERE description LIKE '%[[]SYNTHETIC]%';

DECLARE @n INT = (SELECT COUNT(*) FROM @ids);
PRINT CONCAT('Synthetic initiatives found: ', @n);

IF @n = 0
BEGIN
    PRINT 'Nothing to remove.';
    ROLLBACK TRANSACTION;
    RETURN;
END

/* Children first. initiative_months, tasks, milestones and risks all
   cascade on delete, but they are removed explicitly so the row counts
   below are meaningful rather than invisible. */
DELETE FROM dbo.comments
 WHERE entity_type = 'initiative' AND entity_id IN (SELECT id FROM @ids);
PRINT CONCAT('  comments           ', @@ROWCOUNT);

DELETE FROM dbo.initiative_months WHERE initiative_id IN (SELECT id FROM @ids);
PRINT CONCAT('  initiative_months  ', @@ROWCOUNT);

DELETE FROM dbo.tasks      WHERE initiative_id IN (SELECT id FROM @ids);
PRINT CONCAT('  tasks              ', @@ROWCOUNT);

DELETE FROM dbo.milestones WHERE initiative_id IN (SELECT id FROM @ids);
PRINT CONCAT('  milestones         ', @@ROWCOUNT);

DELETE FROM dbo.risks      WHERE initiative_id IN (SELECT id FROM @ids);
PRINT CONCAT('  risks              ', @@ROWCOUNT);

DELETE FROM dbo.initiatives WHERE id IN (SELECT id FROM @ids);
PRINT CONCAT('  initiatives        ', @@ROWCOUNT);

/* Departments left with no initiatives at all. Only those created for the
   synthetic load will qualify; a real department that happens to be empty
   is kept, because deleting it would lose a deliberate structure. */
DELETE d FROM dbo.departments d
 WHERE NOT EXISTS (SELECT 1 FROM dbo.initiatives i WHERE i.department_id = d.id)
   AND d.code LIKE '%-%';
PRINT CONCAT('  empty departments  ', @@ROWCOUNT);

UPDATE dbo.settings SET svalue = N'live' WHERE skey = 'dataset.kind';

COMMIT TRANSACTION;
PRINT '';
PRINT 'Synthetic data removed. Run sql/04_verify.sql.';
GO
