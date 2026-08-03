/**
 * Domain model for the Trizen freight commission portal.
 * Business rules these types encode are documented in SPEC.md.
 */

export const SHIPMENT_STATUSES = [
  'Assigned',
  'In Transit',
  'Delivered',
  'Completed',
  'Billed',
  'Claim',
  'Dissolved',
  'TONU',
  'Customer Paid',
  'Issue / Dispute',
  'Agency Paid',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** Commission is earned only once a shipment reaches this status. SPEC.md §4. */
export const EARNING_STATUS: ShipmentStatus = 'Agency Paid';

/**
 * Delivered *and* the POD is in the brokerage's TMS, so the load is ready for
 * the accounting team to invoice. The portal never issues an invoice itself —
 * this status is what starts its receivable clock. SPEC.md §22.
 */
export const INVOICEABLE_STATUS: ShipmentStatus = 'Completed';

/**
 * Accounting has actually raised the invoice in the TMS. Where `Completed` says
 * the load is *ready* to bill, this says the customer *has been* billed — so the
 * shipment's `invoicedDate` is required from here on. SPEC.md §4.
 *
 * "Invoiced" is the same thing said differently; the bulk importer accepts it as
 * a synonym so a spreadsheet typed either way still loads.
 */
export const BILLED_STATUS: ShipmentStatus = 'Billed';

/**
 * Handed over for invoicing but the customer's money hasn't landed. These are
 * what make up outstanding AR.
 */
export const AR_OPEN_STATUSES: readonly ShipmentStatus[] = [
  'Completed',
  'Billed',
  'Issue / Dispute',
];

/** The customer has paid; the receivable is closed regardless of the agency. */
export const AR_SETTLED_STATUSES: readonly ShipmentStatus[] = ['Customer Paid', 'Agency Paid'];

/**
 * Written off — never becomes revenue, never becomes a receivable, and never
 * appears in the pipeline. SPEC.md §14.
 */
export const DEAD_STATUSES: readonly ShipmentStatus[] = ['Dissolved', 'Claim', 'TONU'];

/** Less-than-truckload vs full-truckload. */
export const SHIPMENT_TYPES = ['LTL', 'FTL'] as const;

export type ShipmentType = (typeof SHIPMENT_TYPES)[number];

/**
 * Stored as 'admin' | 'partner'. 'partner' is the spec's "Normal User" — the
 * value is kept as-is so existing `users/{uid}` documents don't need migrating;
 * the UI labels it "User". SPEC.md §25.
 */
export type UserRole = 'admin' | 'partner';

/** Standard net terms, plus 0 for due-on-receipt. Customers may use any number. */
export const PAYMENT_TERMS = [
  { days: 0, label: 'Due on receipt' },
  { days: 15, label: 'Net 15' },
  { days: 30, label: 'Net 30' },
  { days: 45, label: 'Net 45' },
  { days: 60, label: 'Net 60' },
  { days: 90, label: 'Net 90' },
] as const;

export function paymentTermsLabel(days: number): string {
  return PAYMENT_TERMS.find((term) => term.days === days)?.label ?? `Net ${days}`;
}

export interface Customer {
  id: string;
  companyName: string;
  /** Primary point of contact. */
  poc: string;
  phone: string;
  email: string;
  billingAddress: string;
  shippingAddress: string;
  notes: string;
  /** Days from invoice date to due date. 0 means due on receipt. */
  paymentTermsDays: number;
  /** Optional — null when the customer has no agreed limit. */
  creditLimit: number | null;
  taxId: string;
  /**
   * Brokerages this customer can be shipped under. The shipment form narrows
   * its agency dropdown to these. Empty means "any agency".
   */
  agencyIds: string[];
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Agency {
  id: string;
  name: string;
  /** Percentage of net margin that flows to our team. 0–100. */
  agentPercent: number;
  /** Percentage of net margin the brokerage keeps. 0–100. Must sum to 100 with agentPercent. */
  agencyPercent: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Partner {
  id: string;
  name: string;
  /** Email used for Firebase Auth sign-in. */
  email: string;
  role: UserRole;
  /** Share of the *team* commission. All partners' shares sum to 100. */
  sharePercent: number;
  /**
   * Silent partners are excluded from operational expenses (SPEC.md §6 Type 1)
   * but still carry agency deductions (Type 2) in proportion to their share.
   */
  bearsOperationalExpenses: boolean;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * One partner's weight in a shipment's commission, captured at the moment the
 * load was earned. SPEC.md §12.
 */
export interface CommissionShare {
  partnerId: string;
  sharePercent: number;
}

export interface Shipment {
  id: string;
  /** 'YYYY-MM' — denormalised from `date` so month reports need no parsing. */
  month: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** Links to a CRM customer. Empty on loads entered before the CRM existed. */
  customerId: string;
  /** Kept alongside `customerId` so historical loads still read correctly. */
  companyName: string;
  poc: string;
  lane: string;
  /** Accounts receivable — what the customer owes. */
  ar: number;
  carrierName: string;
  /** Accounts payable — what the carrier is paid. */
  ap: number;
  /** The whole margin on the load (AR − AP), before the agency takes its cut. */
  grossMargin: number;
  /**
   * Our share after the agency split — `grossMargin × agency.agentPercent`.
   * Derived, not typed in. This IS the team commission that partners divide.
   * SPEC.md §5.
   */
  netMargin: number;
  /**
   * Doubles as the invoice number — this is what the customer is billed under,
   * so the portal never carries a second invoice reference. SPEC.md §14.
   */
  loadNumber: string;
  status: ShipmentStatus;
  shipmentType: ShipmentType;
  agencyId: string;
  /**
   * The partner shares this load's commission was booked under, frozen when it
   * reached 'Agency Paid'. Changing a partner's share afterwards must not
   * re-spread money that has already been earned and possibly drawn, so the
   * engine prefers this over the live partner records.
   *
   * Absent (or null) on loads not yet earned, and on loads created before this
   * field existed — those fall back to the current shares. SPEC.md §12.
   */
  commissionSplit?: CommissionShare[] | null;
  /**
   * Date the TMS invoiced the customer — the receivable clock starts here.
   * Falls back to the load date when blank, and is required once the load is
   * marked 'Billed'.
   */
  invoicedDate: string;

  // --- Transit (SPEC.md §21) ---------------------------------------------
  /** Agreed transit time. Business days for LTL, calendar days for FTL. */
  transitDays: number;
  actualPickupDate: string;
  /** Derived from pickup + transit days, but overridable. */
  estimatedDeliveryDate: string;
  actualDeliveryDate: string;

  notes: string;
  createdAt?: string;
  updatedAt?: string;
}

export type ExpenseType =
  /** Shared equally among partners who bear operational expenses. */
  | 'operational'
  /** Agency clawback — shared across active partners by commission share. */
  | 'agency-deduction';

export interface ExpenseCategory {
  id: string;
  name: string;
  active: boolean;
}

export interface Expense {
  id: string;
  type: ExpenseType;
  categoryId: string;
  amount: number;
  /** 'YYYY-MM-DD' */
  date: string;
  month: string;
  notes: string;
  /** Optional link back to the shipment an agency deduction came from. */
  shipmentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Withdrawal {
  id: string;
  partnerId: string;
  amount: number;
  /** 'YYYY-MM-DD' */
  date: string;
  month: string;
  notes: string;
  createdAt?: string;
}

export type AuditAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status-changed'
  | 'signed-in';

export type AuditEntity =
  | 'shipment'
  | 'agency'
  | 'partner'
  | 'customer'
  | 'expense'
  | 'expense-category'
  | 'withdrawal'
  | 'session';

export interface AuditEntry {
  id: string;
  userId: string;
  userName: string;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  /** Human-readable label so the log stays meaningful after a record is deleted. */
  entityLabel: string;
  timestamp: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
}
