'use strict';

const H = require('./hierarchy');

/**
 * Access control for the VISL EBITDA Drive PMO.
 *
 * Two independent dimensions, always applied together:
 *
 *   1. ROLE      - what kind of action the user may perform.
 *   2. BU SCOPE  - which business units those actions may touch.
 *
 * text.txt section 13.1 records the defect this replaces: in the ESL build the
 * routes carried no business_unit filter, so any signed-in user could read all
 * initiatives and - the serious case - an ESL PMO user could approve IOB
 * actuals. Here scope is resolved once per request in middleware/auth.js and
 * every repository call is handed an explicit list of permitted BU codes. A
 * route that forgets to pass scope gets an empty set, not the whole estate.
 */

/* --------------------------------------------------------------------- *
 * Roles
 * --------------------------------------------------------------------- */

const ROLES = {
  admin: {
    label: 'Administrator',
    rank: 100,
    description: 'Full system access including user administration and system settings.',
    global: true,
  },
  visl_pmo: {
    label: 'VISL PMO',
    rank: 80,
    description: 'Central programme office. Sees and governs every business unit.',
    global: true,
  },
  visl_exec: {
    label: 'Leadership',
    rank: 70,
    description: 'CEO / CFO / business heads. Consolidated read-only view of everything.',
    global: true,
    readOnly: true,
  },
  bu_pmo: {
    label: 'Business Unit PMO',
    rank: 60,
    description: 'Programme office for one business unit and everything beneath it.',
    global: false,
  },
  owner: {
    label: 'Initiative Owner',
    rank: 40,
    description: 'Owns initiatives: maintains plan, books actuals, runs tasks and risks.',
    global: false,
  },
  contributor: {
    label: 'Contributor',
    rank: 30,
    description: 'Works assigned tasks and comments. Cannot alter initiative finances.',
    global: false,
  },
  viewer: {
    label: 'Viewer',
    rank: 10,
    description: 'Read-only within their own business unit.',
    global: false,
    readOnly: true,
  },
};

const ROLE_CODES = Object.keys(ROLES);

/* --------------------------------------------------------------------- *
 * Permissions
 * --------------------------------------------------------------------- */

const P = {
  INITIATIVE_VIEW: 'initiative:view',
  INITIATIVE_CREATE: 'initiative:create',
  INITIATIVE_EDIT_ANY: 'initiative:edit:any',
  INITIATIVE_EDIT_OWN: 'initiative:edit:own',
  INITIATIVE_DELETE: 'initiative:delete',

  PLAN_EDIT_ANY: 'plan:edit:any',
  PLAN_EDIT_OWN: 'plan:edit:own',

  ACTUAL_SUBMIT_ANY: 'actual:submit:any',
  ACTUAL_SUBMIT_OWN: 'actual:submit:own',
  ACTUAL_APPROVE: 'actual:approve',
  ACTUAL_REOPEN: 'actual:reopen',

  TASK_MANAGE_ANY: 'task:manage:any',
  TASK_MANAGE_OWN: 'task:manage:own',
  TASK_UPDATE_ASSIGNED: 'task:update:assigned',

  RISK_MANAGE_ANY: 'risk:manage:any',
  RISK_MANAGE_OWN: 'risk:manage:own',

  COMMENT_WRITE: 'comment:write',

  REPORT_VIEW: 'report:view',
  REPORT_EXPORT: 'report:export',
  EXEC_BOARD_VIEW: 'exec:view',

  MASTERDATA_MANAGE: 'masterdata:manage',
  USER_MANAGE: 'user:manage',
  SETTINGS_MANAGE: 'settings:manage',
  AUDIT_VIEW: 'audit:view',
  MAIL_MANAGE: 'mail:manage',
};

const BASE_READ = [P.INITIATIVE_VIEW, P.REPORT_VIEW, P.EXEC_BOARD_VIEW];

