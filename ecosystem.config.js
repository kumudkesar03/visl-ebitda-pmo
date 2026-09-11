/**
 * PM2 process definition.
 *
 * `cwd` must be the directory this file sits in. The ESL deployment shipped
 * with a hardcoded /home/esl/ESL_PMO_OFFICE path that no longer existed on the
 * target host (text.txt 13.7), so this resolves the directory at load time
 * instead of naming it.
 *
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save && pm2 startup
 */
module.exports = {
  apps: [{
    name: 'visl-ebitda-pmo',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '512M',
    // The database can be slow to wake on a serverless tier; do not let PM2
    // interpret a long first query as a hung process.
    kill_timeout: 10000,
    listen_timeout: 20000,
    env: {
      NODE_ENV: 'development',
    },
    env_production: {
      NODE_ENV: 'production',
    },
    error_file: 'var/logs/error.log',
    out_file: 'var/logs/out.log',
    merge_logs: true,
    time: true,
  }],
};
