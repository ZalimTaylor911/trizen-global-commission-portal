import { describe, expect, it } from 'vitest';
import {
  addDays,
  computeAgeing,
  computeArSummary,
  computeCustomerAr,
  computeReceivable,
  computeReceivables,
  daysBetween,
} from './receivables';
import type { Customer, Shipment, ShipmentStatus } from './types';

const TODAY = '2026-08-01';

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'acme',
    companyName: 'Acme Foods',
    poc: 'Dana Whitfield',
    phone: '',
    email: '',
    billingAddress: '',
    shippingAddress: '',
    notes: '',
    paymentTermsDays: 15,
    creditLimit: null,
    taxId: '',
    agencyIds: [],
    active: true,
    ...overrides,
  };
}

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'ship-1',
    month: '2026-07',
    date: '2026-07-01',
    customerId: 'acme',
    companyName: 'Acme Foods',
    poc: 'Dana',
    lane: 'Chicago, IL → Dallas, TX',
    ar: 3000,
    carrierName: 'Blue Line',
    ap: 2300,
    grossMargin: 700,
    netMargin: 350,
    loadNumber: 'L-1',
    status: 'Completed',
    shipmentType: 'FTL',
    agencyId: 'glt',
    invoicedDate: '2026-07-01',
    transitDays: 3,
    actualPickupDate: '',
    estimatedDeliveryDate: '',
    actualDeliveryDate: '',
    notes: '',
    ...overrides,
  };
}

describe('date helpers', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-07-01', 15)).toBe('2026-07-16');
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
  });

  it('adds days across a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-28', 2)).toBe('2028-03-01');
  });

  it('counts days in both directions', () => {
    expect(daysBetween('2026-07-01', '2026-07-16')).toBe(15);
    expect(daysBetween('2026-08-01', '2026-07-16')).toBe(-16);
    expect(daysBetween('2026-07-01', '2026-07-01')).toBe(0);
  });
});

describe('computeReceivable — SPEC.md §14', () => {
  it('sets the due date from the customer payment terms', () => {
    // The spec's example: invoiced 1 July on Net 15 is due 16 July.
    const receivable = computeReceivable(shipment(), customer(), TODAY);

    expect(receivable.invoicedDate).toBe('2026-07-01');
    expect(receivable.dueDate).toBe('2026-07-16');
    expect(receivable.paymentTermsDays).toBe(15);
  });

  it('honours each customer their own terms', () => {
    const net30 = computeReceivable(shipment(), customer({ paymentTermsDays: 30 }), TODAY);
    const onReceipt = computeReceivable(shipment(), customer({ paymentTermsDays: 0 }), TODAY);

    expect(net30.dueDate).toBe('2026-07-31');
    expect(onReceipt.dueDate).toBe('2026-07-01');
  });

  it('flags an unpaid invoice past its due date as overdue', () => {
    const receivable = computeReceivable(shipment(), customer(), TODAY);

    expect(receivable.state).toBe('overdue');
    // Due 16 July, today is 1 August.
    expect(receivable.daysPastDue).toBe(16);
  });

  it('is open, not overdue, on the due date itself', () => {
    const receivable = computeReceivable(shipment(), customer(), '2026-07-16');

    expect(receivable.state).toBe('open');
    expect(receivable.daysUntilDue).toBe(0);
    expect(receivable.daysPastDue).toBe(0);
  });

  it('raises no receivable until the load is Completed', () => {
    for (const status of ['Assigned', 'In Transit', 'Delivered'] as ShipmentStatus[]) {
      expect(computeReceivable(shipment({ status }), customer(), TODAY).state).toBe('not-invoiced');
    }
  });

  it('keeps a billed load outstanding, dated from its invoice date', () => {
    // Invoiced 25 July on Net 15 falls due 9 August, so on 1 August it is open.
    const receivable = computeReceivable(
      shipment({ status: 'Billed', invoicedDate: '2026-07-25' }),
      customer(),
      TODAY,
    );

    expect(receivable.state).toBe('open');
    expect(receivable.dueDate).toBe('2026-08-09');
    expect(receivable.daysUntilDue).toBe(8);
  });

  it('flags a billed load that has run past its terms as overdue', () => {
    const receivable = computeReceivable(shipment({ status: 'Billed' }), customer(), TODAY);

    expect(receivable.state).toBe('overdue');
    expect(receivable.daysPastDue).toBe(16);
  });

  it('closes the receivable once the customer pays', () => {
    for (const status of ['Customer Paid', 'Agency Paid'] as unknown as ShipmentStatus[]) {
      const receivable = computeReceivable(shipment({ status }), customer(), TODAY);
      expect(receivable.state).toBe('settled');
      expect(receivable.daysPastDue).toBe(0);
    }
  });

  it('writes off dissolved, claimed and TONU loads rather than chasing them', () => {
    for (const status of ['Dissolved', 'Claim', 'TONU'] as ShipmentStatus[]) {
      expect(computeReceivable(shipment({ status }), customer(), TODAY).state).toBe('written-off');
    }
  });

  it('keeps a disputed invoice in the outstanding pile', () => {
    const receivable = computeReceivable(
      shipment({ status: 'Issue / Dispute' }),
      customer(),
      TODAY,
    );
    expect(receivable.state).toBe('overdue');
  });

  it('falls back to the load date when accounting has not given an invoice date', () => {
    const receivable = computeReceivable(
      shipment({ invoicedDate: '', date: '2026-07-10' }),
      customer(),
      TODAY,
    );
    expect(receivable.invoicedDate).toBe('2026-07-10');
    expect(receivable.dueDate).toBe('2026-07-25');
  });

  it('defaults to Net 30 for a load with no customer record', () => {
    const receivable = computeReceivable(shipment({ customerId: '' }), undefined, TODAY);
    expect(receivable.paymentTermsDays).toBe(30);
    expect(receivable.dueDate).toBe('2026-07-31');
    expect(receivable.customerName).toBe('Acme Foods');
  });
});

