'use strict';

/**
 * Active Directory connection check.
 *
 *   npm run ad:test                         every configured directory: connect + service bind
 *   npm run ad:test -- --user kumud.kesar   ... and look that user up
 *   npm run ad:test -- --user kumud.kesar --password
 *                                           ... and prompt (hidden) for their password
 *   npm run ad:test -- --dir IOB ...        one directory only
 *
 * Runs each step separately and says which one failed, because "AD login does
 * not work" is five different problems: DNS/firewall, TLS certificate, service
 * account credentials, search base/filter, and the user's own password.
 * Nothing is written anywhere; the password is never echoed or logged.
 */

const env = require('../config/env');
const ldap = require('../services/ldap');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

function promptHidden(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    if (!stdin.isTTY) {
      let data = '';
      stdin.on('data', (c) => { data += c; }).on('end', () => resolve(data.trim()));
      return;
    }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '') {
        stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData);
        stdout.write('\n'); resolve(value);
      } else if (ch === '') { stdout.write('\n'); process.exit(130); }
      else if (ch === '' || ch === '\b') value = value.slice(0, -1);
      else value += ch;
    };
    stdin.on('data', onData);
  });
}

const ok = (m) => console.log(`    OK    ${m}`);
const bad = (m) => console.log(`    FAIL  ${m}`);
const info = (m) => console.log(`          ${m}`);

/** Translate the AD error text into the thing to go and fix. */
const LDAP_CODES = {
  32: 'No such object - the base DN or bind DN does not exist. Check AD_BASE_DN / AD_BIND_DN.',
  49: 'Invalid credentials - wrong bind DN or password.',
  50: 'Insufficient access - the service account may not read users under this base DN.',
  53: 'Unwilling to perform - often an empty password, or the DC refuses simple bind without TLS.',
  8: 'Strong authentication required - use ldaps:// or StartTLS.',
};

function explain(err) {
  const m = `${String(err && err.message || '')} ${err && err.code !== undefined ? `code ${err.code}` : ''}`.trim() || String(err);
  const specific = explainText(m);
  if (specific !== m) return specific;
  if (err && LDAP_CODES[err.code]) return `${LDAP_CODES[err.code]}  (${m})`;
  return m;
}

function explainText(m) {
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'Host name does not resolve. Check the DC name and DNS from this server.';
  if (/ECONNREFUSED/.test(m)) return 'Connection refused. Wrong port, or LDAP/LDAPS not listening on that DC.';
  if (/ETIMEDOUT|timeout|Timeout/.test(m)) return 'Timed out. A firewall between this server and the DC is the usual cause (TCP 636 or 389).';
  if (/self.signed|unable to verify|UNABLE_TO_GET_ISSUER|certificate/i.test(m)) return 'TLS certificate not trusted. Export the company root CA as PEM and set caFile / AD_CA_FILE.';
  if (/Hostname\/IP does not match|altnames/i.test(m)) return 'Certificate name mismatch. Use the DC\'s fully-qualified name as it appears on its certificate.';
  if (/data 52e/.test(m)) return 'AD 52e: wrong password (or wrong bind DN).';
  if (/data 525/.test(m)) return 'AD 525: user not found - check the bind DN.';
  if (/data 530|data 531/.test(m)) return 'AD 530/531: logon not permitted at this time / from this workstation.';
  if (/data 532/.test(m)) return 'AD 532: password expired.';
  if (/data 533/.test(m)) return 'AD 533: account disabled.';
  if (/data 701/.test(m)) return 'AD 701: account expired.';
  if (/data 773/.test(m)) return 'AD 773: user must reset password at next logon.';
  if (/data 775/.test(m)) return 'AD 775: account locked out.';
  if (/Invalid Credentials/i.test(m)) return 'Invalid credentials - wrong bind DN or password.';
  if (/No Such Object|0000208D/.test(m)) return 'The base DN does not exist. Check AD_BASE_DN.';
  if (/strongAuthRequired|Strong Auth/i.test(m)) return 'The DC requires signing/TLS. Use ldaps:// or StartTLS.';
  return m;
}

