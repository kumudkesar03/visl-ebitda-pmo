'use strict';

const express = require('express');
const repo = require('../data');
const M = require('../domain/metrics');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/* --------------------------------------------------------------------- *
 * My work - the owner's own queue
 * --------------------------------------------------------------------- */

/**
 * What this user personally has to do. Separate from the initiative list
 * because an owner signing in to book a month should not have to filter a
 * portfolio table to find their own five rows.
 */
router.get('/', async (req, res, next) => {
  try {
    const settings = await repo.settings();
    const period = settings['reporting.submission_period'];
    const mine = await repo.listInitiatives(req.scope, { owner_id: req.user.id });
    const detail = await Promise.all(mine.map((i) => repo.getInitiative(i.id, req.scope)));

    const submissions = detail.map((d) => {
      const month = d.months.find((m) => m.period === period);
      return {
        initiative_id: d.id,
        code: d.code,
        title: d.title,
        bu_code: d.bu_code,
        period,
        label: M.periodLabel(period),
        plan_cr: month ? month.plan_cr : 0,
        actual_cr: month ? month.actual_cr : null,
        status: month ? month.actual_status : 'draft',
        rejection_note: month ? month.rejection_note : null,
        health: d.health,
        achievement_pct: d.achievement_ptd.pct,
      };
    }).filter((s) => s.plan_cr > 0);

    const tasks = (await repo.listTasks(req.scope, { assignee_id: req.user.id }))
      .filter((t) => !['done', 'cancelled'].includes(t.status));

    res.json({
      period,
      label: M.periodLabel(period),
      submissions,
      outstanding: submissions.filter((s) => !['submitted', 'approved'].includes(s.status)).length,
      returned: submissions.filter((s) => s.status === 'rejected').length,
      tasks,
      overdueTasks: tasks.filter((t) => t.is_overdue).length,
      initiatives: mine,
    });
  } catch (err) { next(err); }
});

module.exports = router;
