/* =====================================================================
   VISL EBITDA Drive PMO - server setup (ONE-OFF, run by the DBA in SSMS)
   ---------------------------------------------------------------------
   Creates the database and the two logins the system uses. Run ONCE, as a
   sysadmin (on-premise SQL Server) or the server admin (Azure SQL), BEFORE
   01..04. `npm run migrate` never runs this file.

   THE ACCESS MODEL (least privilege):

     visl_owner   Schema owner. db_owner on VISL_PMO only. Used by the DBA
                  (or `npm run migrate`) to apply 01..04 and future changes.
                  NOT configured in the application's .env in production.

     visl_app     What the running application connects as. Read and write
                  data only - db_datareader + db_datawriter. It cannot create,
                  alter or drop anything, and has no rights on any other
                  database on the server.

   Replace every <<...>> before running. Passwords: 16+ characters, letters,
   digits, hyphen and underscore ONLY (no # $ ; ! or quotes - dotenv cuts a
   value at '#', which cost half a day in the ESL deployment).
   ===================================================================== */


/* =====================================================================
   PART A - ON-PREMISE SQL SERVER (2016 SP1 or later; 2019/2022 recommended)
   Connect in SSMS to the instance, database = master, as a sysadmin.
   ===================================================================== */

-- A1. Database. Adjust file paths/sizes to the server's standard layout.
IF DB_ID('VISL_PMO') IS NULL
BEGIN
    CREATE DATABASE VISL_PMO;
    -- FULL recovery so the DBA can restore to a point in time. Pair it with
    -- transaction-log backups (A5), or the log will grow without bound.
    ALTER DATABASE VISL_PMO SET RECOVERY FULL;
    -- Needed by STRING_SPLIT, which every scoped query uses (level 130+).
    ALTER DATABASE VISL_PMO SET COMPATIBILITY_LEVEL = 150;   -- 2019. Use 160 on 2022, 130 on 2016.
    -- Readers do not block writers during the monthly close.
    ALTER DATABASE VISL_PMO SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
END
GO

-- A2. Server logins (SQL authentication). The instance must be in "SQL Server
--     and Windows Authentication mode" (Server Properties > Security) and the
--     SQL Server service restarted after changing it.
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'visl_owner')
    CREATE LOGIN visl_owner WITH PASSWORD = '<<OWNER_PASSWORD>>',
        DEFAULT_DATABASE = VISL_PMO, CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'visl_app')
    CREATE LOGIN visl_app WITH PASSWORD = '<<APP_PASSWORD>>',
        DEFAULT_DATABASE = VISL_PMO, CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
-- CHECK_EXPIRATION is OFF deliberately: an expiring service password takes
-- the application down on a date nobody remembers. Rotate it on a schedule
-- instead (see HANDOVER.txt s.14).
GO

-- If the organisation mandates Windows authentication for services, use a
-- domain service account instead of visl_app (and set DB_AUTH=ntlm in .env):
--   CREATE LOGIN [<<DOMAIN>>\svc_visl_pmo] FROM WINDOWS WITH DEFAULT_DATABASE = VISL_PMO;
-- and substitute that name for visl_app in A3.

-- A3. Database users and roles.
USE VISL_PMO;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'visl_owner')
    CREATE USER visl_owner FOR LOGIN visl_owner;
ALTER ROLE db_owner ADD MEMBER visl_owner;

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'visl_app')
    CREATE USER visl_app FOR LOGIN visl_app;
ALTER ROLE db_datareader ADD MEMBER visl_app;
ALTER ROLE db_datawriter ADD MEMBER visl_app;
-- Views are read through db_datareader. No EXECUTE or DDL is needed at runtime.
GO

-- A4. Confirm.
SELECT dp.name AS db_user, r.name AS db_role
FROM sys.database_role_members m
JOIN sys.database_principals r  ON r.principal_id  = m.role_principal_id
JOIN sys.database_principals dp ON dp.principal_id = m.member_principal_id
WHERE dp.name IN ('visl_owner', 'visl_app')
ORDER BY dp.name, r.name;
GO

/* A5. BACKUPS - set up as SQL Agent jobs / Maintenance Plans per company
       standard. Recommended minimum for a system of record:
         Full          nightly          (e.g. 01:00)
         Differential  every 6 hours
         Log           every 15 minutes (required with RECOVERY FULL)
         Retention     35 days on disk, month-end fulls kept 13 months
         Test restore  quarterly, to a scratch database - an untested
                       backup is not a backup.
       Example (full):
         BACKUP DATABASE VISL_PMO TO DISK = N'<<BACKUP_PATH>>\VISL_PMO_full.bak'
           WITH COMPRESSION, CHECKSUM, INIT;
*/

/* A6. NETWORK - on the SQL Server host:
         - SQL Server Configuration Manager > Protocols > TCP/IP = Enabled
           (restart the service). Default instance listens on TCP 1433.
         - Named instance: either fix its port (TCP/IP > IP Addresses > IPAll >
           TCP Port) and open it, or keep dynamic ports and allow UDP 1434
           (SQL Browser) as well.
         - Windows Firewall: allow inbound TCP 1433 (or the fixed port) FROM THE
           APPLICATION SERVER ONLY.
         - Force Encryption with a certificate the application server trusts,
           or set DB_TRUST_SERVER_CERT=true for a self-signed certificate on an
           internal network (a documented, accepted risk - not a default).
*/


/* =====================================================================
   PART B - AZURE SQL DATABASE (only if the database is in Azure instead)
   ---------------------------------------------------------------------
   Azure SQL has no USE and no server-level CREATE DATABASE options above.
   B1 runs on master; B2 runs on VISL_PMO (change database in SSMS).
   ===================================================================== */
/*
-- B1. On master
CREATE DATABASE VISL_PMO (EDITION = 'GeneralPurpose', SERVICE_OBJECTIVE = 'GP_Gen5_2');
CREATE LOGIN visl_owner WITH PASSWORD = '<<OWNER_PASSWORD>>';
CREATE LOGIN visl_app   WITH PASSWORD = '<<APP_PASSWORD>>';
-- A permissionless user on master avoids error 916 for tools that connect
-- without naming a database.
CREATE USER visl_app FOR LOGIN visl_app;

-- B2. On VISL_PMO
CREATE USER visl_owner FOR LOGIN visl_owner;  ALTER ROLE db_owner      ADD MEMBER visl_owner;
CREATE USER visl_app   FOR LOGIN visl_app;    ALTER ROLE db_datareader ADD MEMBER visl_app;
                                              ALTER ROLE db_datawriter ADD MEMBER visl_app;
-- Firewall: Azure portal > SQL server > Networking - allow the application
-- server's outbound IP only. Serverless tiers (GP_S_*) auto-pause; the first
-- query after idle takes 30-60 s. Use a provisioned tier for production.
*/