async function checkDirectory(dir, user, password) {
  console.log(`\n  Directory ${dir.key}`);
  info(`serves    ${dir.units.join(', ')} (and the units beneath them)`);
  info(`url       ${dir.url}${dir.startTLS ? '  (StartTLS)' : ''}`);
  info(`base DN   ${dir.baseDN || '(not set)'}`);
  info(`bind DN   ${dir.bindDN || '(none - direct user bind)'}   password ${dir.bindPassword ? 'set' : 'NOT SET'}`);
  info(`filter    ${dir.userFilter}`);
  info(`CA file   ${dir.caFile || '(system trust store)'}   rejectUnauthorized=${dir.rejectUnauthorized}`);
  console.log('');

  let client;
  try {
    client = await ldap.connect(dir);
    // ldapts connects lazily; a service bind (or anonymous rootDSE read) forces it.
    ok('Configuration accepted (encrypted transport)');
  } catch (err) { bad(`Connect: ${explain(err)}`); return false; }

  if (!dir.bindDN) {
    await client.unbind().catch(() => {});
    info('No service account: direct-bind mode. The connection is proven by the user bind below.');
    if (!password) { info('Run with --user <id> --password to test it.'); return true; }
    try {
      const result = await ldap.authenticateIn(dir, user, password);
      if (result) { ok(`Connected over TLS and bound as ${user}`); return true; }
      bad('Password rejected (or account disabled / not found)'); return false;
    } catch (err) { bad(`User bind: ${explain(err)}`); return false; }
  }

  try {
    await client.bind(dir.bindDN, dir.bindPassword);
    ok('Connected over TLS and bound as the service account');
  } catch (err) {
    bad(`Connect / service bind: ${explain(err)}`);
    await client.unbind().catch(() => {});
    return false;
  }

  if (!user) { await client.unbind().catch(() => {}); return true; }

  if (dir.bindDN) {
    try {
      const entry = await ldap.findUser(client, dir, ldap.normaliseUsername(user));
      if (!entry) { bad(`User "${user}" not found under ${dir.baseDN} with that filter`); await client.unbind().catch(() => {}); return false; }
      const u = ldap.shape(entry, dir.key);
      ok(`Found ${u.username}  ${u.name || ''}  <${u.email || 'no mail'}>`);
      info(`DN        ${u.dn}`);
      info(`UPN       ${u.upn || '-'}     title ${u.title || '-'}     department ${u.department || '-'}`);
      if (u.disabled) { bad('Account is DISABLED in AD (userAccountControl) - sign-in will be refused'); await client.unbind().catch(() => {}); return false; }
    } catch (err) { bad(`Search: ${explain(err)}`); await client.unbind().catch(() => {}); return false; }
  }
  await client.unbind().catch(() => {});

  if (password) {
    try {
      const result = await ldap.authenticateIn(dir, user, password);
      if (result) ok(`Password accepted for ${result.username || user} - this user can sign in (if they exist in the app as an AD account)`);
      else { bad('Password rejected (or account disabled / not found)'); return false; }
    } catch (err) { bad(`User bind: ${explain(err)}`); return false; }
  }
  return true;
}

async function main() {
  console.log(`\n  ${env.APP_NAME} - Active Directory check      AUTH_MODE=${env.auth.mode}`);
  const dirs = Object.values(env.ad.directories).filter((d) => !arg('dir') || d.key === String(arg('dir')).toUpperCase());
  if (!dirs.length) {
    console.log('\n  No directory configured. Set AD_DIRS and the AD_<KEY>_* values in .env. See HANDOVER.txt s.9.\n');
    process.exit(1);
  }
  const user = typeof arg('user') === 'string' ? arg('user') : null;
  const password = user && arg('password') ? await promptHidden(`  Password for ${user}: `) : null;

  let allOk = true;
  for (const dir of dirs) allOk = (await checkDirectory(dir, user, password)) && allOk;
  console.log(allOk ? '\n  All checks passed.\n' : '\n  Some checks failed - see above.\n');
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => { console.error('  AD check aborted:', explain(err)); process.exit(1); });
