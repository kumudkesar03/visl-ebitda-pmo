export type Role = 'admin' | 'visl_pmo' | 'visl_exec' | 'bu_pmo' | 'owner' | 'contributor' | 'viewer';
export type InitiativeStatus = 'not_started' | 'in_progress' | 'at_risk' | 'on_hold' | 'completed' | 'cancelled';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'review' | 'done' | 'cancelled';
export type ActualStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type Health = 'green' | 'amber' | 'red';
export type ApprovalMode = 'local' | 'central' | 'visl';

/**
 * A percentage that carries the window it was computed over.
 *
 * The server never returns a bare number for a ratio, and the UI never renders
 * one without its basis. This is the type-level half of the fix for the
 * 396.8% defect: you cannot display an achievement figure here without also
 * having the label that says what it is achievement against.
 */
export interface Ratio {
  pct: number | null;
  numerator: number;
  denominator: number;
  basis: string;
  window: string;
}

export interface BusinessUnit {
  code: string;
  name: string;
  shortName?: string;
  short_name?: string;
  parent?: string | null;
  parent_code?: string | null;
  consolidated?: boolean;
  is_consolidated?: boolean;
  depth: number;
  accent: string;
  leaves?: string[];
}

export interface Window {
  all: string[];
  closed: string[];
  open: string[];
  first: string | null;
  last: string | null;
  closedThrough: string | null;
  closedCount: number;
  totalCount: number;
  label: string;
}

export interface MonthPoint {
  period: string;
  label: string;
  plan_cr: number;
  actual_cr: number;
  booked_cr: number;
  submitted_cr: number;
  rejected_cr: number;
  variance_cr: number;
  cum_plan_cr: number;
  cum_booked_cr: number;
  cum_variance_cr: number;
  entries: number;
}

export interface Headline {
  target_cr: number;
  plan_fy_cr: number;
  plan_ptd_cr: number;
  booked_ptd_cr: number;
  booked_fy_cr: number;
  submitted_cr: number;
  open_plan_cr: number;
  variance_ptd_cr: number;
  gap_to_target_cr: number;
  forecast_fy_cr: number;
  achievement_ptd: Ratio;
  target_delivered: Ratio;
  plan_coverage: Ratio;
  forecast_vs_target: Ratio;
  elapsed_share: Ratio;
  initiative_count: number;
  status_counts: Record<string, number>;
  health_counts: Record<string, number>;
}

export interface UnitSummary {
  code: string;
  name: string;
  accent?: string;
  depth?: number;
  is_consolidated?: boolean;
  initiative_count: number;
  target_cr: number;
  plan_fy_cr: number;
  plan_ptd_cr: number;
  booked_ptd_cr: number;
  booked_fy_cr: number;
  submitted_cr: number;
  variance_ptd_cr: number;
  achievement_pct: number | null;
  target_delivered_pct: number | null;
  health_counts: Record<string, number>;
}

export interface Initiative {
  id: number;
  code: string;
  title: string;
  description: string | null;
  bu_code: string;
  department_id: number | null;
  department_name: string | null;
  owner_id: number | null;
  owner_name: string | null;
  category: string;
  category_name: string | null;
  status: InitiativeStatus;
  priority: Priority;
  health: Health;
  health_computed: Health;
  progress_pct: number;
  target_savings_cr: number;
  start_date: string | null;
  due_date: string | null;
  plan_fy_cr: number;
  plan_ptd_cr: number;
  booked_ptd_cr: number;
  booked_fy_cr: number;
  submitted_cr: number;
  variance_ptd_cr: number;
  achievement_ptd: Ratio;
  target_delivered: Ratio;
  task_count: number;
  task_done: number;
  task_overdue: number;
  open_risks: number;
}

export interface InitiativeMonth {
  id: number;
  initiative_id: number;
  period: string;
  label?: string;
  plan_cr: number;
  actual_cr: number | null;
  actual_status: ActualStatus;
  remarks: string | null;
  submitted_by: number | null;
  submitted_at: string | null;
  approved_by: number | null;
  approved_at: string | null;
  rejection_note: string | null;
}

export interface Task {
  id: number;
  initiative_id: number;
  code: string | null;
  title: string;
  assignee_id: number | null;
  assignee_name: string | null;
  status: TaskStatus;
  priority: Priority;
  progress_pct: number;
  planned_start: string | null;
  planned_end: string | null;
  estimated_savings_cr: number;
  initiative_code?: string;
  initiative_title?: string;
  is_overdue?: boolean;
}

export interface Milestone {
  id: number;
  initiative_id: number;
  title: string;
  due_date: string | null;
  completed_at: string | null;
  status: 'open' | 'achieved' | 'missed' | 'cancelled';
  sort_order: number;
}

export interface Risk {
  id: number;
  initiative_id: number;
  title: string;
  description: string | null;
  impact: 'low' | 'medium' | 'high';
  likelihood: 'low' | 'medium' | 'high';
  mitigation: string | null;
  status: 'open' | 'mitigating' | 'closed' | 'accepted';
  due_date: string | null;
}

export interface Comment {
  id: number;
  entity_type: string;
  entity_id: number;
  user_id: number;
  user_name: string;
  body: string;
  created_at: string;
}

export interface InitiativeDetail extends Initiative {
  series: MonthPoint[];
  months: InitiativeMonth[];
  tasks: Task[];
  milestones: Milestone[];
  risks: Risk[];
  comments: Comment[];
}

export interface AbilityFlags {
  edit: boolean;
  editPlan: boolean;
  bookActual: boolean;
  approve: boolean;
  manageTasks: boolean;
  comment: boolean;
}

export interface ApprovalRow extends InitiativeMonth {
  label: string;
  initiative_code: string;
  initiative_title: string;
  bu_code: string;
  owner_name: string | null;
  department_name: string | null;
  submitted_by_name: string | null;
  variance_cr: number;
  variance_pct: number | null;
  can_approve: boolean;
  blocked_reason: string | null;
}

export interface User {
  id: number;
  employee_id: string;
  name: string;
  email: string;
  role: Role;
  home_bu: string;
  designation: string | null;
  is_active: boolean;
  last_login: string | null;
  role_label?: string;
  sees?: string[];
  can_write?: string[];
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface Session {
  user: User;
  role: { label: string; description: string; rank: number; global: boolean; readOnly?: boolean };
  permissions: string[];
  scope: string[];
  writeScope: string[];
  businessUnits: BusinessUnit[];
  settings: {
    fy_label: string;
    closed_through: string;
    submission_period: string;
    approval_mode: ApprovalMode;
    dataset_kind: string;
  };
  unreadNotifications: number;
  pendingApprovals: number;
  dataMode: 'synthetic' | 'mssql';
}
