/**
 * Per-customer statistics for the customer profile dashboard. SPEC.md §16.
 *
 * Everything is derived from that customer's shipments — there is no separate
 * customer ledger to fall out of step with the loads.
 */

import { round2 } from './money';
import { computeReceivable, daysBetween, todayIso, type Receivable } from './receivables';
import { isEarned, splitShipment } from './engine';
import { DEAD_STATUSES, type Customer, type Partner, type Shipment } from './types';

export interface CustomerStats {
  customer: Customer;

  // Shipments
  totalLoads: number;
  monthlyLoads: number;
  activeLoads: number;
  completedLoads: number;
  cancelledLoads: number;

  // Revenue
  totalAr: number;
  totalAp: number;
  totalGrossMargin: number;
  totalNetMargin: number;
  outstandingAr: number;
  paidAr: number;
  averageMarginPerLoad: number;

  // Invoicing (tracked, never issued by this portal)
  totalInvoiced: number;
  paidInvoices: number;
  outstandingInvoices: number;
  overdueInvoices: number;
  overdueAmount: number;
  averagePaymentDays: number;

  receivables: Receivable[];
}

/** Loads still moving — booked but not yet handed over for invoicing. */
const ACTIVE_STATUSES = new Set(['Assigned', 'In Transit', 'Delivered']);

export function computeCustomerStats(
  customer: Customer,
  shipments: Shipment[],
  partners: Partner[],
  asOf: string = todayIso(),
): CustomerStats {
  const mine = shipments.filter((shipment) => shipment.customerId === customer.id);
  const currentMonth = asOf.slice(0, 7);

  const receivables = mine.map((shipment) => computeReceivable(shipment, customer, asOf));
  const byShipmentId = new Map(receivables.map((r) => [r.shipmentId, r]));

  let totalAr = 0;
  let totalAp = 0;
  let totalGrossMargin = 0;
  let totalNetMargin = 0;
  let outstandingAr = 0;
  let paidAr = 0;
  let monthlyLoads = 0;
  let activeLoads = 0;
  let completedLoads = 0;
  let cancelledLoads = 0;
  let totalInvoiced = 0;
  let paidInvoices = 0;
  let outstandingInvoices = 0;
  let overdueInvoices = 0;
  let overdueAmount = 0;

  // Only settled receivables can tell us how long the customer actually took.
  const paymentDurations: number[] = [];

  for (const shipment of mine) {
    const receivable = byShipmentId.get(shipment.id)!;

    totalAr = round2(totalAr + shipment.ar);
    totalAp = round2(totalAp + shipment.ap);

    if (shipment.month === currentMonth) monthlyLoads += 1;
    if (ACTIVE_STATUSES.has(shipment.status)) activeLoads += 1;
    if (DEAD_STATUSES.includes(shipment.status)) cancelledLoads += 1;

    if (isEarned(shipment)) {
      const split = splitShipment(shipment, partners);
      totalGrossMargin = round2(totalGrossMargin + shipment.grossMargin);
      totalNetMargin = round2(totalNetMargin + split.teamCommission);
    }

    switch (receivable.state) {
      case 'settled':
        completedLoads += 1;
        totalInvoiced += 1;
        paidInvoices += 1;
        paidAr = round2(paidAr + shipment.ar);
        paymentDurations.push(Math.max(0, daysBetween(receivable.invoicedDate, asOf)));
        break;
      case 'overdue':
        completedLoads += 1;
        totalInvoiced += 1;
        outstandingInvoices += 1;
        overdueInvoices += 1;
        outstandingAr = round2(outstandingAr + shipment.ar);
        overdueAmount = round2(overdueAmount + shipment.ar);
        break;
      case 'open':
        completedLoads += 1;
        totalInvoiced += 1;
        outstandingInvoices += 1;
        outstandingAr = round2(outstandingAr + shipment.ar);
        break;
      default:
        break;
    }
  }

  const marginLoads = mine.filter(isEarned).length;

  return {
    customer,
    totalLoads: mine.length,
    monthlyLoads,
    activeLoads,
    completedLoads,
    cancelledLoads,
    totalAr,
    totalAp,
    totalGrossMargin,
    totalNetMargin,
    outstandingAr,
    paidAr,
    averageMarginPerLoad: marginLoads > 0 ? round2(totalGrossMargin / marginLoads) : 0,
    totalInvoiced,
    paidInvoices,
    outstandingInvoices,
    overdueInvoices,
    overdueAmount,
    averagePaymentDays:
      paymentDurations.length > 0
        ? Math.round(paymentDurations.reduce((a, b) => a + b, 0) / paymentDurations.length)
        : 0,
    receivables: receivables.sort((a, b) => b.invoicedDate.localeCompare(a.invoicedDate)),
  };
}

export interface CustomerRanking {
  customerId: string;
  customerName: string;
  loads: number;
  revenue: number;
  grossMargin: number;
  netMargin: number;
  outstandingAr: number;
}

/** Customers ranked by revenue — feeds the "top customers" panels. */
export function rankCustomers(
  customers: Customer[],
  shipments: Shipment[],
  partners: Partner[],
  asOf: string = todayIso(),
): CustomerRanking[] {
  return customers
    .map((customer) => {
      const stats = computeCustomerStats(customer, shipments, partners, asOf);
      return {
        customerId: customer.id,
        customerName: customer.companyName,
        loads: stats.totalLoads,
        revenue: stats.totalAr,
        grossMargin: stats.totalGrossMargin,
        netMargin: stats.totalNetMargin,
        outstandingAr: stats.outstandingAr,
      };
    })
    .filter((row) => row.loads > 0)
    .sort((a, b) => b.revenue - a.revenue);
}

/** Agencies this customer may ship under. An empty assignment means "any". */
export function agenciesForCustomer<T extends { id: string; active: boolean }>(
  customer: Customer | undefined,
  agencies: T[],
): T[] {
  const active = agencies.filter((agency) => agency.active);
  if (!customer || customer.agencyIds.length === 0) return active;

  const allowed = new Set(customer.agencyIds);
  const matching = active.filter((agency) => allowed.has(agency.id));
  // Fall back rather than leaving the dropdown empty if the assignment is stale.
  return matching.length > 0 ? matching : active;
}