describe('computeArSummary', () => {
  const customers = [
    customer({ id: 'acme', companyName: 'Acme Foods', paymentTermsDays: 30 }),
    customer({ id: 'northwind', companyName: 'Northwind', paymentTermsDays: 15 }),
  ];

  const shipments = [
    // Due today: invoiced 2 July, Net 30 → due 1 August.
    shipment({ id: 'a', ar: 1000, invoicedDate: '2026-07-02', customerId: 'acme' }),
    // Due in 4 days.
    shipment({ id: 'b', ar: 2000, invoicedDate: '2026-07-06', customerId: 'acme' }),
    // Overdue by 32 days: invoiced 15 June, Net 15 → due 30 June.
    shipment({ id: 'c', ar: 500, invoicedDate: '2026-06-15', customerId: 'northwind' }),
    // Paid, so out of the picture.
    shipment({ id: 'd', ar: 9000, status: 'Customer Paid', customerId: 'acme' }),
    // Not invoiced yet.
    shipment({ id: 'e', ar: 4000, status: 'In Transit', customerId: 'acme' }),
  ];

  const receivables = computeReceivables(shipments, customers, TODAY);
  const summary = computeArSummary(receivables, TODAY);

  it('counts only unpaid invoiced loads as outstanding', () => {
    expect(summary.outstandingCount).toBe(3);
    expect(summary.totalOutstanding).toBe(3500);
  });

  it('separates due today, due this week and overdue', () => {
    expect(summary.dueTodayCount).toBe(1);
    expect(summary.dueTodayAmount).toBe(1000);

    // Both the one due today and the one due in 4 days.
    expect(summary.dueThisWeekCount).toBe(2);
    expect(summary.dueThisWeekAmount).toBe(3000);

    expect(summary.overdueCount).toBe(1);
    expect(summary.overdueAmount).toBe(500);
    expect(summary.worstDaysPastDue).toBe(32);
  });

  it('reports how long money has been sitting out', () => {
    // Ages at 1 August: 30, 26 and 47 days → mean 34.
    expect(summary.averageDaysOutstanding).toBe(34);
  });

  it('reports zeroes rather than NaN when nothing is outstanding', () => {
    const empty = computeArSummary([], TODAY);
    expect(empty.totalOutstanding).toBe(0);
    expect(empty.averageDaysOutstanding).toBe(0);
  });

  it('ranks customers by what they owe', () => {
    const rows = computeCustomerAr(receivables);

    expect(rows[0]?.customerName).toBe('Acme Foods');
    expect(rows[0]?.outstanding).toBe(3000);
    expect(rows[0]?.overdueCount).toBe(0);

    expect(rows[1]?.customerName).toBe('Northwind');
    expect(rows[1]?.overdue).toBe(500);
    expect(rows[1]?.worstDaysPastDue).toBe(32);
  });

  it('buckets the outstanding money by age', () => {
    const buckets = computeAgeing(receivables);
    const byLabel = Object.fromEntries(buckets.map((b) => [b.label, b]));

    expect(byLabel['Not yet due']?.amount).toBe(3000);
    expect(byLabel['31–60 days']?.amount).toBe(500);
    expect(byLabel['Over 90 days']?.count).toBe(0);
  });
});
