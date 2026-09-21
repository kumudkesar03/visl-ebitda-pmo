'use strict';

const fs = require('fs');
const path = require('path');
const env = require('../config/env');

/**
 * Mail intimations.
 *
 * OUTBOX MODE IS THE DEFAULT AND IT MATTERS.
 *
 * With SMTP_ENABLED=false every message is rendered in full and written to
 * var/outbox as an .html file plus a line in index.json, and nothing is sent.
 * The Mail outbox screen in the application reads that directory, so the
 * complete notification design - who gets what, when, and what it says - can
 * be reviewed and approved by the business before a single mail reaches a real
 * employee's inbox. text.txt 1.4 records SMTP_ENABLED=false being set for
 * exactly this reason; here it is a first-class mode rather than a mute switch.
 *
 * Turning SMTP_ENABLED=true switches to nodemailer with no other change.
 */

let transport = null;

function getTransport() {
  if (!env.mail.enabled) return null;
  if (transport) return transport;
  // Required lazily so a deployment running in outbox mode does not need the
  // dependency resolved at boot.
  const nodemailer = require('nodemailer');
  transport = nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    secure: env.mail.secure,
    auth: env.mail.user ? { user: env.mail.user, pass: env.mail.password } : undefined,
  });
  return transport;
}

/* --------------------------------------------------------------------- *
 * Presentation
 * --------------------------------------------------------------------- */

const BRAND = {
  blue: '#0062ae',     // Vedanta Iron & Steel wordmark blue
  green: '#6db83f',    // the leaf green of the mark
  leafText: '#3c7a1d',
  ink: '#1b1f23',
  muted: '#6b7178',
  line: '#dfe1dd',
  bg: '#f1f2ef',
};

const fmtCr = (v) => (v === null || v === undefined
  ? '--'
  : `Rs ${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`);

const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * One shell for every message. Table-based and inline-styled because Outlook
 * on the corporate desktop is the reader, and it ignores most of a stylesheet.
 */