const GRANTS = {
  viewer: [...BASE_READ],

  contributor: [
    ...BASE_READ,
    P.TASK_UPDATE_ASSIGNED,
    P.COMMENT_WRITE,
  ],

  owner: [
    ...BASE_READ,
    P.REPORT_EXPORT,
    P.INITIATIVE_EDIT_OWN,
    P.PLAN_EDIT_OWN,
    P.ACTUAL_SUBMIT_OWN,
    P.TASK_MANAGE_OWN,
    P.TASK_UPDATE_ASSIGNED,
    P.RISK_MANAGE_OWN,
    P.COMMENT_WRITE,
  ],

  bu_pmo: [
    ...BASE_READ,
    P.REPORT_EXPORT,
    P.INITIATIVE_CREATE, P.INITIATIVE_EDIT_ANY,
    P.PLAN_EDIT_ANY,
    P.ACTUAL_SUBMIT_ANY, P.ACTUAL_APPROVE, P.ACTUAL_REOPEN,
    P.TASK_MANAGE_ANY, P.TASK_UPDATE_ASSIGNED,
    P.RISK_MANAGE_ANY,
    P.COMMENT_WRITE,
    P.MASTERDATA_MANAGE,
    P.AUDIT_VIEW,
  ],

  visl_exec: [
    ...BASE_READ,
    P.REPORT_EXPORT,
    P.COMMENT_WRITE,
  ],

  visl_pmo: [
    ...BASE_READ,
    P.REPORT_EXPORT,
    P.INITIATIVE_CREATE, P.INITIATIVE_EDIT_ANY, P.INITIATIVE_DELETE,
    P.PLAN_EDIT_ANY,
    P.ACTUAL_SUBMIT_ANY, P.ACTUAL_APPROVE, P.ACTUAL_REOPEN,
    P.TASK_MANAGE_ANY, P.TASK_UPDATE_ASSIGNED,
    P.RISK_MANAGE_ANY,
    P.COMMENT_WRITE,
    P.MASTERDATA_MANAGE,
    P.AUDIT_VIEW,
    P.MAIL_MANAGE,
  ],

  admin: Object.values(P),
};

function can(user, permission) {
  if (!user || !user.role) return false;
  const grants = GRANTS[user.role];
  return Array.isArray(grants) && grants.includes(permission);
}

/* --------------------------------------------------------------------- *
 * Business unit scope
 * --------------------------------------------------------------------- */

/**
 * The set of BU codes a user may read. Global roles get the whole tree;
 * everyone else gets their home unit and everything beneath it, which is what
 * makes an IOB PMO user able to see IOK/IOG/VAB/HO while an IOK owner sees
 * only IOK.
 */
function readScope(user) {
  if (!user) return [];
  const role = ROLES[user.role];
  if (role && role.global) return H.descendantsOf(H.ROOT);
  const home = H.exists(user.home_bu) ? user.home_bu : null;
  if (!home) return [];
  return H.descendantsOf(home);
}

/** Leaf units the user may write against - consolidated nodes hold no rows. */
function writeScope(user) {
  return readScope(user).filter((c) => !H.get(c).consolidated);
}

function canReadBu(user, code) {
  return readScope(user).includes(String(code || '').toUpperCase());
}
function canWriteBu(user, code) {
  return writeScope(user).includes(String(code || '').toUpperCase());
}

/* --------------------------------------------------------------------- *
 * Approval authority
 * --------------------------------------------------------------------- */

/**
 * text.txt 13.6(b) asks whether IOK/IOG/VAB/HO approve their own monthly
 * actuals or whether IOB PMO approves centrally. That is a leadership call,
 * not a technical one, so it is a setting rather than a code path:
 *
 *   local   - the PMO of the owning unit approves (IOK PMO approves IOK).
 *   central - approval rises to the nearest consolidated parent, so
 *             IOK/IOG/VAB/HO actuals are approved by IOB PMO.
 *   visl    - every approval is made centrally by VISL PMO.
 *
 * Changing the setting changes who sees the approvals queue. No migration.
 */
const APPROVAL_MODES = ['local', 'central', 'visl'];

/** Which BU a user must hold authority over in order to approve `buCode`. */
function approvalAuthorityFor(buCode, mode) {
  const code = String(buCode || '').toUpperCase();
  if (mode === 'visl') return H.ROOT;
  if (mode === 'central') {
    const unit = H.get(code);
    if (unit && unit.parent) return unit.parent;
    return H.ROOT;
  }
  return code; // local
}

/**
 * True when `user` may approve a monthly actual belonging to `buCode`.
 * Requires the approve permission AND authority over the deciding node.
 */
function canApprove(user, buCode, mode = 'local') {
  if (!can(user, P.ACTUAL_APPROVE)) return false;
  const authority = approvalAuthorityFor(buCode, mode);
  const role = ROLES[user.role];
  if (role && role.global) return true;
  const home = String(user.home_bu || '').toUpperCase();
  // A BU PMO holds authority over its home node and everything beneath it.
  return home === authority || H.descendantsOf(home).includes(authority);
}

/**
 * Self-approval guard. A user may never approve an actual they submitted,
 * whatever their role, admin included. Maker/checker is not a role question.
 */
function isSelfApproval(user, row) {
  return !!(user && row && row.submitted_by && row.submitted_by === user.id);
}

module.exports = {
  ROLES, ROLE_CODES, PERMISSIONS: P, GRANTS, APPROVAL_MODES,
  can, readScope, writeScope, canReadBu, canWriteBu,
  approvalAuthorityFor, canApprove, isSelfApproval,
};
