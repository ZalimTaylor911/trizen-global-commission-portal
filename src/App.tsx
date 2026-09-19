import { useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { isFirebaseConfigured } from './firebase/config';
import Layout from './components/sidebar_menu';
import SplashScreen from './components/SplashScreen';
import { Spinner } from './components/ui';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Shipments from './pages/Shipments';
import ShipmentDetail from './pages/ShipmentDetail';
import Agencies from './pages/Agencies';
import Partners from './pages/Partners';
import Employees from './pages/Employees';
import EmployeeSettlements from './pages/EmployeeSettlements';
import Expenses from './pages/Expenses';
import Withdrawals from './pages/Withdrawals';
import Reports from './pages/Reports';
import AuditLog from './pages/AuditLog';
import NoProfile from './pages/NoProfile';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import CrmDashboard from './pages/crm/CrmDashboard';
import CustomerList from './pages/crm/CustomerList';
import CustomerProfile from './pages/crm/CustomerProfile';
import Invoices from './pages/crm/Invoices';

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

function AdminOrEmployee({ children }: { children: React.ReactNode }) {
  const { isAdmin, isEmployee } = useAuth();
  return isAdmin || isEmployee ? <>{children}</> : <Navigate to="/" replace />;
}

function Shell() {
  const { user, loading, profileMissing } = useAuth();
  const [splashVisible, setSplashVisible] = useState(true);
  const splashTimer = useRef<number | null>(null);
  const splashCycle = useRef(0);
  const splashStarted = useRef(false);

  useEffect(() => {
    if (!loading) {
      splashStarted.current = false;
      return;
    }

    // Firebase can move through several loading states. Start one timer for
    // the whole connection cycle instead of restarting it for each state.
    if (splashStarted.current) return;

    splashStarted.current = true;
    setSplashVisible(true);
    const cycle = splashCycle.current + 1;
    splashCycle.current = cycle;
    if (splashTimer.current !== null) window.clearTimeout(splashTimer.current);
    splashTimer.current = window.setTimeout(() => {
      if (splashCycle.current === cycle) setSplashVisible(false);
    }, 15000);
  }, [loading]);

  useEffect(() => () => {
    if (splashTimer.current !== null) window.clearTimeout(splashTimer.current);
  }, []);

  if (splashVisible) return <SplashScreen label="Loading..." />;
  if (loading) return <Spinner label="Loading..." />;
  if (!user) return <Login />;
  // Signed in, but no `users/{uid}` record links them to a partner yet.
  if (profileMissing) return <NoProfile />;

  return (
    <DataProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          {/* `new` must precede `:shipmentId` or it would be read as an id. */}
          <Route path="shipments/new" element={<Shipments openCreate />} />
          <Route path="shipments" element={<Shipments />} />
          <Route path="shipments/:shipmentId" element={<ShipmentDetail />} />

          {/* Three screens: Dashboard, Customers, Invoices. */}
          <Route path="crm">
            <Route index element={<CrmDashboard />} />
            {/* `new` must precede `:customerId` or it would be read as an id. */}
            <Route path="customers/new" element={<CustomerList openCreate />} />
            <Route path="customers" element={<CustomerList />} />
            <Route path="customers/:customerId" element={<AdminOnly><CustomerProfile /></AdminOnly>} />
            <Route path="invoices" element={<Invoices />} />

            {/* Old bookmarks and links from before the CRM was consolidated. */}
            <Route path="outstanding" element={<Navigate to="/crm/invoices" replace />} />
            <Route path="due-soon" element={<Navigate to="/crm/invoices?view=due-soon" replace />} />
            <Route path="overdue" element={<Navigate to="/crm/invoices?view=overdue" replace />} />
            <Route path="reports" element={<Navigate to="/crm/customers" replace />} />
          </Route>

          <Route path="profile" element={<Profile />} />
          <Route
            path="settings"
            element={
              <AdminOnly>
                <Settings />
              </AdminOnly>
            }
          />
          <Route path="expenses" element={<AdminOnly><Expenses /></AdminOnly>} />
          <Route path="withdrawals" element={<AdminOnly><Withdrawals /></AdminOnly>} />
          <Route path="reports" element={<AdminOnly><Reports /></AdminOnly>} />
          <Route
            path="agencies"
            element={
              <AdminOnly>
                <Agencies />
              </AdminOnly>
            }
          />
          <Route
            path="partners"
            element={
              <AdminOnly>
                <Partners />
              </AdminOnly>
            }
          />
          <Route
            path="employees"
            element={
              <AdminOnly>
                <Employees />
              </AdminOnly>
            }
          />
          <Route path="employees/settlements" element={<AdminOrEmployee><EmployeeSettlements /></AdminOrEmployee>} />
          <Route path="employees/slips" element={<AdminOrEmployee><Reports initialKind="employee-payslip" employeeOnly /></AdminOrEmployee>} />
          <Route
            path="audit"
            element={
              <AdminOnly>
                <AuditLog />
              </AdminOnly>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </DataProvider>
  );
}

export default function App() {
  if (!isFirebaseConfigured) return <Setup />;

  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
