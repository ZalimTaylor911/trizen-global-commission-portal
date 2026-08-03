import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { isFirebaseConfigured } from './firebase/config';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Shipments from './pages/Shipments';
import ShipmentDetail from './pages/ShipmentDetail';
import Agencies from './pages/Agencies';
import Partners from './pages/Partners';
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

function Shell() {
  const { user, loading, profileMissing } = useAuth();

  if (loading) return <Spinner label="Connecting to Firebase…" />;
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
            <Route path="customers/:customerId" element={<CustomerProfile />} />
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
          <Route path="expenses" element={<Expenses />} />
          <Route path="withdrawals" element={<Withdrawals />} />
          <Route path="reports" element={<Reports />} />
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
