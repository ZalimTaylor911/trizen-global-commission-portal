/**
 * Accounts receivable tracking.
 *
 * The portal does not issue invoices — the brokerage's TMS and the accounting
 * team do that. What this module does is watch the receivable that each invoice
 * implies: a load handed over for invoicing starts a clock set by the customer's
 * payment terms, and the portal reports what's coming due and what has slipped.
 *
 * Everything here is derived from the shipment's status plus its customer, so
 * there is no separate invoice record to keep in sync.
 */

import { round2 } from './money';
import {
  AR_OPEN_STATUSES,
  AR_SETTLED_STATUSES,
  DEAD_STATUSES,
  type Customer,
  type Shipment,
} from './types';

/** 'YYYY-MM-DD' for the local day — never a UTC timestamp, which can be off by one. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from `from` to `to`, both 'YYYY-MM-DD'. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const parse = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    // Midday avoids any daylight-saving shift tipping the result a day.
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** Adds calendar days to a 'YYYY-MM-DD' date. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export type ReceivableState =
  /** Not yet handed to accounting — no receivable exists. */
  | 'not-invoiced'
  /** Invoiced, inside terms. */
  | 'open'
  /** Invoiced, past the due date, unpaid. */
  | 'overdue'
  /** Customer has paid. */
  | 'settled'
  /** Dissolved, claimed or TONU — never collectable. */
  | 'written-off';

export interface Receivable {
  shipmentId: string;
  customerId: string;
  customerName: string;
  /** Also the invoice number — the customer is billed under this. */
  loadNumber: string;
  /** Date the receivable clock started. */
  invoicedDate: string;
  dueDate: string;
  paymentTermsDays: number;
  amount: number;
  state: ReceivableState;
  /** Positive once past due, otherwise 0. */
  daysPastDue: number;
  /** Days until due; negative when overdue. Only meaningful while open. */
  daysUntilDue: number;
}

const DEFAULT_TERMS_DAYS = 30;

/**
 * Work out where a single shipment sits in the collection cycle.
 *
 * The clock starts from the recorded invoice date, falling back to the load date
 * when accounting hasn't told us one yet — so an untracked load still surfaces
 * rather than silently sitting outside the ageing report.
 */
export function computeReceivable(
  shipment: Shipment,
  customer: Customer | undefined,
  asOf: string = todayIso(),
): Receivable {
  const termsDays = customer?.paymentTermsDays ?? DEFAULT_TERMS_DAYS;
  const invoicedDate = shipment.invoicedDate || shipment.date;
  const dueDate = addDays(invoicedDate, termsDays);
  const daysUntilDue = daysBetween(asOf, dueDate);

  let state: ReceivableState;
  if (AR_SETTLED_STATUSES.includes(shipment.status)) {
    state = 'settled';
  } else if (DEAD_STATUSES.includes(shipment.status)) {
    state = 'written-off';
  } else if (AR_OPEN_STATUSES.includes(shipment.status)) {
    state = daysUntilDue < 0 ? 'overdue' : 'open';
  } else {
    state = 'not-invoiced';
  }

  return {
    shipmentId: shipment.id,
    customerId: shipment.customerId,
    customerName: customer?.companyName || shipment.companyName,
    loadNumber: shipment.loadNumber,
    invoicedDate,
    dueDate,
    paymentTermsDays: termsDays,
    amount: round2(shipment.ar),
    state,
    daysPastDue: state === 'overdue' ? -daysUntilDue : 0,
    daysUntilDue,
  };
}

