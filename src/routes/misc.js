'use strict';

const express = require('express');
const ExcelJS = require('exceljs');
const repo = require('../data');
const rbac = require('../domain/rbac');
const M = require('../domain/metrics');
const H = require('../domain/hierarchy');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/* --------------------------------------------------------------------- *
 * Tasks
 * --------------------------------------------------------------------- */

router.get('/tasks', async (req, res, next) => {
  try {
    const rows = await repo.listTasks(req.scope, req.query);
    res.json({
      rows,
      counts: rows.reduce((a, t) => ({ ...a, [t.status]: (a[t.status] || 0) + 1 }), {}),
      overdue: rows.filter((t) => t.is_overdue).length,
    });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------- *
 * Notifications
 * --------------------------------------------------------------------- */

router.get('/notifications', async (req, res, next) => {
  try {
    const rows = await repo.notificationsFor(req.user.id, {
      unreadOnly: req.query.unread === '1',
      limit: Number(req.query.limit) || 60,
    });
    res.json({ rows, unread: rows.filter((r) => !r.is_read).length });
  } catch (err) { next(err); }
});

router.post('/notifications/read', async (req, res, next) => {
  try {
    await repo.markNotificationsRead(req.user.id, req.body.ids);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------- *
 * Exports
 * --------------------------------------------------------------------- */

/**
 * Excel export of the savings matrix.
 *
 * The point of a PMO application is to end the spreadsheet as the system of
 * record - but leadership still wants a file to take into a meeting, and
 * refusing to produce one just pushes people back to maintaining their own.
 * So the export is generated from the same roll-up the screens use, carries
 * the reporting window in the header, and is explicitly a snapshot.
 */
router.get('/export/matrix.xlsx', requirePermission(rbac.PERMISSIONS.REPORT_EXPORT), async (req, res, next) => {
  try {
    const buParam = String(req.query.bu || req.scope[0]).toUpperCase();
    if (!req.scope.includes(buParam)) {
      return res.status(403).json({ error: `Your access does not extend to ${buParam}.` });
    }

    const ctx = await repo.reportingContext(req.scope);
    const roll = M.rollup({
      initiatives: ctx.initiatives,
      monthRows: ctx.monthRows,
      periods: ctx.periods,
      closedThrough: ctx.closedThrough,
    });
    const node = roll.nodes[buParam];
    const inits = await repo.listInitiatives(req.scope, { bu: buParam });
    const ids = new Set(inits.map((i) => i.id));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'VISL EBITDA Drive PMO';
    wb.created = new Date();

    /* ------------------------------ summary ------------------------------ */
    const s = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 6 }] });
    s.mergeCells('A1:F1');
    s.getCell('A1').value = `VISL EBITDA Drive - ${node.bu.name}`;
    s.getCell('A1').font = { size: 15, bold: true, color: { argb: 'FF0A1B33' } };
    s.getCell('A2').value = `Reporting window: ${roll.window.label}  |  Booked figures include approved actuals only`;
    s.getCell('A2').font = { size: 10, color: { argb: 'FF64748B' } };
    s.getCell('A3').value = `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC - snapshot, not a live report`;
    s.getCell('A3').font = { size: 10, italic: true, color: { argb: 'FF64748B' } };

    s.addRow([]);
    const head = s.addRow(['Business unit', 'Initiatives', 'Target (Cr)', 'Plan FY (Cr)', 'Plan to date (Cr)', 'Booked to date (Cr)', 'Variance (Cr)', 'Achievement %', 'Target delivered %']);
    styleHeader(head);

    for (const code of roll.order.filter((c) => H.descendantsOf(buParam).includes(c))) {
      const n = roll.nodes[code];
      const row = s.addRow([
        `${'    '.repeat(Math.max(0, n.bu.depth - node.bu.depth))}${code} - ${n.bu.name}`,
        n.initiative_count, n.target_cr, n.plan_fy_cr, n.plan_ptd_cr, n.booked_ptd_cr, n.variance_ptd_cr,
        n.achievement_ptd.pct, n.target_delivered.pct,
      ]);
      if (n.bu.consolidated) row.font = { bold: true };
      numberFormat(row, [3, 4, 5, 6, 7], '#,##0.00');
      numberFormat(row, [8, 9], '0.0"%"');
    }
    autoWidth(s);

    /* ------------------------------- matrix ------------------------------ */
    const m = wb.addWorksheet('Savings matrix', { views: [{ state: 'frozen', xSplit: 4, ySplit: 2 }] });
    const monthCols = ctx.periods.flatMap((p) => [`${M.periodLabel(p)} plan`, `${M.periodLabel(p)} actual`]);
    const mHead = m.addRow(['Code', 'Initiative', 'Unit', 'Owner', 'Target (Cr)', ...monthCols]);
    styleHeader(mHead);
    m.addRow([]);

    const cells = new Map();
    for (const row of ctx.monthRows) {
      if (!ids.has(row.initiative_id)) continue;
      cells.set(`${row.initiative_id}|${row.period}`, row);
    }
    for (const i of inits.sort((a, b) => a.code.localeCompare(b.code))) {
      const values = [i.code, i.title, i.bu_code, i.owner_name, i.target_savings_cr];
      for (const p of ctx.periods) {
        const c = cells.get(`${i.id}|${p}`);
        values.push(c ? c.plan_cr : 0);
        // Only approved actuals are exported as booked; anything else would
        // let an unapproved figure leave the system looking like a result.
        values.push(c && c.actual_status === 'approved' ? c.actual_cr : null);
      }
      const r = m.addRow(values);
      numberFormat(r, Array.from({ length: monthCols.length + 1 }, (_, k) => k + 5), '#,##0.0000');
    }
    autoWidth(m, 46);

    /* ----------------------------- initiatives --------------------------- */
    const d = wb.addWorksheet('Initiative register');
    const dHead = d.addRow(['Code', 'Initiative', 'Unit', 'Department', 'Owner', 'Category', 'Status', 'Health', 'Priority', 'Progress %', 'Target (Cr)', 'Booked to date (Cr)', 'Achievement %', 'Open risks', 'Due']);
    styleHeader(dHead);
    for (const i of inits) {
      const r = d.addRow([i.code, i.title, i.bu_code, i.department_name, i.owner_name, i.category_name,
        i.status, i.health, i.priority, i.progress_pct, i.target_savings_cr, i.booked_ptd_cr,
        i.achievement_ptd.pct, i.open_risks, i.due_date]);
      numberFormat(r, [11, 12], '#,##0.00');
    }
    autoWidth(d, 46);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="VISL-EBITDA-${buParam}-${ctx.closedThrough}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

function styleHeader(row) {
  row.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A1B33' } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 26;
}
function numberFormat(row, indexes, format) {
  for (const i of indexes) row.getCell(i).numFmt = format;
}
function autoWidth(sheet, cap = 30) {
  sheet.columns.forEach((col) => {
    let max = 10;
    col.eachCell({ includeEmpty: false }, (cell) => {
      max = Math.max(max, String(cell.value === null || cell.value === undefined ? '' : cell.value).length + 2);
    });
    col.width = Math.min(cap, max);
  });
}

module.exports = router;
