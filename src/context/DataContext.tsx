import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, where, type Query } from 'firebase/firestore';
import { db } from '@/firebase/config';
import {
  agenciesCol,
  auditLogCol,
  customersCol,
  employeesCol,
  employeeSettlementsCol,
  expenseCategoriesCol,
  expensesCol,
  partnersCol,
  shipmentsCol,
  withdrawalsCol,
} from '@/firebase/collections';
import { useAuth } from './AuthContext';
import type {
  Agency,
  AuditEntry,
  Customer,
  Employee,
  EmployeeSettlementRecord,
  Expense,
  ExpenseCategory,
  Partner,
  Shipment,
  Withdrawal,
} from '@/domain/types';

interface DataState {
  partners: Partner[];
  employees: Employee[];
  employeeSettlements: EmployeeSettlementRecord[];
  agencies: Agency[];
  customers: Customer[];
  shipments: Shipment[];
  expenses: Expense[];
  expenseCategories: ExpenseCategory[];
  withdrawals: Withdrawal[];
  auditLog: AuditEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const EMPTY: DataState = {
  partners: [],
  employees: [],
  employeeSettlements: [],
  agencies: [],
  customers: [],
  shipments: [],
  expenses: [],
  expenseCategories: [],
  withdrawals: [],
  auditLog: [],
  loading: true,
  error: null,
  refresh: () => undefined,
};

const DataContext = createContext<DataState>(EMPTY);

/**
 * How many audit entries the app keeps live. Generous enough that the log reads
 * as complete for a team of this size, small enough that it never becomes the
 * reason sign-in is slow.
 */
export const AUDIT_LOG_WINDOW = 500;

/**
 * One `onSnapshot` per collection, opened once the user is signed in.
 *
 * These are live listeners, so an agency payment recorded on Shabbir's
 * machine repaints everyone else's dashboard without a refresh. The volumes here
 * (hundreds of shipments, three users) sit far inside the Spark plan's read
 * quota, and the persistent cache means a reopened app mostly serves from disk.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin, isEmployee, employeeId } = useAuth();
  const [state, setState] = useState<DataState>(EMPTY);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const refresh = useCallback(() => setRefreshNonce((value) => value + 1), []);

  useEffect(() => {
    if (!user) {
      setState({ ...EMPTY, loading: false });
      return;
    }
    // Capture primitive identity values before defining nested snapshot
    // functions. React state may change after an effect starts, and TypeScript
    // correctly will not preserve a nullable-object narrowing in closures.
    const authUid = user.uid;

    // A role/profile refresh replaces the listeners below. Clear any error
    // left by the previous (broader) listener so a transient permission
    // failure cannot remain visible after the scoped listener succeeds.
    setState((prev) => ({ ...prev, loading: true, error: null }));
    let active = true;

    const pending = new Set<string>();
    const markLoaded = (key: string) => {
      pending.delete(key);
      if (pending.size === 0) setState((prev) => ({ ...prev, loading: false }));
    };

    const fail = (key: string) => (error: Error) => {
      console.error(`Snapshot error on ${key}`, error);
      if (!active) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: `Could not load ${key}. ${error.message}`,
      }));
    };

    function subscribe<T>(key: keyof DataState, source: Query): () => void {
      pending.add(key);
      return onSnapshot(
        source,
        (snapshot) => {
          if (!active) return;
          const rows = snapshot.docs.map((d) => {
            const data = d.data();
            // Audit entries use Firestore's server timestamp. Convert it at
            // the application edge so existing date formatting stays simple.
            const row = key === 'auditLog'
              ? {
                  ...data,
                  // A pending server timestamp is null until Firestore confirms
                  // the batch; use an empty value briefly rather than crashing
                  // the audit-log sort.
                  timestamp: data.timestamp?.toDate
                    ? data.timestamp.toDate().toISOString()
                    : typeof data.timestamp === 'string'
                      ? data.timestamp
                      : '',
                }
              : data;
            return { id: d.id, ...row } as T;
          });
          setState((prev) => ({ ...prev, [key]: rows, error: null }));
          markLoaded(key);
        },
        fail(key),
      );
    }

    // Customer collection queries cannot safely express an employee's access
    // rule on every legacy assignment shape. The canonical read path is a
    // small per-login index at users/{uid}/customerAccess/{customerId}. It
    // returns customer ids first, then reads each permitted customer directly.
    // Direct document reads line up exactly with the customer rule and work
    // the same after browser storage has been cleared.
    const customerScopes = new Map<string, Customer[]>();
    function publishEmployeeCustomers() {
      const merged = new Map<string, Customer>();
      customerScopes.forEach((scopeRows) => scopeRows.forEach((row) => merged.set(row.id, row)));
      setState((prev) => ({ ...prev, customers: [...merged.values()], error: null }));
    }

    function subscribeEmployeeCustomerAccess(): () => void {
      const access = collection(db, 'users', authUid, 'customerAccess');
      const customerUnsubscribers = new Map<string, () => void>();
      const customerRows = new Map<string, Customer>();

      const publishAccessCustomers = () => {
        customerScopes.set('customersByAccess', [...customerRows.values()]);
        publishEmployeeCustomers();
      };

      pending.add('customerAccess');
      const unsubscribeAccess = onSnapshot(
        access,
        (snapshot) => {
          if (!active) return;
          const customerIds = new Set(
            snapshot.docs
              .map((entry) => {
                const data = entry.data() as { customerId?: unknown };
                return typeof data.customerId === 'string' ? data.customerId : entry.id;
              })
              .filter(Boolean),
          );

          // Stop reading entries that were unassigned. This also removes the
          // customer immediately from every active device.
          customerUnsubscribers.forEach((unsubscribe, customerId) => {
            if (!customerIds.has(customerId)) {
              unsubscribe();
              customerUnsubscribers.delete(customerId);
              customerRows.delete(customerId);
            }
          });

          customerIds.forEach((customerId) => {
            if (customerUnsubscribers.has(customerId)) return;
            const unsubscribeCustomer = onSnapshot(
              doc(customersCol, customerId),
              (customer) => {
                if (!active) return;
                if (customer.exists()) {
                  customerRows.set(customer.id, { id: customer.id, ...customer.data() } as Customer);
                } else {
                  customerRows.delete(customerId);
                }
                publishAccessCustomers();
              },
              (error) => {
                // The mapping is only written for an assigned customer. If an
                // admin revokes access before this callback arrives, quietly
                // remove the stale entry rather than keeping cached data.
                console.error(`Snapshot error on customer ${customerId}`, error);
                customerRows.delete(customerId);
                publishAccessCustomers();
              },
            );
            customerUnsubscribers.set(customerId, unsubscribeCustomer);
          });

          publishAccessCustomers();
          markLoaded('customerAccess');
        },
        (error) => {
          console.error('Snapshot error on customerAccess', error);
          fail('customerAccess')(error);
        },
      );

      return () => {
        unsubscribeAccess();
        customerUnsubscribers.forEach((unsubscribe) => unsubscribe());
      };
    }

    // An approved employee should always have an employeeId. Falling back to
    // the Auth UID prevents a stale profile/cache on one device from taking
    // the broad admin/partner listener path (which Firestore correctly denies).
    const employeeScopeId = employeeId ?? authUid;
    const unsubscribers: (() => void)[] = isEmployee
      ? [
        // Resolve the profile by its permanent login UID.  The profile id is
        // an implementation detail and can differ from the UID on records
        // linked before the cross-device fix was introduced.
        subscribe<Employee>('employees', query(employeesCol, where('userId', '==', authUid))),
        subscribe<EmployeeSettlementRecord>('employeeSettlements', query(employeeSettlementsCol, where('employeeId', '==', employeeScopeId))),
        // This is the canonical access path. Keep its error visible: otherwise
        // an Electron build with old Firestore rules renders an empty table and
        // looks indistinguishable from a customer that has not been assigned.
        subscribeEmployeeCustomerAccess(),
        subscribe<Shipment>('shipments', query(shipmentsCol, where('employeeId', '==', employeeScopeId))),
      ]
      : [
        subscribe<Partner>('partners', partnersCol),
        subscribe<Employee>('employees', employeesCol),
        subscribe<EmployeeSettlementRecord>('employeeSettlements', employeeSettlementsCol),
        subscribe<Agency>('agencies', agenciesCol),
        subscribe<Customer>('customers', customersCol),
        subscribe<Shipment>('shipments', shipmentsCol),
        subscribe<Expense>('expenses', expensesCol),
        subscribe<ExpenseCategory>('expenseCategories', expenseCategoriesCol),
        subscribe<Withdrawal>('withdrawals', withdrawalsCol),
      ];

    if (isAdmin) {
      // The audit log is append-only and never pruned, so it is the one
      // collection that would grow without bound. Nothing needs the whole
      // history live — the screen shows the recent end of it — so cap the
      // listener rather than re-downloading years of entries every session.
      unsubscribers.push(
        subscribe<AuditEntry>(
          'auditLog',
          query(auditLogCol, orderBy('timestamp', 'desc'), limit(AUDIT_LOG_WINDOW)),
        ),
      );
    }

    return () => {
      active = false;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [user, isAdmin, isEmployee, employeeId, refreshNonce]);

  const value = useMemo(() => {
    // Sort once here so every screen gets a consistent, newest-first ordering
    // without each one re-sorting.
    const byDateDesc = <T extends { date: string }>(rows: T[]) =>
      [...rows].sort((a, b) => b.date.localeCompare(a.date));

    return {
      ...state,
      partners: [...state.partners].sort((a, b) => b.sharePercent - a.sharePercent),
      employees: [...state.employees].sort((a, b) => a.name.localeCompare(b.name)),
      employeeSettlements: [...state.employeeSettlements].sort((a, b) => b.month.localeCompare(a.month) || a.employeeName.localeCompare(b.employeeName)),
      agencies: [...state.agencies].sort((a, b) => a.name.localeCompare(b.name)),
      customers: [...state.customers].sort((a, b) => a.companyName.localeCompare(b.companyName)),
      shipments: byDateDesc(state.shipments),
      expenses: byDateDesc(state.expenses),
      withdrawals: byDateDesc(state.withdrawals),
      auditLog: [...state.auditLog].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      refresh,
    };
  }, [state, refresh]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  return useContext(DataContext);
}
