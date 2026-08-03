import { collection, type CollectionReference, type DocumentData } from 'firebase/firestore';
import { db } from './config';
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

export const COLLECTIONS = {
  users: 'users',
  partners: 'partners',
  agencies: 'agencies',
  customers: 'customers',
  shipments: 'shipments',
  expenses: 'expenses',
  expenseCategories: 'expenseCategories',
  withdrawals: 'withdrawals',
  auditLog: 'auditLog',
  settings: 'settings',
} as const;

/** The single settings document lives at `settings/app`. */
export const SETTINGS_DOC_ID = 'app';

/** Auth-side record. Kept separate from `partners` so security rules can read a role cheaply. */
export interface UserRecord {
  id: string;
  email: string;
  role: 'admin' | 'partner';
  /** Links this login to a row in `partners`. */
  partnerId: string;
  name: string;
  phone?: string;
  /**
   * Avatar as a data URL, resized to 128px before saving. Held in Firestore
   * rather than Cloud Storage, which needs billing enabled — a 128px JPEG is a
   * few kilobytes, far inside the 1 MiB document limit.
   */
  photo?: string;
}

/** App-wide settings, a single document at `settings/app`. SPEC.md §19. */
export interface AppSettings {
  companyName: string;
  /** Applied to new customers unless overridden. */
  defaultPaymentTermsDays: number;
  /** Warn when a load's margin falls below this percentage of AR. */
  lowMarginThresholdPercent: number;
  /** Notification ids the team has switched off. */
  mutedNotifications: string[];
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: 'Trizen Global',
  defaultPaymentTermsDays: 30,
  lowMarginThresholdPercent: 8,
  mutedNotifications: [],
};

function typed<T>(name: string) {
  return collection(db, name) as CollectionReference<Omit<T, 'id'>, DocumentData>;
}

export const usersCol = typed<UserRecord>(COLLECTIONS.users);
export const partnersCol = typed<Partner>(COLLECTIONS.partners);
export const agenciesCol = typed<Agency>(COLLECTIONS.agencies);
export const customersCol = typed<Customer>(COLLECTIONS.customers);
export const shipmentsCol = typed<Shipment>(COLLECTIONS.shipments);
export const expensesCol = typed<Expense>(COLLECTIONS.expenses);
export const expenseCategoriesCol = typed<ExpenseCategory>(COLLECTIONS.expenseCategories);
export const withdrawalsCol = typed<Withdrawal>(COLLECTIONS.withdrawals);
export const auditLogCol = typed<AuditEntry>(COLLECTIONS.auditLog);
export const settingsCol = typed<AppSettings & { id: string }>(COLLECTIONS.settings);
