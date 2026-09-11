import type { InitiativeStatus, TaskStatus, ActualStatus, Priority, Role, ApprovalMode } from '../types/api';

type AnyStatus = InitiativeStatus | TaskStatus | ActualStatus;

/**
 * Labels are written the way the business says them, not the way the column is
 * spelled. A PMO lead does not say "submitted", they say the month is awaiting
 * approval; an owner whose figure came back does not read "rejected" as a
 * verdict on them, so it reads "Returned".
 */
export const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started', in_progress: 'In progress', at_risk: 'At risk',
  on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled',
  todo: 'To do', blocked: 'Blocked', review: 'In review', done: 'Done',
  draft: 'Not submitted', submitted: 'Awaiting approval', approved: 'Approved', rejected: 'Returned',
  open: 'Open', achieved: 'Achieved', missed: 'Missed',
  mitigating: 'Mitigating', closed: 'Closed', accepted: 'Accepted',
};

export const STATUS_TONE: Record<string, string> = {
  not_started: '', in_progress: 'blue', at_risk: 'red', on_hold: 'amber',
  completed: 'green', cancelled: '',
  todo: '', blocked: 'red', review: 'violet', done: 'green',
  draft: '', submitted: 'amber', approved: 'green', rejected: 'red',
  open: 'blue', achieved: 'green', missed: 'red',
  mitigating: 'amber', closed: '', accepted: '',
};

export const PRIORITY_TONE: Record<Priority, string> = { critical: 'red', high: 'amber', medium: 'blue', low: '' };
export const PRIORITY_LABELS: Record<Priority, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

export const STATUS_OPTIONS: InitiativeStatus[] = ['not_started', 'in_progress', 'at_risk', 'on_hold', 'completed', 'cancelled'];
export const TASK_STATUS_OPTIONS: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled'];
export const PRIORITY_OPTIONS: Priority[] = ['low', 'medium', 'high', 'critical'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator', visl_pmo: 'VISL PMO', visl_exec: 'Leadership',
  bu_pmo: 'Business Unit PMO', owner: 'Initiative Owner',
  contributor: 'Contributor', viewer: 'Viewer',
};

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  local: 'Local - each unit approves its own',
  central: 'Central - the parent unit approves',
  visl: 'VISL - all approvals made centrally',
};

export const HEALTH_LABELS: Record<string, string> = { green: 'On track', amber: 'Watch', red: 'Off track' };

export const CATEGORY_ORDER = ['RAW', 'ENE', 'LOG', 'YLD', 'CON', 'SPR', 'WCP', 'SLS', 'OVH', 'DIG'];

/**
 * One ordered palette for every categorical series in the application, so a
 * category is the same colour on the dashboard, the board pack and the export.
 * Nothing here is chosen for looks alone: plan is deliberately grey so that
 * delivery is the only thing on a chart carrying colour.
 */
export const CHART = {
  plan: '#94a3b8',
  planFill: 'rgba(148,163,184,.16)',
  booked: '#0b5cff',
  bookedFill: 'rgba(11,92,255,.12)',
  approved: '#08875b',
  pipeline: '#b45309',
  gap: '#cbd5e1',
  grid: '#e4e8ee',
  axis: '#94a3b8',
  series: ['#0b5cff', '#08875b', '#b45309', '#6941c6', '#c0332e', '#0891b2', '#be185d', '#ca8a04', '#475569', '#7c3aed'],
};

export function statusLabel(s: AnyStatus | string | null | undefined): string {
  if (!s) return '--';
  return STATUS_LABELS[s] || String(s);
}

export function statusTone(s: AnyStatus | string | null | undefined): string {
  if (!s) return '';
  return STATUS_TONE[s] || '';
}
