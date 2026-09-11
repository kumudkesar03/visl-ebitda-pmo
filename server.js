'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');

const env = require('./src/config/env');
const repo = require('./src/data');
const mailer = require('./src/services/mailer');
const notify = require('./src/services/notifications');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

/* --------------------------------------------------------------------- *
 * Security headers
 * --------------------------------------------------------------------- */

/**
 * Content Security Policy is script-src 'self' with no inline script.
 *
 * text.txt 12 records the consequence in the ESL build: the console's client
 * code had to live in an external file because inline script was blocked.
 * The same rule holds here, and every chart library is bundled from
 * node_modules rather than pulled from a CDN - a plant network cannot be
 * assumed to reach the public internet, and a dashboard that renders blank
 * because cdnjs is unreachable is worse than one that was never built.
 */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // Vite emits a stylesheet, but styled inline attributes are used for
      // dynamic chart colours and progress widths.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
if (env.NODE_ENV !== 'test') app.use(morgan('tiny'));

/* --------------------------------------------------------------------- *
 * API
 * --------------------------------------------------------------------- */

app.get('/api/health', async (req, res) => {
  res.json({
    ok: true,
    app: env.APP_NAME,
    dataMode: repo.mode(),
    mailMode: mailer.mode(),
    node: process.version,
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/initiatives', require('./src/routes/initiatives'));
app.use('/api/my-work', require('./src/routes/mywork'));
app.use('/api/approvals', require('./src/routes/approvals'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api', require('./src/routes/analytics'));
app.use('/api', require('./src/routes/misc'));

app.use('/api', (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` }));

/* --------------------------------------------------------------------- *
 * Static client
 * --------------------------------------------------------------------- */

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));

// Client-side routing: any /app/* path is served the SPA shell.
app.get(['/app', '/app/*'], (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'app.html'));
});
app.get('/', (req, res) => res.redirect('/app'));
app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));

app.use((req, res) => {
  const notFound = path.join(PUBLIC_DIR, '404.html');
  if (fs.existsSync(notFound)) return res.status(404).sendFile(notFound);
  return res.status(404).send('Not found');
});

/* --------------------------------------------------------------------- *
 * Errors
 * --------------------------------------------------------------------- */

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on the server.' : err.message,
    ...(env.NODE_ENV === 'development' && status >= 500 ? { detail: err.message, stack: err.stack } : {}),
  });
});

/* --------------------------------------------------------------------- *
 * Scheduled mail
 * --------------------------------------------------------------------- */

/**
 * Off by default. A scheduler that starts sending on first boot is how a test
 * deployment mails four hundred employees at seven in the morning.
 * Set MAIL_CRON_ENABLED=true only once the outbox has been reviewed.
 */
if (env.mail.cronEnabled) {
  cron.schedule(env.mail.reminderCron, () => {
    notify.sendSubmissionReminders().catch((e) => console.error('[cron] reminders:', e.message));
  });
  cron.schedule(env.mail.digestCron, () => {
    notify.sendExecDigest().catch((e) => console.error('[cron] digest:', e.message));
  });
  console.log(`[cron] reminders "${env.mail.reminderCron}", digest "${env.mail.digestCron}"`);
}

/* --------------------------------------------------------------------- *
 * Start
 * --------------------------------------------------------------------- */

if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log('');
    console.log(`  ${env.APP_NAME}`);
    console.log(`  ${'-'.repeat(48)}`);
    console.log(`  URL        http://localhost:${env.PORT}/app`);
    console.log(`  Data       ${repo.mode()}${repo.mode() === 'synthetic' ? '  (illustrative figures - not reported result)' : ''}`);
    console.log(`  Mail       ${mailer.mode()}${mailer.mode() === 'outbox' ? `  (written to ${env.mail.outboxDir}, nothing sent)` : ''}`);
    console.log(`  Auth       ${env.auth.mode}`);
    console.log(`  Node       ${process.version}`);
    console.log('');
  });
}

module.exports = app;
