import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Icon } from './Icons';
import { initials } from '../lib/format';
import { ROLE_LABELS } from '../lib/vocabulary';
import { api } from '../lib/api';

/**
 * The authenticated shell.
 *
 * Navigation is filtered by PERMISSION, not by role name. A menu built from a
 * role list drifts the moment a role gains a capability; building it from the
 * same permission strings the server enforces means the sidebar and the API
 * cannot disagree about what someone is allowed to do.
 */

interface NavItem {
  section?: string;
  path?: string;
  label?: string;
  icon?: string;
  needs?: string;
  badge?: 'approvals' | 'mywork';
  hideFor?: string[];
}

const NAV: NavItem[] = [
  { section: 'Position' },
  { path: '/exec', label: 'Executive board', icon: 'exec', needs: 'exec:view' },
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { path: '/matrix', label: 'Savings matrix', icon: 'matrix' },
  { path: '/leaderboard', label: 'Performance', icon: 'leaderboard' },

  { section: 'Delivery' },
  { path: '/my-work', label: 'My work', icon: 'mywork', badge: 'mywork', hideFor: ['visl_exec'] },
  { path: '/initiatives', label: 'Initiatives', icon: 'initiatives' },
  { path: '/tasks', label: 'Tasks', icon: 'tasks' },

  { section: 'Governance', needs: 'actual:approve' },
  { path: '/approvals', label: 'Approvals', icon: 'approvals', needs: 'actual:approve', badge: 'approvals' },
  { path: '/audit', label: 'Audit trail', icon: 'audit', needs: 'audit:view' },

  { section: 'Administration', needs: 'user:manage' },
  { path: '/admin/users', label: 'Users & roles', icon: 'users', needs: 'user:manage' },
  { path: '/admin/access', label: 'Access model', icon: 'shield', needs: 'user:manage' },
  { path: '/admin/mail', label: 'Mail outbox', icon: 'mail', needs: 'mail:manage' },
  { path: '/admin/settings', label: 'System', icon: 'system', needs: 'settings:manage' },
];

function Sidebar() {
  const { session, can } = useApp();

  const items = NAV.filter((item) => {
    if (item.needs && !can(item.needs)) return false;
    if (item.hideFor && item.hideFor.includes(session.user.role)) return false;
    return true;
  });

  // Drop a section heading whose entire group was filtered away, so a viewer
  // never sees an empty "Governance" label with nothing beneath it.
  const cleaned = items.filter((item, idx) => {
    if (!item.section) return true;
    const next = items[idx + 1];
    return !!next && !next.section;
  });

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="/img/logo-white.png" alt="Vedanta Iron &amp; Steel" />
        <div>
          <div className="bt">EBITDA Drive</div>
          <div className="bs">VISL PMO</div>
        </div>
      </div>

      <nav className="nav">
        {cleaned.map((item, i) => {
          if (item.section) return <div className="nav-label" key={`s-${i}`}>{item.section}</div>;
          return (
            <NavLink to={item.path!} key={item.path} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={item.icon!} />
              <span className="grow">{item.label}</span>
              {item.badge === 'approvals' && session.pendingApprovals > 0 && (
                <span className="nav-badge">{session.pendingApprovals}</span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div>{session.settings.fy_label}</div>
        <div style={{ marginTop: 2 }}>
          Closed through {session.settings.closed_through
            ? new Date(session.settings.closed_through).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
            : '--'}
        </div>
      </div>
    </aside>
  );
}

function UserMenu() {
  const { session } = useApp();

  const signOut = async () => {
    await api.post('/auth/logout');
    window.location.href = '/login';
  };

  return (
    <div className="row gap-8">
      <NavLink to="/notifications" className="btn btn-outline btn-sm" title="Notifications" style={{ position: 'relative', padding: '6px 9px' }}>
        <Icon name="bell" />
        {session.unreadNotifications > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5, background: 'var(--red-600)', color: '#fff',
            borderRadius: 20, fontSize: 10, fontWeight: 700, padding: '1px 5px', minWidth: 17, textAlign: 'center',
          }}>
            {session.unreadNotifications > 99 ? '99+' : session.unreadNotifications}
          </span>
        )}
      </NavLink>

      <div className="row gap-8" style={{ paddingLeft: 10, borderLeft: '1px solid var(--ink-200)' }}>
        <div style={{
          width: 31, height: 31, borderRadius: '50%', background: 'var(--navy-800)', color: '#fff',
          display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 700, flex: '0 0 31px',
        }}>
          {initials(session.user.name)}
        </div>
        <div style={{ lineHeight: 1.25 }}>
          <div style={{ fontSize: 12.5, fontWeight: 620 }}>{session.user.name}</div>
          <div className="tiny muted">
            {ROLE_LABELS[session.user.role]} · {session.user.home_bu}
          </div>
        </div>
        <button className="icon-btn" onClick={signOut} title="Sign out" style={{ marginLeft: 2 }}>
          <Icon name="logout" />
        </button>
      </div>
    </div>
  );
}

export function Shell() {
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}

/** Page header. Each page supplies its own title and controls. */
export function PageHeader({ title, subtitle, children }: {
  title: string; subtitle?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <header className="header">
      <div className="grow">
        <h1>{title}</h1>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
      {children}
      <UserMenu />
    </header>
  );
}

/**
 * Shown on every screen while the dataset is synthetic.
 *
 * text.txt is emphatic that illustrative figures must never be mistaken for
 * reported business result, and a footnote will not survive a screenshot
 * pasted into a deck. This banner sits above the content, not below it.
 */
export function SyntheticBanner() {
  const { session } = useApp();
  if (session.dataMode !== 'synthetic') return null;
  return (
    <div className="synthetic-banner">
      <Icon name="alert" />
      <span>
        <b>ILLUSTRATIVE DATA.</b> Every figure on this screen is synthetic and generated for design review.
        It is not reported business result. Connect the database in <code>.env</code> to load real figures.
      </span>
    </div>
  );
}
