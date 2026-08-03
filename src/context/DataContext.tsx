import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { limit, onSnapshot, orderBy, query, type Query } from 'firebase/firestore';
import {
  agenciesCol,
  auditLogCol,
  customersCol,
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
  Expense,
  ExpenseCategory,
  Partner,
  Shipment,
  Withdrawal,
} from '@/domain/types';

interface DataState {
  partners: Partner[];
  agencies: Agency[];
  customers: Customer[];
  shipments: Shipment[];
  expenses: Expense[];
  expenseCategories: ExpenseCategory[];
  withdrawals: Withdrawal[];
  auditLog: AuditEntry[];
  loading: boolean;
  error: string | null;
}

const EMPTY: DataState = {
  partners: [],
  agencies: [],
  customers: [],
  shipments: [],
  expenses: [],
  expenseCategories: [],
  withdrawals: [],
  auditLog: [],
  loading: true,
  error: null,
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
 * These are live listeners, so a shipment marked 'Agency Paid' on Shabbir's
 * machine repaints everyone else's dashboard without a refresh. The volumes here
 * (hundreds of shipments, three users) sit far inside the Spark plan's read
 * quota, and the persistent cache means a reopened app mostly serves from disk.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useAuth();
  const [state, setState] = useState<DataState>(EMPTY);

  useEffect(() => {
    if (!user) {
      setState({ ...EMPTY, loading: false });
      return;
    }

    const pending = new Set<string>();
    const markLoaded = (key: string) => {
      pending.delete(key);
      if (pending.size === 0) setState((prev) => ({ ...prev, loading: false }));
    };

    const fail = (key: string) => (error: Error) => {
      console.error(`Snapshot error on ${key}`, error);
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

    const unsubscribers: (() => void)[] = [
      subscribe<Partner>('partners', partnersCol),
      subscribe<Agency>('agencies', agenciesCol),
      subscribe<Customer>('customers', customersCol),
      subscribe<Shipment>('shipments', shipmentsCol),
      subscribe<Expense>('expenses', expensesCol),
      subscribe<ExpenseCategory>('expenseCategories', expenseCategoriesCol),
      // Every partner sees every withdrawal — the team wants nothing hidden
      // between them (SPEC.md §25). Only admins may record one.
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
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [user, isAdmin]);

  const value = useMemo(() => {
    // Sort once here so every screen gets a consistent, newest-first ordering
    // without each one re-sorting.
    const byDateDesc = <T extends { date: string }>(rows: T[]) =>
      [...rows].sort((a, b) => b.date.localeCompare(a.date));

    return {
      ...state,
      partners: [...state.partners].sort((a, b) => b.sharePercent - a.sharePercent),
      agencies: [...state.agencies].sort((a, b) => a.name.localeCompare(b.name)),
      customers: [...state.customers].sort((a, b) => a.companyName.localeCompare(b.companyName)),
      shipments: byDateDesc(state.shipments),
      expenses: byDateDesc(state.expenses),
      withdrawals: byDateDesc(state.withdrawals),
      auditLog: [...state.auditLog].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    };
  }, [state]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  return useContext(DataContext);
}
