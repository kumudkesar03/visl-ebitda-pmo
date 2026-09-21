import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Icon } from './Icons';
import { UnitStrip } from './BuPicker';
import { initials } from '../lib/format';
import { ROLE_LABELS } from '../lib/vocabulary';
import { api } from '../lib/api';

/**
 * The authenticated shell: a brand bar across the top, grouped menus, and -
 * on screens that report by business unit - the unit strip beneath it.
 *
 * Navigation is filtered by PERMISSION, not by role name. A menu built from a
 * role list drifts the moment a role gains a capability; building it from the
 * same permission strings the server enforces means the menu and the API
 * cannot disagree about what someone is allowed to do.
 */

interface NavItem {
  path: string;
  label: string;
  icon: string;
  hint: string;
  needs?: string;
  badge?: 'approvals';
  hideFor?: string[];
}

interface NavGroup {
  label: string;
  needs?: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: 'Position',
    items: [
      { path: '/exec', label: 'Executive board', icon: 'exec', hint: 'Where the full-year target stands', needs: 'exec:view' },
      { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', hint: 'Delivery against plan, by unit' },
      { path: '/matrix', label: 'Savings matrix', icon: 'matrix', hint: 'Every initiative, month by month' },
      { path: '/leaderboard', label: 'Performance', icon: 'leaderboard', hint: 'Owners and departments ranked' },
    ],
  },
  {
    label: 'Delivery',
    items: [
      { path: '/my-work', label: 'My work', icon: 'mywork', hint: 'This month\'s submissions and tasks', hideFor: ['visl_exec'] },
      { path: '/initiatives', label: 'Initiatives', icon: 'initiatives', hint: 'The register of every lever' },
      { path: '/tasks', label: 'Tasks', icon: 'tasks', hint: 'Actions behind the initiatives' },
    ],
  },
  {
    label: 'Governance',
    needs: 'actual:approve',
    items: [
      { path: '/approvals', label: 'Approvals', icon: 'approvals', hint: 'Actuals awaiting a decision', needs: 'actual:approve', badge: 'approvals' },
      { path: '/audit', label: 'Audit trail', icon: 'audit', hint: 'Who changed what, and when', needs: 'audit:view' },
    ],
  },
  {
    label: 'Administration',
    needs: 'user:manage',
    items: [
      { path: '/admin/users', label: 'Users & roles', icon: 'users', hint: 'Accounts, roles, home units', needs: 'user:manage' },
      { path: '/admin/access', label: 'Access model', icon: 'shield', hint: 'Permissions and approval policy', needs: 'user:manage' },
      { path: '/admin/mail', label: 'Mail outbox', icon: 'mail', hint: 'Every message, before it is sent', needs: 'mail:manage' },
      { path: '/admin/settings', label: 'System', icon: 'system', hint: 'Reporting calendar and policy', needs: 'settings:manage' },
    ],
  },
];

/** Screens whose figures depend on the selected business unit. */
const UNIT_SCOPED = ['/exec', '/dashboard', '/matrix', '/leaderboard', '/initiatives', '/tasks'];

function useVisibleNav(): NavGroup[] {
  const { session, can } = useApp();
  return NAV
    .filter((g) => !g.needs || can(g.needs))
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => (!i.needs || can(i.needs)) && !(i.hideFor || []).includes(session.user.role)),
    }))
    .filter((g) => g.items.length > 0);
}

function groupIsActive(group: NavGroup, pathname: string) {
  return group.items.some((i) => pathname === i.path || pathname.startsWith(`${i.path}/`));
}

