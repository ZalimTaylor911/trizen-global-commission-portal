import { describe, expect, it } from 'vitest';
import { computeEmployeeNotifications } from './notifications';
import type { Customer, Shipment } from './types';

function shipment(overrides: Partial<Shipment>): Shipment {
  return {
    id: 'load-1',
    month: '2026-09',
    date: '2026-09-01',
    customerId: 'customer-1',
    companyName: 'Acme',
    poc: '',
    lane: '',
    ar: 1000,
    carrierName: '',
    ap: 500,
    grossMargin: 500,
    netMargin: 250,
    loadNumber: 'L-1',
    status: 'Assigned',
    shipmentType: 'FTL',
    agencyId: 'agency-1',
    ownerType: 'employee',
    employeeId: 'employee-1',
    employeeCommissionTiers: null,
    employeeMaxCommissionPercent: null,
    employeeCommissionBasisPercent: null,
    agencyPaid: false,
    agencyPaidAt: null,
    customerPaidAt: null,
    invoicedDate: '',
    transitDays: 2,
    actualPickupDate: '',
    estimatedDeliveryDate: '',
    actualDeliveryDate: '',
    notes: '',
    ...overrides,
  };
}

const customer: Customer = {
  id: 'customer-1',
  companyName: 'Acme',
  poc: '',
  phone: '',
  email: '',
  billingAddress: '',
  shippingAddress: '',
  notes: '',
  paymentTermsDays: 30,
  creditLimit: null,
  taxId: '',
  agencyIds: [],
  active: true,
};

function notifications(shipments: Shipment[]) {
  return computeEmployeeNotifications(
    { shipments, agencies: [], partners: [], expenses: [], withdrawals: [] },
    [customer],
    '2026-09-20',
  );
}

describe('computeEmployeeNotifications', () => {
  it('flags overdue and outstanding invoices for employee loads', () => {
    const result = notifications([
      shipment({ id: 'overdue', status: 'Billed', date: '2026-08-01', invoicedDate: '2026-08-01' }),
      shipment({ id: 'open', status: 'Billed', date: '2026-09-01', invoicedDate: '2026-09-01' }),
    ]);

    expect(result.map((entry) => entry.id)).toEqual([
      'employee-overdue-invoices',
      'employee-outstanding-invoices',
    ]);
    expect(result[0]?.count).toBe(1);
    expect(result[1]?.count).toBe(2);
  });

  it('flags assigned pickups and in-transit deliveries past their dates', () => {
    const result = notifications([
      shipment({ id: 'pickup', date: '2026-09-01' }),
      shipment({
        id: 'delivery',
        status: 'In Transit',
        date: '2026-09-01',
        actualPickupDate: '2026-09-02',
        estimatedDeliveryDate: '2026-09-10',
      }),
    ]);

    expect(result.map((entry) => entry.id)).toEqual([
      'employee-overdue-deliveries',
      'employee-overdue-pickups',
    ]);
    expect(result.find((entry) => entry.id === 'employee-overdue-pickups')?.count).toBe(1);
    expect(result.find((entry) => entry.id === 'employee-overdue-deliveries')?.count).toBe(1);
  });
});
