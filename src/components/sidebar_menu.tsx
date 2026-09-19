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
  Menu,
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
  X,
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
  staffOnly?: boolean;
  end?: boolean;
}

/**
 * Single source of truth for the sidebar order. Everything except the CRM
 * entry renders as a plain link; CRM renders as an expandable group (handled
 * separately in <Sidebar />) but keeps its numeric position here so the two
 * stay in sync if the order ever changes again.
 */
const NAV_ORDER: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/agencies', label: 'Agency Management', icon: Building2, adminOnly: true },
  { to: '/shipments', label: 'Shipments', icon: Truck, end: true },
  // '/crm' is rendered as the expandable group below, kept here as a placeholder
  // so its position in the list is explicit.
  { to: '/crm', label: 'CRM', icon: Contact },
  { to: '/employees', label: 'Employees', icon: Contact, staffOnly: true },
  { to: '/partners', label: 'Partners', icon: Users, adminOnly: true },
  { to: '/withdrawals', label: 'Withdrawals', icon: Wallet, adminOnly: true },
  { to: '/expenses', label: 'Expenses', icon: Receipt, adminOnly: true },
  { to: '/reports', label: 'Reports', icon: FileBarChart, adminOnly: true },
  { to: '/audit', label: 'Audit Log', icon: ClipboardList, adminOnly: true },
];

