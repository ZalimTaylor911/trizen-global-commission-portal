/**
 * Things the team needs to act on. SPEC.md §26.
 *
 * Every alert is derived from the live data rather than stored, so nothing has
 * to be marked read or cleaned up — an alert disappears the moment the
 * underlying load or invoice moves on.
 */

import { round2 } from './money';
import { computeArSummary, computeReceivables, openReceivables } from './receivables';
import { computeLedgers, type DataSet } from './engine';
import { todayIso } from './receivables';
import type { Customer } from './types';

export type NotificationSeverity = 'critical' | 'warning' | 'info';

export interface Notification {
  id: string;
  severity: NotificationSeverity;
  title: string;
  detail: string;
  /** Where clicking it should take the user. */
  link: string;
  count: number;
  amount?: number;
}

export function computeNotifications(
  data: DataSet,
  customers: Customer[],
  asOf: string = todayIso(),
): Notification[] {
  const notifications: Notification[] = [];

  const receivables = computeReceivables(data.shipments, customers, asOf);
  const ar = computeArSummary(receivables, asOf);

  // --- Money we're owed --------------------------------------------------
  if (ar.overdueCount > 0) {
    notifications.push({
      id: 'overdue-invoices',
      severity: 'critical',
      title: `${ar.overdueCount} overdue invoice${ar.overdueCount === 1 ? '' : 's'}`,
      detail: `${money(ar.overdueAmount)} past due — the oldest by ${ar.worstDaysPastDue} days.`,
      link: '/crm/invoices?view=overdue',
      count: ar.overdueCount,
      amount: ar.overdueAmount,
    });
  }

  if (ar.dueTodayCount > 0) {
    notifications.push({
      id: 'due-today',
      severity: 'warning',
      title: `${ar.dueTodayCount} invoice${ar.dueTodayCount === 1 ? '' : 's'} due today`,
      detail: `${money(ar.dueTodayAmount)} falls due today.`,
      link: '/crm/invoices?view=due-soon',
      count: ar.dueTodayCount,
      amount: ar.dueTodayAmount,
    });
  }

  const dueSoonExcludingToday = openReceivables(receivables).filter(
    (r) => r.daysUntilDue > 0 && r.daysUntilDue <= 7,
  );
  if (dueSoonExcludingToday.length > 0) {
    notifications.push({
      id: 'due-soon',
      severity: 'info',
      title: `${dueSoonExcludingToday.length} invoice${dueSoonExcludingToday.length === 1 ? '' : 's'} due this week`,
      detail: `${money(sum(dueSoonExcludingToday.map((r) => r.amount)))} falls due within seven days.`,
      link: '/crm/invoices?view=due-soon',
      count: dueSoonExcludingToday.length,
      amount: sum(dueSoonExcludingToday.map((r) => r.amount)),
    });
  }

  // --- Operational follow-ups --------------------------------------------
  const deliveredNotCompleted = data.shipments.filter((s) => s.status === 'Delivered');
  if (deliveredNotCompleted.length > 0) {
    notifications.push({
      id: 'awaiting-completion',
      severity: 'warning',
      title: `${deliveredNotCompleted.length} delivered load${deliveredNotCompleted.length === 1 ? '' : 's'} not yet completed`,
      detail: 'Delivered but not marked Completed — check the POD is in the TMS so they can be invoiced.',
      link: '/shipments',
      count: deliveredNotCompleted.length,
    });
  }

  const completed = data.shipments.filter((s) => s.status === 'Completed');
  if (completed.length > 0) {
    notifications.push({
      id: 'awaiting-billing',
      severity: 'warning',
      title: `${completed.length} load${completed.length === 1 ? '' : 's'} ready to invoice`,
      detail: `${money(sum(completed.map((s) => s.ar)))} completed but not yet marked Billed — check accounting has raised the invoice.`,
      link: '/shipments',
      count: completed.length,
      amount: sum(completed.map((s) => s.ar)),
    });
  }

  const billed = data.shipments.filter((s) => s.status === 'Billed');
  if (billed.length > 0) {
    notifications.push({
      id: 'awaiting-payment',
      severity: 'info',
      title: `${billed.length} load${billed.length === 1 ? '' : 's'} invoiced and awaiting payment`,
      detail: `${money(sum(billed.map((s) => s.ar)))} billed to customers.`,
      link: '/crm/invoices',
      count: billed.length,
      amount: sum(billed.map((s) => s.ar)),
    });
  }

  const awaitingAgency = data.shipments.filter((s) => s.status === 'Customer Paid');
  if (awaitingAgency.length > 0) {
    notifications.push({
      id: 'awaiting-agency',
      severity: 'warning',
      title: `${awaitingAgency.length} load${awaitingAgency.length === 1 ? '' : 's'} awaiting agency payment`,
      detail: `The customer has paid but the agency hasn't settled with us — ${money(
        sum(awaitingAgency.map((s) => s.netMargin)),
      )} of commission is not yet earned.`,
      link: '/shipments',
      count: awaitingAgency.length,
      amount: sum(awaitingAgency.map((s) => s.netMargin)),
    });
  }

  const disputes = data.shipments.filter(
    (s) => s.status === 'Claim' || s.status === 'Issue / Dispute',
  );
  if (disputes.length > 0) {
    notifications.push({
      id: 'disputes',
      severity: 'critical',
      title: `${disputes.length} claim${disputes.length === 1 ? '' : 's'} or dispute${disputes.length === 1 ? '' : 's'} open`,
      detail: `${money(sum(disputes.map((s) => s.ar)))} of billing is in question.`,
      link: '/shipments',
      count: disputes.length,
      amount: sum(disputes.map((s) => s.ar)),
    });
  }

  // --- Data hygiene ------------------------------------------------------
  const unlinked = data.shipments.filter((s) => !s.customerId);
  if (unlinked.length > 0) {
    notifications.push({
      id: 'unlinked-customers',
      severity: 'info',
      title: `${unlinked.length} load${unlinked.length === 1 ? '' : 's'} without a customer`,
      detail: 'These fall back to Net 30 rather than the customer’s real terms.',
      link: '/shipments',
      count: unlinked.length,
    });
  }

  const overLimit = customers.filter((customer) => {
    if (customer.creditLimit === null) return false;
    const owed = openReceivables(receivables)
      .filter((r) => r.customerId === customer.id)
      .reduce((total, r) => total + r.amount, 0);
    return owed > customer.creditLimit;
  });
  if (overLimit.length > 0) {
    notifications.push({
      id: 'over-credit-limit',
      severity: 'warning',
      title: `${overLimit.length} customer${overLimit.length === 1 ? '' : 's'} over credit limit`,
      detail: overLimit.map((customer) => customer.companyName).join(', '),
      link: '/crm/customers',
      count: overLimit.length,
    });
  }

  const negativeBalances = computeLedgers(data).filter((ledger) => ledger.balance < 0);
  if (negativeBalances.length > 0) {
    notifications.push({
      id: 'negative-balances',
      severity: 'warning',
      title: `${negativeBalances.length} partner${negativeBalances.length === 1 ? '' : 's'} in the red`,
      detail: negativeBalances
        .map((ledger) => `${ledger.partnerName} ${money(ledger.balance)}`)
        .join(', '),
      link: '/withdrawals',
      count: negativeBalances.length,
    });
  }

  const order: Record<NotificationSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return notifications.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Alerts shown to an employee for their assigned loads and receivables only. */
export function computeEmployeeNotifications(
  data: DataSet,
  customers: Customer[],
  asOf: string = todayIso(),
): Notification[] {
  const notifications: Notification[] = [];
  const receivables = computeReceivables(data.shipments, customers, asOf);
  const open = openReceivables(receivables);
  const overdue = open.filter((receivable) => receivable.state === 'overdue');

  if (overdue.length > 0) {
    notifications.push({
      id: 'employee-overdue-invoices',
      severity: 'critical',
      title: `${overdue.length} overdue invoice${overdue.length === 1 ? '' : 's'}`,
      detail: `${money(sum(overdue.map((receivable) => receivable.amount)))} past due for your loads.`,
      link: '/crm/invoices?view=overdue',
      count: overdue.length,
      amount: sum(overdue.map((receivable) => receivable.amount)),
    });
  }

  if (open.length > 0) {
    notifications.push({
      id: 'employee-outstanding-invoices',
      severity: 'warning',
      title: `${open.length} outstanding invoice${open.length === 1 ? '' : 's'}`,
      detail: `${money(sum(open.map((receivable) => receivable.amount)))} still owed for your loads.`,
      link: '/crm/invoices',
      count: open.length,
      amount: sum(open.map((receivable) => receivable.amount)),
    });
  }

  const pickupOverdue = data.shipments.filter(
    (shipment) => shipment.status === 'Assigned' && (shipment.actualPickupDate || shipment.date) < asOf,
  );
  if (pickupOverdue.length > 0) {
    notifications.push({
      id: 'employee-overdue-pickups',
      severity: 'warning',
      title: `${pickupOverdue.length} assigned load${pickupOverdue.length === 1 ? '' : 's'} past pickup date`,
      detail: 'These loads are still Assigned after their scheduled pickup date.',
      link: '/shipments',
      count: pickupOverdue.length,
    });
  }

  const deliveryOverdue = data.shipments.filter(
    (shipment) => shipment.status === 'In Transit'
      && Boolean(shipment.estimatedDeliveryDate)
      && shipment.estimatedDeliveryDate < asOf,
  );
  if (deliveryOverdue.length > 0) {
    notifications.push({
      id: 'employee-overdue-deliveries',
      severity: 'critical',
      title: `${deliveryOverdue.length} in-transit load${deliveryOverdue.length === 1 ? '' : 's'} past delivery date`,
      detail: 'These loads are still In Transit after their estimated delivery date.',
      link: '/shipments',
      count: deliveryOverdue.length,
    });
  }

  const order: Record<NotificationSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return notifications.sort((a, b) => order[a.severity] - order[b.severity]);
}

function sum(values: number[]): number {
  return round2(values.reduce((total, value) => total + value, 0));
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}