export function computeReceivables(
  shipments: Shipment[],
  customers: Customer[],
  asOf: string = todayIso(),
): Receivable[] {
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  return shipments
    .map((shipment) => computeReceivable(shipment, customerById.get(shipment.customerId), asOf))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Only those still awaiting the customer's money. */
export function openReceivables(receivables: Receivable[]): Receivable[] {
  return receivables.filter((r) => r.state === 'open' || r.state === 'overdue');
}

export interface ArSummary {
  totalOutstanding: number;
  outstandingCount: number;
  dueTodayCount: number;
  dueTodayAmount: number;
  /** Due within the next 7 days, today included. */
  dueThisWeekCount: number;
  dueThisWeekAmount: number;
  overdueCount: number;
  overdueAmount: number;
  /**
   * Mean age of the open receivables, in days since invoicing. The usual
   * "days sales outstanding" proxy for how slowly customers are paying.
   */
  averageDaysOutstanding: number;
  /** Worst single overdue item, for the alert banner. */
  worstDaysPastDue: number;
}

export function computeArSummary(
  receivables: Receivable[],
  asOf: string = todayIso(),
): ArSummary {
  const open = openReceivables(receivables);

  const dueToday = open.filter((r) => r.daysUntilDue === 0);
  const dueThisWeek = open.filter((r) => r.daysUntilDue >= 0 && r.daysUntilDue <= 7);
  const overdue = open.filter((r) => r.state === 'overdue');

  const sum = (rows: Receivable[]) => round2(rows.reduce((total, r) => total + r.amount, 0));

  const ages = open.map((r) => daysBetween(r.invoicedDate, asOf));
  const averageDaysOutstanding =
    ages.length > 0 ? Math.round(ages.reduce((total, age) => total + age, 0) / ages.length) : 0;

  return {
    totalOutstanding: sum(open),
    outstandingCount: open.length,
    dueTodayCount: dueToday.length,
    dueTodayAmount: sum(dueToday),
    dueThisWeekCount: dueThisWeek.length,
    dueThisWeekAmount: sum(dueThisWeek),
    overdueCount: overdue.length,
    overdueAmount: sum(overdue),
    averageDaysOutstanding,
    worstDaysPastDue: overdue.reduce((worst, r) => Math.max(worst, r.daysPastDue), 0),
  };
}

export interface CustomerArRow {
  customerId: string;
  customerName: string;
  outstanding: number;
  overdue: number;
  openCount: number;
  overdueCount: number;
  /** Oldest unpaid item, in days past due. */
  worstDaysPastDue: number;
}

/** Outstanding balance per customer, worst first — drives the "who owes us" list. */
export function computeCustomerAr(receivables: Receivable[]): CustomerArRow[] {
  const rows = new Map<string, CustomerArRow>();

  for (const receivable of openReceivables(receivables)) {
    const key = receivable.customerId || receivable.customerName;
    let row = rows.get(key);
    if (!row) {
      row = {
        customerId: receivable.customerId,
        customerName: receivable.customerName,
        outstanding: 0,
        overdue: 0,
        openCount: 0,
        overdueCount: 0,
        worstDaysPastDue: 0,
      };
      rows.set(key, row);
    }
    row.outstanding = round2(row.outstanding + receivable.amount);
    row.openCount += 1;
    if (receivable.state === 'overdue') {
      row.overdue = round2(row.overdue + receivable.amount);
      row.overdueCount += 1;
      row.worstDaysPastDue = Math.max(row.worstDaysPastDue, receivable.daysPastDue);
    }
  }

  return [...rows.values()].sort((a, b) => b.outstanding - a.outstanding);
}

export interface AgeingBucket {
  label: string;
  count: number;
  amount: number;
}

/** The standard 0-30 / 31-60 / 61-90 / 90+ ageing split, plus not-yet-due. */
export function computeAgeing(receivables: Receivable[]): AgeingBucket[] {
  const buckets: AgeingBucket[] = [
    { label: 'Not yet due', count: 0, amount: 0 },
    { label: '1–30 days', count: 0, amount: 0 },
    { label: '31–60 days', count: 0, amount: 0 },
    { label: '61–90 days', count: 0, amount: 0 },
    { label: 'Over 90 days', count: 0, amount: 0 },
  ];

  const indexFor = (daysPastDue: number) => {
    if (daysPastDue <= 0) return 0;
    if (daysPastDue <= 30) return 1;
    if (daysPastDue <= 60) return 2;
    if (daysPastDue <= 90) return 3;
    return 4;
  };

  for (const receivable of openReceivables(receivables)) {
    const bucket = buckets[indexFor(receivable.daysPastDue)]!;
    bucket.count += 1;
    bucket.amount = round2(bucket.amount + receivable.amount);
  }

  return buckets;
}