const CRM_CHILDREN: NavItem[] = [
  { to: '/crm', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/crm/customers', label: 'Customers', icon: Users },
  { to: '/crm/invoices', label: 'Invoices', icon: Receipt },
];
const EMPLOYEE_CHILDREN: NavItem[] = [
  { to: '/employees', label: 'Manage Employees', icon: Users, end: true },
  { to: '/employees/settlements', label: 'Settlements', icon: Wallet },
  { to: '/employees/slips', label: 'Employee slip generation', icon: FileBarChart },
];

const SIDEBAR_KEY = 'trizen.sidebar.collapsed';

export default function Layout() {
  const { profile, isAdmin, isEmployee, signOut, user } = useAuth();
  const data = useData();
  const location = useLocation();
  const navigate = useNavigate();

  const inCrm = location.pathname.startsWith('/crm');
  const inEmployees = location.pathname.startsWith('/employees') || location.pathname.startsWith('/my-earnings');
  const [crmOpen, setCrmOpen] = useState(inCrm);
  const [employeesOpen, setEmployeesOpen] = useState(inEmployees);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1');
  const [searchOpen, setSearchOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (inCrm) setCrmOpen(true);
  }, [inCrm]);
  useEffect(() => { if (inEmployees) setEmployeesOpen(true); }, [inEmployees]);

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
    setMobileMenuOpen(false);
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
        employeesOpen={employeesOpen}
        inEmployees={inEmployees}
        isAdmin={isAdmin}
        isEmployee={isEmployee}
        criticalCount={criticalCount}
        onToggleCrm={() => (collapsed || window.matchMedia('(max-width: 600px)').matches ? navigate('/crm') : setCrmOpen((open) => !open))}
        onToggleEmployees={() => (collapsed || window.matchMedia('(max-width: 600px)').matches ? navigate('/employees') : setEmployeesOpen((open) => !open))}
        onToggleSidebar={() => setCollapsed((value) => !value)}
        mobileMenuOpen={mobileMenuOpen}
        onCloseMobileMenu={() => setMobileMenuOpen(false)}
        visible={visible}
      />
      {mobileMenuOpen && <button type="button" className="mobile-sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)} />}

      <div className="workspace">
        <header className="topbar">
        <button type="button" className="icon-btn mobile-menu-btn" onClick={() => setMobileMenuOpen((open) => !open)} aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}>
          <Menu size={19} />
        </button>
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
                {!isEmployee && <button onClick={() => navigate('/expenses')}>
                  <Receipt size={14} /> New expense
                </button>}
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
                <span className="role">{isAdmin ? 'Administrator' : isEmployee ? 'Employee' : 'User'}</span>
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
  employeesOpen,
  inEmployees,
  isAdmin,
  isEmployee,
  criticalCount,
  onToggleCrm,
  onToggleEmployees,
  onToggleSidebar,
  mobileMenuOpen,
  onCloseMobileMenu,
  visible,
}: {
  collapsed: boolean;
  crmOpen: boolean;
  inCrm: boolean;
  employeesOpen: boolean;
  inEmployees: boolean;
  isAdmin: boolean;
  isEmployee: boolean;
  criticalCount: number;
  onToggleCrm: () => void;
  onToggleEmployees: () => void;
  onToggleSidebar: () => void;
  mobileMenuOpen: boolean;
  onCloseMobileMenu: () => void;
  visible: (item: NavItem) => boolean;
}) {
  const { theme, toggle } = useTheme();
  const [mobileSubmenu, setMobileSubmenu] = useState<'crm' | 'employees' | null>(null);
  const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined);
  const mobile = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 600px)').matches;
  const employeeChildren = isEmployee
    ? [{ to: '/employees/settlements', label: 'Settlements', icon: Wallet }, { to: '/employees/slips', label: 'Paid slips', icon: FileBarChart }]
    : EMPLOYEE_CHILDREN;
  const closeMobileSubmenu = () => setMobileSubmenu(null);

  useEffect(() => {
    if (!mobileMenuOpen) setMobileSubmenu(null);
  }, [mobileMenuOpen]);

  return (
    <aside className={mobileMenuOpen ? 'sidebar mobile-open' : 'sidebar'}>
      {/* The logo is the sidebar toggle — there's no separate burger button. */}
      <button
        type="button"
        className="sidebar-brand"
        onClick={() => { closeMobileSubmenu(); if (mobile()) onCloseMobileMenu(); else onToggleSidebar(); }}
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
        {NAV_ORDER.filter((item) => visible(item) && (!item.staffOnly || isAdmin || isEmployee)).map((item) => {
          // The CRM slot renders as an expandable group instead of a plain link.
          if (item.to === '/crm') {
            return (
              <div key="crm-group" className="nav-group-wrap">
                <button
                  type="button"
                  className={inCrm ? 'nav-group active' : 'nav-group'}
                  onClick={() => mobile() ? setMobileSubmenu((current) => current === 'crm' ? null : 'crm') : onToggleCrm()}
                  aria-expanded={mobile() ? mobileSubmenu === 'crm' : crmOpen}
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
                        <NavLink key={child.to} to={child.to} end={child.end} className={linkClass} onClick={onCloseMobileMenu}>
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          if (item.to === '/employees') {
            return <div key="employees-group" className="nav-group-wrap"><button type="button" className={inEmployees ? 'nav-group active' : 'nav-group'} onClick={() => mobile() ? setMobileSubmenu((current) => current === 'employees' ? null : 'employees') : onToggleEmployees()} aria-expanded={mobile() ? mobileSubmenu === 'employees' : employeesOpen} title={collapsed ? (isEmployee ? 'My Earnings' : 'Employees') : undefined}><Contact size={17} /><span className="nav-text nav-group-label">{isEmployee ? 'My Earnings' : 'Employees'}</span>{!collapsed && (employeesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}</button>{employeesOpen && !collapsed && <div className="nav-children">{employeeChildren.map((child) => <NavLink key={child.to} to={child.to} end={child.end} className={linkClass} onClick={onCloseMobileMenu}>{child.label}</NavLink>)}</div>}</div>;
          }

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              className={linkClass}
              onClick={() => { closeMobileSubmenu(); onCloseMobileMenu(); }}
            >
              <item.icon size={17} />
              <span className="nav-text">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {mobileSubmenu && (
        <>
          <button type="button" className="mobile-submenu-backdrop" aria-label="Close menu" onClick={closeMobileSubmenu} />
          <div className="mobile-submenu" role="menu">
            <div className="mobile-submenu-head">
              <strong>{mobileSubmenu === 'crm' ? 'CRM' : isEmployee ? 'My Earnings' : 'Employees'}</strong>
              <button type="button" className="icon-btn" onClick={closeMobileSubmenu} aria-label="Close submenu"><X size={16} /></button>
            </div>
            {(mobileSubmenu === 'crm' ? CRM_CHILDREN : employeeChildren).map((child) => {
              const Icon = child.icon;
              return <NavLink key={child.to} to={child.to} end={child.end} className={linkClass} role="menuitem" onClick={() => { closeMobileSubmenu(); onCloseMobileMenu(); }}><Icon size={16} /><span>{child.label}</span></NavLink>;
            })}
          </div>
        </>
      )}

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
      agencies: 'Agency Management',
      employees: 'Employees',
      settlements: 'Settlements',
      slips: 'Employee Slip Generation',
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