function TopBar() {
  const { session } = useApp();
  const groups = useVisibleNav();
  const { pathname } = useLocation();
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // Close any open menu on navigation and on a click anywhere else.
  useEffect(() => { setOpen(null); setMobile(false); }, [pathname]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) { setOpen(null); setMobile(false); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); setMobile(false); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  const badgeFor = (item: NavItem) => (item.badge === 'approvals' && session.pendingApprovals > 0 ? session.pendingApprovals : 0);

  return (
    <div className="topbar" ref={barRef}>
      <div className="topbar-inner">
        <NavLink to="/" className="brand" aria-label="Home">
          <img className="brand-full" src="/img/visl-logo-color.png" alt="Vedanta Iron &amp; Steel" />
          <img className="brand-mark" src="/img/visl-mark.png" alt="Vedanta Iron &amp; Steel" />
          <span className="brand-product">EBITDA Drive</span>
        </NavLink>

        <button className="menu-toggle icon-btn" onClick={() => setMobile((m) => !m)} aria-label="Menu" aria-expanded={mobile}>
          <Icon name={mobile ? 'x' : 'menu'} />
        </button>

        <nav className={`topnav ${mobile ? 'open' : ''}`}>
          {groups.map((g) => {
            const badge = g.items.reduce((a, i) => a + badgeFor(i), 0);
            const isOpen = open === g.label;
            return (
              <div className={`topnav-group ${isOpen ? 'open' : ''}`} key={g.label}>
                <button
                  type="button"
                  className={`topnav-btn ${groupIsActive(g, pathname) ? 'active' : ''}`}
                  onClick={() => setOpen(isOpen ? null : g.label)}
                  aria-expanded={isOpen}
                >
                  {g.label}
                  {badge > 0 && <span className="count-pill">{badge}</span>}
                  <Icon name="chevronDown" className="chev" />
                </button>
                <div className="menu" role="menu" data-label={g.label}>
                  {g.items.map((i) => (
                    <NavLink to={i.path} key={i.path} role="menuitem" className={({ isActive }) => `menu-item ${isActive ? 'active' : ''}`}>
                      <span className="menu-icon"><Icon name={i.icon} /></span>
                      <span className="grow">
                        <span className="menu-label">{i.label}</span>
                        <span className="menu-hint">{i.hint}</span>
                      </span>
                      {badgeFor(i) > 0 && <span className="count-pill">{badgeFor(i)}</span>}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <UserMenu />
      </div>
    </div>
  );
}

function UserMenu() {
  const { session } = useApp();

  const signOut = async () => {
    await api.post('/auth/logout');
    window.location.href = '/login';
  };

  return (
    <div className="user-menu">
      <NavLink to="/notifications" className="icon-btn bell" title="Notifications">
        <Icon name="bell" />
        {session.unreadNotifications > 0 && (
          <span className="bell-count">{session.unreadNotifications > 99 ? '99+' : session.unreadNotifications}</span>
        )}
      </NavLink>
      <div className="user-chip">
        <span className="avatar">{initials(session.user.name)}</span>
        <span className="user-text">
          <span className="user-name">{session.user.name}</span>
          <span className="user-role">{ROLE_LABELS[session.user.role]} · {session.user.home_bu}</span>
        </span>
      </div>
      <button className="icon-btn" onClick={signOut} title="Sign out">
        <Icon name="logout" />
      </button>
    </div>
  );
}

export function Shell() {
  const { pathname } = useLocation();
  const scoped = UNIT_SCOPED.some((p) => pathname === p);
  return (
    <div className="shell">
      <TopBar />
      {scoped && <UnitStrip />}
      <main className="main">
        <Outlet />
      </main>
      <footer className="app-foot no-print">
        <span>Vedanta Iron &amp; Steel · EBITDA Drive PMO</span>
        <span>Savings count only once approved · access scoped to your business unit</span>
      </footer>
    </div>
  );
}

/** Which menu group the current screen belongs to - shown above its title. */
function useSection(): string | null {
  const { pathname } = useLocation();
  for (const g of NAV) {
    if (groupIsActive(g, pathname)) return g.label;
  }
  if (pathname.startsWith('/notifications')) return 'Inbox';
  return null;
}

/** Page header. Each page supplies its own title and controls. */
export function PageHeader({ title, subtitle, children }: {
  title: string; subtitle?: React.ReactNode; children?: React.ReactNode;
}) {
  const section = useSection();
  return (
    <header className="page-head">
      <div className="grow" style={{ minWidth: 0 }}>
        {section && <div className="eyebrow">{section}</div>}
        <h1>{title}</h1>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

/**
 * Shown on every screen while the dataset is synthetic.
 *
 * Illustrative figures must never be mistaken for reported business result,
 * and a footnote will not survive a screenshot pasted into a deck. This banner
 * sits above the content, not below it.
 */
export function SyntheticBanner() {
  const { session } = useApp();
  if (session.dataMode !== 'synthetic') return null;
  return (
    <div className="synthetic-banner">
      <span className="tag">Illustrative data</span>
      <span>
        Every figure on this screen is synthetic, generated for design review, and is not reported business result.
      </span>
    </div>
  );
}
