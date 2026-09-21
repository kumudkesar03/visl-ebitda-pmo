'use strict';

/**
 * SMTP connectivity check.   `npm run mail:test -- someone@vedanta.co.in`
 *
 * With SMTP_ENABLED=false it only confirms outbox mode is active. With SMTP on,
 * it verifies the relay accepts a connection (and credentials, if set), then
 * sends one plain test message to the address given - nothing to any employee
 * list, and no application template.
 */

const env = require('../config/env');

async function main() {
  const to = process.argv[2];
  console.log('');
  if (!env.mail.enabled) {
    console.log('  SMTP_ENABLED=false - outbox mode. Mail is written to', env.mail.outboxDir, 'and nothing is sent.');
    console.log('  Set SMTP_ENABLED=true and SMTP_HOST in .env to test the relay.');
    console.log('');
    return;
  }

  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    secure: env.mail.secure,
    auth: env.mail.user ? { user: env.mail.user, pass: env.mail.password } : undefined,
  });

  console.log(`  Relay  ${env.mail.host}:${env.mail.port}  secure=${env.mail.secure}  auth=${env.mail.user ? 'yes' : 'no'}`);
  await transport.verify();
  console.log('  Connection accepted.');

  if (!to) {
    console.log('  No address given, so nothing was sent. Pass one to send a test message.');
    console.log('');
    return;
  }
  const info = await transport.sendMail({
    from: env.mail.from,
    to,
    subject: `${env.APP_NAME} - SMTP test`,
    text: `This is a connectivity test from ${env.APP_NAME} at ${env.APP_URL}. No action is needed.`,
  });
  console.log(`  Sent to ${to}. Message id ${info.messageId}`);
  console.log('');
}

main().catch((err) => {
  console.error('  Mail test failed:', err.message);
  process.exit(1);
});