function shell({ title, preheader, intro, blocks = [], cta, footnote }) {
  const rows = blocks.map((b) => {
    if (b.type === 'kv') {
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">
        ${b.rows.map((r) => `<tr>
          <td style="padding:7px 0;border-bottom:1px solid ${BRAND.line};color:${BRAND.muted};font-size:13px;width:44%">${esc(r[0])}</td>
          <td style="padding:7px 0;border-bottom:1px solid ${BRAND.line};color:${BRAND.ink};font-size:13px;font-weight:600;text-align:right">${r[2] === 'raw' ? r[1] : esc(r[1])}</td>
        </tr>`).join('')}
      </table>`;
    }
    if (b.type === 'callout') {
      const tone = b.tone === 'red' ? '#c8372d' : b.tone === 'green' ? '#2e8540' : b.tone === 'amber' ? '#b7791f' : BRAND.blue;
      const bg = b.tone === 'red' ? '#fcefed' : b.tone === 'green' ? '#edf7ef' : b.tone === 'amber' ? '#fcf5e7' : '#eef5fb';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">
        <tr><td style="background:${bg};border-left:3px solid ${tone};padding:12px 14px;color:${BRAND.ink};font-size:13px;line-height:1.55">${esc(b.text)}</td></tr>
      </table>`;
    }
    if (b.type === 'table') {
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-collapse:collapse">
        <tr>${b.head.map((h, i) => `<th style="text-align:${i === 0 ? 'left' : 'right'};padding:8px 10px;background:${BRAND.bg};border-bottom:2px solid ${BRAND.line};font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:${BRAND.muted}">${esc(h)}</th>`).join('')}</tr>
        ${b.rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${i === 0 ? 'left' : 'right'};padding:9px 10px;border-bottom:1px solid ${BRAND.line};font-size:13px;color:${BRAND.ink}">${esc(c)}</td>`).join('')}</tr>`).join('')}
      </table>`;
    }
    return `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${BRAND.ink}">${esc(b.text)}</p>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader || '')}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:620px;max-width:100%;background:#fff;border:1px solid ${BRAND.line};border-radius:6px;overflow:hidden">
    <tr><td style="height:4px;background:${BRAND.blue};background-image:linear-gradient(90deg,${BRAND.blue} 62%,${BRAND.green} 100%)"></td></tr>
    <tr><td style="padding:18px 26px 16px;border-bottom:1px solid ${BRAND.line}">
      <div style="color:${BRAND.blue};font-size:15px;font-weight:600;letter-spacing:-.01em">EBITDA Drive PMO</div>
      <div style="color:${BRAND.leafText};font-size:10.5px;margin-top:3px;letter-spacing:.12em;font-weight:600">VEDANTA IRON &amp; STEEL</div>
    </td></tr>
    <tr><td style="padding:26px">
      <h1 style="margin:0 0 6px;font-size:19px;color:${BRAND.ink};font-weight:650;letter-spacing:-.015em">${esc(title)}</h1>
      ${intro ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${BRAND.muted}">${esc(intro)}</p>` : ''}
      ${rows}
      ${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px"><tr>
        <td style="background:${BRAND.blue};border-radius:4px"><a href="${esc(cta.url)}" style="display:inline-block;padding:11px 20px;color:#fff;font-size:13.5px;font-weight:600;text-decoration:none">${esc(cta.label)}</a></td>
      </tr></table>` : ''}
      ${footnote ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.55;color:${BRAND.muted}">${esc(footnote)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:14px 26px;background:#f8f8f6;border-top:1px solid ${BRAND.line}">
      <p style="margin:0;font-size:11.5px;line-height:1.55;color:${BRAND.muted}">
        Automated message from the VISL EBITDA Drive PMO. Figures shown are as recorded in the system at the time of sending and are subject to PMO approval.
      </p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

/* --------------------------------------------------------------------- *
 * Templates
 * --------------------------------------------------------------------- */

const templates = {
  actual_submitted: ({ initiative, month, submitter, approver }) => ({
    subject: `Approval required: ${initiative.code} ${month.label} actual`,
    html: shell({
      title: 'Monthly actual awaiting your approval',
      preheader: `${initiative.code} - ${fmtCr(month.actual_cr)} for ${month.label}`,
      intro: `${submitter.name} has submitted the ${month.label} actual for approval.`,
      blocks: [
        { type: 'kv', rows: [
          ['Initiative', `${initiative.code} - ${initiative.title}`],
          ['Business unit', initiative.bu_code],
          ['Owner', initiative.owner_name || '--'],
          ['Reporting month', month.label],
          ['Plan', fmtCr(month.plan_cr)],
          ['Actual submitted', fmtCr(month.actual_cr)],
          ['Variance', fmtCr((month.actual_cr || 0) - (month.plan_cr || 0))],
        ] },
        month.remarks ? { type: 'callout', text: `Owner remarks: ${month.remarks}` } : null,
      ].filter(Boolean),
      cta: { label: 'Review and approve', url: `${env.APP_URL}/app/approvals` },
      footnote: `Sent to ${approver.name} as the approving authority for ${initiative.bu_code}. Savings count towards the drive only once approved.`,
    }),
  }),

  actual_approved: ({ initiative, month, approver }) => ({
    subject: `Approved: ${initiative.code} ${month.label} - ${fmtCr(month.actual_cr)}`,
    html: shell({
      title: 'Your monthly actual has been approved',
      preheader: `${initiative.code} ${month.label} approved`,
      intro: `${approver.name} has approved the ${month.label} actual. It now counts towards booked savings.`,
      blocks: [
        { type: 'callout', tone: 'green', text: `${fmtCr(month.actual_cr)} booked for ${month.label}.` },
        { type: 'kv', rows: [
          ['Initiative', `${initiative.code} - ${initiative.title}`],
          ['Plan', fmtCr(month.plan_cr)],
          ['Approved actual', fmtCr(month.actual_cr)],
          ['Approved by', approver.name],
        ] },
      ],
      cta: { label: 'Open initiative', url: `${env.APP_URL}/app/initiatives/${initiative.id}` },
    }),
  }),

  actual_returned: ({ initiative, month, approver, note }) => ({
    subject: `Returned for revision: ${initiative.code} ${month.label}`,
    html: shell({
      title: 'Monthly actual returned for revision',
      preheader: `${initiative.code} ${month.label} needs revision`,
      intro: `${approver.name} has returned the ${month.label} submission. It is not counted as booked until it is corrected and re-approved.`,
      blocks: [
        { type: 'callout', tone: 'red', text: note || 'Returned for revision.' },
        { type: 'kv', rows: [
          ['Initiative', `${initiative.code} - ${initiative.title}`],
          ['Reporting month', month.label],
          ['Submitted', fmtCr(month.actual_cr)],
        ] },
      ],
      cta: { label: 'Revise and resubmit', url: `${env.APP_URL}/app/initiatives/${initiative.id}` },
    }),
  }),

  submission_reminder: ({ user, period, pending }) => ({
    subject: `Action required: ${period} actuals due for ${pending.length} initiative(s)`,
    html: shell({
      title: `${period} actuals are due`,
      preheader: `${pending.length} initiative(s) awaiting your submission`,
      intro: `The monthly submission window for ${period} is open. The following initiatives you own have no submitted actual yet.`,
      blocks: [
        { type: 'table',
          head: ['Initiative', 'Unit', 'Plan'],
          rows: pending.map((p) => [`${p.code} ${p.title}`, p.bu_code, fmtCr(p.plan_cr)]) },
        { type: 'callout', tone: 'amber', text: 'Savings are only counted once the PMO office has approved the month. Late submissions delay the consolidated position reported to leadership.' },
      ],
      cta: { label: 'Enter actuals', url: `${env.APP_URL}/app/my-work` },
      footnote: `Sent to ${user.name}.`,
    }),
  }),

  exec_digest: ({ user, node, rows, window: win }) => ({
    subject: `VISL EBITDA Drive - weekly position (${node.bu.code})`,
    html: shell({
      title: `EBITDA drive - ${node.bu.name}`,
      preheader: `Booked ${fmtCr(node.booked_ptd_cr)} against plan ${fmtCr(node.plan_ptd_cr)}`,
      intro: `Consolidated position for ${win.label}. Booked figures include approved actuals only.`,
      blocks: [
        { type: 'kv', rows: [
          ['Full-year target', fmtCr(node.target_cr)],
          ['Plan to date', fmtCr(node.plan_ptd_cr)],
          ['Booked to date', fmtCr(node.booked_ptd_cr)],
          ['Variance to date', fmtCr(node.variance_ptd_cr)],
          ['Achievement (plan-to-date)', node.achievement_ptd.pct === null ? '--' : `${node.achievement_ptd.pct.toFixed(1)}%`],
          ['Target delivered (full year)', node.target_delivered.pct === null ? '--' : `${node.target_delivered.pct.toFixed(1)}%`],
          ['Awaiting approval', fmtCr(node.submitted_cr)],
        ] },
        // A leaf unit has nothing beneath it, so the breakdown table is
        // omitted rather than sent as a header with no rows under it.
        rows.length ? { type: 'table', head: ['Business unit', 'Target', 'Booked', 'Achv'], rows } : null,
        { type: 'callout', text: 'Achievement is measured against plan for closed months only. Target delivered is measured against the full-year commitment. The two are different questions and will not agree.' },
      ].filter(Boolean),
      cta: { label: 'Open the executive board', url: `${env.APP_URL}/app/exec` },
      footnote: `Sent to ${user.name}, ${user.designation || user.role}.`,
    }),
  }),

  milestone_due: ({ initiative, milestone, user }) => ({
    subject: `Milestone due: ${initiative.code} - ${milestone.title}`,
    html: shell({
      title: 'Milestone falling due',
      intro: `A milestone on an initiative you own is due on ${milestone.due_date}.`,
      blocks: [{ type: 'kv', rows: [
        ['Initiative', `${initiative.code} - ${initiative.title}`],
        ['Milestone', milestone.title],
        ['Due', milestone.due_date],
      ] }],
      cta: { label: 'Open initiative', url: `${env.APP_URL}/app/initiatives/${initiative.id}` },
      footnote: `Sent to ${user.name}.`,
    }),
  }),
};

/* --------------------------------------------------------------------- *
 * Delivery
 * --------------------------------------------------------------------- */

function outboxDir() {
  return path.isAbsolute(env.mail.outboxDir)
    ? env.mail.outboxDir
    : path.join(process.cwd(), env.mail.outboxDir);
}

function writeOutbox(record) {
  const dir = outboxDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = `${record.id}.html`;
  fs.writeFileSync(path.join(dir, file), record.html);

  const indexPath = path.join(dir, 'index.json');
  let index = [];
  try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch { index = []; }
  index.unshift({
    id: record.id,
    template: record.template,
    to: record.to,
    subject: record.subject,
    sent_at: record.sent_at,
    delivered: record.delivered,
    file,
  });
  fs.writeFileSync(indexPath, JSON.stringify(index.slice(0, 500), null, 2));
  return record;
}

let seq = 0;

/**
 * Render and deliver one message.
 * Returns the record either way, so callers do not branch on mail mode.
 */
async function send(templateName, to, data) {
  const tpl = templates[templateName];
  if (!tpl) throw new Error(`Unknown mail template "${templateName}"`);
  const { subject, html } = tpl(data);

  seq += 1;
  const record = {
    id: `${Date.now()}-${String(seq).padStart(4, '0')}-${templateName}`,
    template: templateName,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
    sent_at: new Date().toISOString(),
    delivered: false,
  };

  const tx = getTransport();
  if (tx) {
    try {
      await tx.sendMail({ from: env.mail.from, to: record.to, subject, html });
      record.delivered = true;
    } catch (err) {
      record.error = err.message;
      console.error(`[mail] delivery failed for ${templateName}:`, err.message);
    }
  }

  return writeOutbox(record);
}

function listOutbox(limit = 100) {
  try {
    const index = JSON.parse(fs.readFileSync(path.join(outboxDir(), 'index.json'), 'utf8'));
    return index.slice(0, limit);
  } catch {
    return [];
  }
}

function readOutbox(id) {
  const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '');
  const file = path.join(outboxDir(), `${safe}.html`);
  if (!file.startsWith(outboxDir()) || !fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

module.exports = {
  send, templates, listOutbox, readOutbox,
  enabled: () => env.mail.enabled,
  mode: () => (env.mail.enabled ? 'smtp' : 'outbox'),
};
