'use strict';

/**
 * Build a self-contained release folder.   `npm run package`
 *
 * Company servers often cannot reach the npm registry, and the client build
 * needs dev tooling (Vite, TypeScript) that has no business on a production
 * host. So the release is assembled on a machine that does have internet:
 *
 *   release/visl-ebitda-pmo/
 *     server.js, src/, sql/, public/ (client already built), package*.json,
 *     node_modules/ (production dependencies only), .env.example, HANDOVER.txt
 *
 * Every runtime dependency is pure JavaScript - no native modules - so the
 * folder built on a Windows laptop runs unchanged on Windows Server or Linux,
 * given the same major Node version. Zip it, copy it, unzip, add .env, start.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const out = path.join(root, 'release', 'visl-ebitda-pmo');
const run = (cmd, cwd = root) => { console.log(`  > ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit' }); };

console.log('\n  Building release\n');
run('npm run build');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copy = (rel) => {
  const from = path.join(root, rel);
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, path.join(out, rel), { recursive: true });
};
['server.js', 'ecosystem.config.js', 'package.json', 'package-lock.json', '.env.example',
  'HANDOVER.txt', 'README.md', 'src', 'sql', 'public', 'docs'].forEach(copy);

run('npm ci --omit=dev --no-audit --no-fund', out);

const pkg = require(path.join(root, 'package.json'));
fs.writeFileSync(path.join(out, 'RELEASE.txt'), [
  `${pkg.name} ${pkg.version}`,
  `Built ${new Date().toISOString()} with Node ${process.version} on ${process.platform}`,
  '',
  'Deploy: copy this folder to the server, create .env from .env.example,',
  'then follow HANDOVER.txt section 11. Run on the same major Node version.',
  '',
].join('\n'));

console.log(`\n  Release ready: ${path.relative(root, out)}`);
console.log('  Zip that folder and copy it to the server. Do NOT include a .env.\n');
