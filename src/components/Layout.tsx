import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Contact,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Receipt,
  Search,
  Settings as SettingsIcon,
  Sun,
  Truck,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useTheme } from '@/context/ThemeContext';
import { computeNotifications, type Notification } from '@/domain/notifications';
import { initialsOf } from '@/lib/avatar';
import { LogoMark } from './Logo';
import GlobalSearch from './GlobalSearch';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  end?: boolean;
}

const TOP_LEVEL: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/shipments', label: 'Shipments', icon: Truck, end: true },
];

const CRM_CHILDREN: NavItem[] = [
  { to: '/crm', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/crm/customers', label: 'Customers', icon: Users },
  { to: '/crm/invoices', label: 'Invoices', icon: Receipt },
];

const REST: NavItem[] = [
  { to: '/expenses', label: 'Expenses', icon: Receipt },
  { to: '/withdrawals', label: 'Withdrawals', icon: Wallet },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
  { to: '/agencies', label: 'Agencies', icon: Building2, adminOnly: true },
  { to: '/partners', label: 'Partners', icon: Users, adminOnly: true },
  { to: '/audit', label: 'Audit Log', icon: ClipboardList, adminOnly: true },
];

const SIDEBAR_KEY = 'trizen.sidebar.collapsed';

export default function Layout() {
  const { profile, isAdmin, signOut, user } = useAuth();
  const data = useData();
  const location = useLocation();
  const navigate = useNavigate();

  const inCrm = location.pathname.startsWith('/crm');
  const [crmOpen, setCrmOpen] = useState(inCrm);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1');
  const [searchOpen, setSearchOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  useEffect(() => {
    if (inCrm) setCrmOpen(true);
  }, [inCrm]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Ctrl+K / Cmd+K opens search from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Any navigation closes the transient menus.
  useEffect(() => {
    setBellOpen(false);
    setQuickOpen(false);
    setUserOpen(false);
  }, [location.pathname]);

  const notifications = useMemo<Notification[]>(() => {
    if (data.loading) return [];
    return computeNotifications(
      {
        shipments: data.shipments,
        agencies: data.agencies,
        partners: data.partners,
        expenses: data.expenses,
        withdrawals: data.withdrawals,
      },
      data.customers,
    );
  }, [data]);

  const criticalCount = notifications.filter((n) => n.severity === 'critical').length;
  const breadcrumbs = useBreadcrumbs();
  const visible = (item: NavItem) => !item.adminOnly || isAdmin;

  return (
    <div className={collapsed ? 'app-shell collapsed' : 'app-shell'}>
      <Sidebar
        collapsed={collapsed}
        crmOpen={crmOpen}
        inCrm={inCrm}
        isAdmin={isAdmin}
        criticalCount={criticalCount}
        onToggleCrm={() => (collapsed ? navigate('/crm') : setCrmOpen((open) => !open))}
        onToggleSidebar={() => setCollapsed((value) => !value)}
        visible={visible}
      />

      <div className="workspace">
        <header className="topbar">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb.to}>
              {index > 0 && <ChevronRight size={13} className="crumb-sep" />}
              {index === breadcrumbs.length - 1 ? (
                <span aria-current="page">{crumb.label}</span>
              ) : (
                <Link to={crumb.to}>{crumb.label}</Link>
              )}
            </span>
          ))}
        </nav>

        <button className="topbar-search" onClick={() => setSearchOpen(true)}>
          <Search size={15} />
          <span>Search…</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="topbar-actions">
          <div className="menu-anchor">
            <button className="btn primary small" onClick={() => setQuickOpen((v) => !v)}>
              <Plus size={15} />
              New
              <ChevronDown size={13} />
            </button>
            {quickOpen && (
              <div className="dropdown" onMouseLeave={() => setQuickOpen(false)}>
                <button onClick={() => navigate('/shipments/new')}>
                  <Truck size={14} /> New shipment
                </button>
                <button onClick={() => navigate('/crm/customers/new')}>
                  <Contact size={14} /> New customer
                </button>
                <button onClick={() => navigate('/expenses')}>
                  <Receipt size={14} /> New expense
                </button>
                {isAdmin && (
                  <button onClick={() => navigate('/withdrawals')}>
                    <Wallet size={14} /> Record withdrawal
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="menu-anchor">
            <button
              className="icon-btn"
              onClick={() => setBellOpen((v) => !v)}
              aria-label={`Notifications (${notifications.length})`}
            >
              <Bell size={18} />
              {notifications.length > 0 && (
                <span className={criticalCount > 0 ? 'bell-dot critical' : 'bell-dot'}>
                  {notifications.length}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="dropdown wide" onMouseLeave={() => setBellOpen(false)}>
                <div className="dropdown-title">Needs attention</div>
                {notifications.length === 0 && (
                  <p className="dropdown-empty">Nothing needs attention right now.</p>
                )}
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    className="notification"
                    onClick={() => navigate(notification.link)}
                  >
                    <span className={`dot ${notification.severity}`} />
                    <span>
                      <strong>{notification.title}</strong>
                      <span className="muted">{notification.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="menu-anchor">
            <button
              className="topbar-identity"
              onClick={() => setUserOpen((value) => !value)}
              aria-label="Account menu"
            >
              <span className="topbar-avatar">
                {profile?.photo ? (
                  <img src={profile.photo} alt="" />
                ) : (
                  initialsOf(profile?.name ?? '', user?.email ?? '')
                )}
              </span>
              <span className="topbar-user">
                <span className="who">{profile?.name ?? user?.email}</span>
                <span className="role">{isAdmin ? 'Administrator' : 'User'}</span>
              </span>
              <ChevronDown size={13} />
            </button>
            {userOpen && (
              <div className="dropdown" onMouseLeave={() => setUserOpen(false)}>
                <button onClick={() => navigate('/profile')}>
                  <UserRound size={14} /> My profile
                </button>
                {isAdmin && (
                  <button onClick={() => navigate('/settings')}>
                    <SettingsIcon size={14} /> Settings
                  </button>
                )}
                <button onClick={() => void signOut()}>
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
        </header>

        <main className="main">
          <Outlet />
        </main>
      </div>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

function Sidebar({
  collapsed,
  crmOpen,
  inCrm,
  isAdmin,
  criticalCount,
  onToggleCrm,
  onToggleSidebar,
  visible,
}: {
  collapsed: boolean;
  crmOpen: boolean;
  inCrm: boolean;
  isAdmin: boolean;
  criticalCount: number;
  onToggleCrm: () => void;
  onToggleSidebar: () => void;
  visible: (item: NavItem) => boolean;
}) {
  const { theme, toggle } = useTheme();
  const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined);

  return (
    <aside className="sidebar">
      {/* The logo is the sidebar toggle — there's no separate burger button. */}
      <button
        type="button"
        className="sidebar-brand"
        onClick={onToggleSidebar}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
        title={collapsed ? 'Expand menu' : 'Collapse menu'}
      >
        {/* The logo sits directly on the sidebar; its lighter navy gradient
            provides the contrast without a separate card. */}
        <span className="sidebar-logo">
          <LogoMark size={collapsed ? 46 : 64} />
        </span>
        {!collapsed && (
          <span className="sidebar-brand-text">
            <strong>TRIZEN</strong>
            <span>Global</span>
          </span>
        )}
      </button>

      <nav className="sidebar-nav">
        {TOP_LEVEL.filter(visible).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={collapsed ? item.label : undefined}
            className={linkClass}
          >
            <item.icon size={17} />
            <span className="nav-text">{item.label}</span>
          </NavLink>
        ))}

        <button
          type="button"
          className={inCrm ? 'nav-group active' : 'nav-group'}
          onClick={onToggleCrm}
          aria-expanded={crmOpen}
          title={collapsed ? 'CRM' : undefined}
        >
          <Contact size={17} />
          <span className="nav-text nav-group-label">CRM</span>
          {!collapsed && criticalCount > 0 && (
            <span className="nav-badge danger">{criticalCount}</span>
          )}
          {!collapsed && (crmOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
        </button>

        {crmOpen && !collapsed && (
          <div className="nav-children">
            {CRM_CHILDREN.map((child) => (
              <NavLink key={child.to} to={child.to} end={child.end} className={linkClass}>
                {child.label}
              </NavLink>
            ))}
          </div>
        )}

        {REST.filter(visible)
          .filter((item) => !item.adminOnly || isAdmin)
          .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              className={linkClass}
            >
              <item.icon size={17} />
              <span className="nav-text">{item.label}</span>
            </NavLink>
          ))}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="theme-switch"
          data-theme={theme}
          onClick={toggle}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
          <span className="switch-label">{theme === 'dark' ? 'Dark' : 'Light'} mode</span>
          <span className="switch-track">
            <span className="switch-knob" />
          </span>
        </button>
      </div>
    </aside>
  );
}

interface Crumb {
  label: string;
  to: string;
}

/**
 * Builds the trail from the URL, swapping record ids for their real names so a
 * customer page reads "CRM › Customers › Acme Foods" rather than a Firestore id.
 */
function useBreadcrumbs(): Crumb[] {
  const location = useLocation();
  const data = useData();

  return useMemo(() => {
    const segments = location.pathname.split('/').filter(Boolean);
    const crumbs: Crumb[] = [{ label: 'Dashboard', to: '/' }];
    if (segments.length === 0) return crumbs;

    const labels: Record<string, string> = {
      shipments: 'Shipments',
      crm: 'CRM',
      customers: 'Customers',
      new: 'New',
      outstanding: 'Outstanding Invoices',
      'due-soon': 'Due Soon',
      overdue: 'Overdue Invoices',
      reports: 'Reports',
      expenses: 'Expenses',
      withdrawals: 'Withdrawals',
      agencies: 'Agencies',
      partners: 'Partners',
      audit: 'Audit Log',
      invoices: 'Invoices',
      settings: 'Settings',
      profile: 'My Profile',
    };

    let path = '';
    segments.forEach((segment, index) => {
      path += `/${segment}`;
      const known = labels[segment];
      if (known) {
        crumbs.push({ label: known, to: path });
        return;
      }

      // An unrecognised segment is a record id — resolve it to something human.
      const previous = segments[index - 1];
      if (previous === 'customers') {
        const customer = data.customers.find((row) => row.id === segment);
        crumbs.push({ label: customer?.companyName ?? 'Customer', to: path });
      } else if (previous === 'shipments') {
        const shipment = data.shipments.find((row) => row.id === segment);
        crumbs.push({ label: shipment?.loadNumber || 'Load', to: path });
      } else {
        crumbs.push({ label: segment, to: path });
      }
    });

    return crumbs;
  }, [location.pathname, data.customers, data.shipments]);
}
