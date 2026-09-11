'use strict';

const env = require('../config/env');

/**
 * Repository dispatcher.
 *
 * The route layer imports this module and nothing else. It never learns
 * whether it is talking to the in-memory synthetic dataset or to Azure SQL,
 * which is what allows the entire application - including the approval
 * workflow and every executive report - to be built, reviewed and signed off
 * before the database exists, and then switched over by changing one line
 * in .env:
 *
 *     DATA_MODE=synthetic   ->  src/data/synthetic/repo.js
 *     DATA_MODE=mssql       ->  src/data/mssql/repo.js
 *
 * Both modules export the same names. docs/02-ARCHITECTURE.md carries the
 * contract; if a method is added to one it must be added to the other.
 */

const impl = env.DATA_MODE === 'mssql'
  ? require('./mssql/repo')
  : require('./synthetic/repo');

module.exports = impl;
