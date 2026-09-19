import { describe, expect, it } from 'vitest';
import { allocate, allocateEqually, round2 } from './money';
import {
  computeFinancialSummary,
  computeEmployeeSettlements,
  computeLedgers,
  computeNetMargin,
  computeOperationsSummary,
  freezeCommissionSplit,
  splitExpense,
  splitShipment,
  validateAgency,
  validatePartnerShares,
} from './engine';
import { buildReport, EMPTY_FILTERS } from '@/lib/reports';
import type { Agency, Employee, Expense, Partner, Shipment, Withdrawal } from './types';

const glt: Agency = {
  id: 'glt',
  name: 'GLT Logistics',
  agentPercent: 50,
  agencyPercent: 50,
  active: true,
};

const partners: Partner[] = [
  {
    id: 'shabbir',
    name: 'Shabbir',
    email: 'shabbir@trizen.test',
    role: 'admin',
    sharePercent: 25,
    bearsOperationalExpenses: true,
    active: true,
  },
  {
    id: 'abrar',
    name: 'Abrar',
    email: 'abrar@trizen.test',
    role: 'partner',
    sharePercent: 25,
    bearsOperationalExpenses: true,
    active: true,
  },
  {
    id: 'muddasir',
    name: 'Muddasir',
    email: 'muddasir@trizen.test',
    role: 'partner',
    sharePercent: 25,
    bearsOperationalExpenses: true,
    active: true,
  },
  {
    id: 'muzammil',
    name: 'Muzammil',
    email: 'muzammil@trizen.test',
    role: 'partner',
    sharePercent: 20,
    bearsOperationalExpenses: false,
    active: true,
  },
  {
    id: 'allah',
    name: 'Allah',
    email: 'allah@trizen.test',
    role: 'partner',
    sharePercent: 5,
    bearsOperationalExpenses: false,
    active: true,
  },
];

/**
 * Builds a shipment with a net margin already derived from its gross, the way
 * the entry form and the bulk importer do it.
 */
function shipment(overrides: Partial<Shipment> = {}, agency: Agency = glt): Shipment {
  const base: Shipment = {
    id: 'ship-1',
    month: '2026-07',
    date: '2026-07-15',
    customerId: 'acme',
    companyName: 'Acme Foods',
    poc: 'Dana',
    lane: 'Chicago, IL → Dallas, TX',
    ar: 3000,
    carrierName: 'Blue Line Trucking',
    ap: 2000,
    grossMargin: 1000,
    netMargin: 0,
    loadNumber: 'L-1001',
    status: 'Customer Paid',
    agencyPaid: true,
    shipmentType: 'FTL',
    agencyId: 'glt',
    invoicedDate: '',
    transitDays: 0,
    actualPickupDate: '',
    estimatedDeliveryDate: '',
    actualDeliveryDate: '',
    notes: '',
    ...overrides,
  };
  return {
    ...base,
    netMargin: overrides.netMargin ?? computeNetMargin(base.grossMargin, agency),
  };
}

describe('computeNetMargin — SPEC.md §5', () => {
  it('takes our share out of the gross margin', () => {
    // The owner's worked example: gross 700 at 50/50 leaves us 350.
    expect(computeNetMargin(700, glt)).toBe(350);
  });

  it('follows each agency its own split', () => {
    const sixty: Agency = { ...glt, agentPercent: 60, agencyPercent: 40 };
    const seventy: Agency = { ...glt, agentPercent: 70, agencyPercent: 30 };

    expect(computeNetMargin(700, sixty)).toBe(420);
    expect(computeNetMargin(700, seventy)).toBe(490);
  });

  it('returns zero when no agency is attached', () => {
    expect(computeNetMargin(700, undefined)).toBe(0);
  });

  it('never loses a cent on an odd gross', () => {
    const gross = 700.01;
    const net = computeNetMargin(gross, glt);
    expect(round2(gross - net) + net).toBeCloseTo(gross, 10);
  });
});

describe('splitShipment — SPEC.md §5', () => {
  it('treats net margin as the team commission and the remainder as the agency cut', () => {
    const split = splitShipment(shipment({ grossMargin: 700 }), partners);

    expect(split.grossMargin).toBe(700);
    expect(split.netMargin).toBe(350);
    expect(split.agencyEarnings).toBe(350);
    expect(split.teamCommission).toBe(350);
  });

  it('distributes our share across the five partners', () => {
    const split = splitShipment(shipment({ grossMargin: 2000 }), partners);

    // 2000 gross @ 50/50 → 1000 to us, then 25/25/25/20/5.
    expect(split.teamCommission).toBe(1000);
    expect(split.partnerEarnings).toEqual({
      shabbir: 250,
      abrar: 250,
      muddasir: 250,
      muzammil: 200,
      allah: 50,
    });
  });

  it('earns nothing until the agency payment is recorded', () => {
    for (const status of ['Assigned', 'In Transit', 'Delivered', 'Customer Paid'] as const) {
      const split = splitShipment(shipment({ status, agencyPaid: false }), partners);
      expect(split.agencyEarnings).toBe(0);
      expect(split.teamCommission).toBe(0);
      expect(Object.values(split.partnerEarnings).every((v) => v === 0)).toBe(true);
    }
  });

  it('applies each agency its own split', () => {
    const agencyB: Agency = { ...glt, id: 'b', name: 'Agency B', agentPercent: 60, agencyPercent: 40 };
    const split = splitShipment(
      shipment({ grossMargin: 1000, agencyId: 'b' }, agencyB),
      partners,
    );

    expect(split.agencyEarnings).toBe(400);
    expect(split.teamCommission).toBe(600);
    expect(split.partnerEarnings.shabbir).toBe(150);
    expect(split.partnerEarnings.allah).toBe(30);
  });

  it('never loses a cent, even on amounts that do not divide cleanly', () => {
    const split = splitShipment(shipment({ grossMargin: 1000.01 }), partners);

    expect(split.agencyEarnings + split.teamCommission).toBeCloseTo(1000.01, 10);
    const distributed = Object.values(split.partnerEarnings).reduce((a, b) => a + b, 0);
    expect(distributed).toBeCloseTo(split.teamCommission, 10);
  });

  it('keeps history stable when an agency later changes its split', () => {
    // A load booked at 50/50 must still report 50/50 after the agency moves to 70/30.
    const booked = shipment({ grossMargin: 1000 });
    const split = splitShipment(booked, partners);

    expect(split.teamCommission).toBe(500);
    expect(split.agencyEarnings).toBe(500);
  });
});

describe('splitExpense — SPEC.md §6', () => {
  it('charges an operational expense only to the three active partners', () => {
    const expense: Expense = {
      id: 'e1',
      type: 'operational',
      categoryId: 'rent',
      amount: 300,
      date: '2026-07-01',
      month: '2026-07',
      notes: '',
    };

    expect(splitExpense(expense, partners)).toEqual({
      shabbir: 100,
      abrar: 100,
      muddasir: 100,
      muzammil: 0,
      allah: 0,
    });
  });

  it('charges an agency deduction by commission share across all active partners', () => {
    const expense: Expense = {
      id: 'e2',
      type: 'agency-deduction',
      categoryId: 'claim',
      amount: 100,
      date: '2026-07-01',
      month: '2026-07',
      notes: '',
    };

    expect(splitExpense(expense, partners)).toEqual({
      shabbir: 25,
      abrar: 25,
      muddasir: 25,
      muzammil: 20,
      allah: 5,
    });
  });

  it('reduces the team pool before partner shares are applied', () => {
    const expense: Expense = {
      id: 'e3',
      type: 'agency-deduction',
      categoryId: 'claim',
      amount: 500,
      date: '2026-07-01',
      month: '2026-07',
      notes: '',
    };
    const split = splitExpense(expense, partners);

    // Allah's 5% share bears 5% of every agency deduction.
    expect(split.allah).toBe(25);
    expect(split.shabbir).toBe(125);
  });

  it('gives Allah a $2.50 share of a $50 agency deduction', () => {
    const split = splitExpense(
      {
        id: 'e4', type: 'agency-deduction', categoryId: 'claim', amount: 50,
        date: '2026-07-01', month: '2026-07', notes: '',
      },
      partners,
    );
    expect(split.allah).toBe(2.5);
  });
});

describe('computeLedgers — SPEC.md §7 and §12', () => {
  // $8,000 gross at 50/50 leaves us $4,000, which splits into the
  // 1000/1000/1000/800/200 balances used in the spec's withdrawal example.
  const eightThousand = shipment({ id: 'big', grossMargin: 8000 });

  it('produces the balances from the withdrawal example', () => {
    const ledgers = computeLedgers({
      shipments: [eightThousand],
      agencies: [glt],
      partners,
      expenses: [],
      withdrawals: [],
    });

    const balances = Object.fromEntries(ledgers.map((l) => [l.partnerId, l.balance]));
    expect(balances).toEqual({
      shabbir: 1000,
      abrar: 1000,
      muddasir: 1000,
      muzammil: 800,
      allah: 200,
    });
  });

  it('reduces the partner balance and the outstanding total on withdrawal', () => {
    const withdrawal: Withdrawal = {
      id: 'w1',
      partnerId: 'muddasir',
      amount: 500,
      date: '2026-07-20',
      month: '2026-07',
      notes: 'Cash out',
    };

    const data = {
      shipments: [eightThousand],
      agencies: [glt],
      partners,
      expenses: [],
      withdrawals: [withdrawal],
    };

    const ledgers = computeLedgers(data);
    const muddasir = ledgers.find((l) => l.partnerId === 'muddasir')!;

    expect(muddasir.balance).toBe(500);
    expect(muddasir.withdrawals).toBe(500);
    expect(computeFinancialSummary(data).totalOutstandingBalance).toBe(3500);
  });

  it('subtracts operational expenses from active partners only', () => {
    const data = {
      shipments: [eightThousand],
      agencies: [glt],
      partners,
      expenses: [
        {
          id: 'e1',
          type: 'operational' as const,
          categoryId: 'rent',
          amount: 300,
          date: '2026-07-01',
          month: '2026-07',
          notes: '',
        },
      ],
      withdrawals: [],
    };

    const ledgers = computeLedgers(data);
    const byId = Object.fromEntries(ledgers.map((l) => [l.partnerId, l]));

    expect(byId.shabbir!.balance).toBe(900);
    expect(byId.muzammil!.balance).toBe(800);
    expect(byId.muzammil!.operationalExpenses).toBe(0);
    expect(byId.allah!.balance).toBe(200);
  });
});

describe('computeFinancialSummary', () => {
  it('counts only agency-paid shipments as earned and the rest as pipeline', () => {
    const data = {
      shipments: [
        shipment({ id: 'a', status: 'Customer Paid', agencyPaid: true }),
        shipment({ id: 'b', status: 'Delivered', agencyPaid: false }),
        shipment({ id: 'c', status: 'Dissolved', agencyPaid: false }),
        // Written off alongside Dissolved and Claim — SPEC.md §14 — so it is
        // neither earned nor money we expect to see.
        shipment({ id: 'd', status: 'TONU', agencyPaid: false }),
      ],
      agencies: [glt],
      partners,
      expenses: [],
      withdrawals: [],
    };

    const summary = computeFinancialSummary(data);

    expect(summary.totalLoads).toBe(4);
    expect(summary.earnedLoads).toBe(1);
    expect(summary.totalGrossMargin).toBe(1000);
    expect(summary.totalNetMargin).toBe(500);
    // Our share and the team commission are the same figure by definition.
    expect(summary.totalTeamCommission).toBe(500);
    expect(summary.totalAgencyCommission).toBe(500);

    // Delivered counts as pipeline; Dissolved and TONU are written off entirely.
    expect(summary.pipelineLoads).toBe(1);
    expect(summary.pipelineNetMargin).toBe(500);
  });

  it('reports margin percentage against revenue', () => {
    const data = {
      shipments: [shipment({ ar: 4000, ap: 3000, grossMargin: 1000 })],
      agencies: [glt],
      partners,
      expenses: [],
      withdrawals: [],
    };

    const summary = computeFinancialSummary(data);

    expect(summary.totalRevenue).toBe(4000);
    expect(summary.grossMarginPercent).toBe(25);
    expect(summary.averageNetPerLoad).toBe(500);
  });
});

describe('frozen commission shares — SPEC.md §12', () => {
  it('stamps the current shares onto a load as it becomes earned', () => {
    const frozen = freezeCommissionSplit(shipment({ status: 'Customer Paid', agencyPaid: true }), partners);

    expect(frozen.commissionSplit).toEqual([
      { partnerId: 'shabbir', sharePercent: 25 },
      { partnerId: 'abrar', sharePercent: 25 },
      { partnerId: 'muddasir', sharePercent: 25 },
      { partnerId: 'muzammil', sharePercent: 20 },
      { partnerId: 'allah', sharePercent: 5 },
    ]);
  });

  it('leaves a load that is not yet earned unstamped', () => {
    expect(freezeCommissionSplit(shipment({ status: 'Billed', agencyPaid: false }), partners).commissionSplit)
      .toBeUndefined();
  });

  it('never overwrites a stamp that is already there', () => {
    const booked = [{ partnerId: 'shabbir', sharePercent: 100 }];
    const frozen = freezeCommissionSplit(
      shipment({ status: 'Customer Paid', agencyPaid: true, commissionSplit: booked }),
      partners,
    );

    expect(frozen.commissionSplit).toBe(booked);
  });

  it('drops the stamp when an agency-paid load is reverted', () => {
    const frozen = freezeCommissionSplit(
      shipment({ status: 'Customer Paid', agencyPaid: false, commissionSplit: [{ partnerId: 'shabbir', sharePercent: 100 }] }),
      partners,
    );

    expect(frozen.commissionSplit).toBeNull();
  });

  it('keeps an earned load on the shares it was paid under when they later change', () => {
    // Booked under the 25/25/25/20/5 split, on $1,000 of team commission.
    const earned = freezeCommissionSplit(shipment({ status: 'Customer Paid', agencyPaid: true, netMargin: 1000 }), partners);

    // The team later moves to an even five-way split.
    const revised = partners.map((partner) => ({ ...partner, sharePercent: 20 }));
    const split = splitShipment(earned as Shipment, revised);

    expect(split.partnerEarnings.shabbir).toBe(250);
    expect(split.partnerEarnings.muzammil).toBe(200);
    expect(split.partnerEarnings.allah).toBe(50);

    // An unstamped load — one not yet earned when the shares changed — follows
    // the new percentages instead.
    const unstamped = splitShipment(shipment({ status: 'Customer Paid', agencyPaid: true, netMargin: 1000 }), revised);
    expect(unstamped.partnerEarnings.allah).toBe(200);
  });

  it('does not re-spread an earned balance when a share is edited', () => {
    const data = {
      shipments: [freezeCommissionSplit(shipment({ status: 'Customer Paid', agencyPaid: true, netMargin: 1000 }), partners) as Shipment],
      agencies: [glt],
      partners,
      expenses: [],
      withdrawals: [],
    };

    const before = computeLedgers(data).find((l) => l.partnerId === 'allah')?.balance;
    const after = computeLedgers({
      ...data,
      partners: partners.map((p) => (p.id === 'allah' ? { ...p, sharePercent: 20 } : p)),
    }).find((l) => l.partnerId === 'allah')?.balance;

    expect(before).toBe(50);
    expect(after).toBe(50);
  });
});

describe('computeOperationsSummary — SPEC.md §4', () => {
  it('counts billed loads separately from completed ones', () => {
    const summary = computeOperationsSummary([
      shipment({ id: 'a', status: 'Completed' }),
      shipment({ id: 'b', status: 'Billed' }),
      shipment({ id: 'c', status: 'Billed' }),
      shipment({ id: 'd', status: 'Customer Paid' }),
    ]);

    expect(summary.completed).toBe(1);
    expect(summary.billed).toBe(2);
    expect(summary.customerPaid).toBe(1);
    // Billed is past delivery, so it is no longer an active load.
    expect(summary.activeLoads).toBe(0);
  });
});

describe('commission is unaffected by Billed', () => {
  it('earns nothing until Agency Paid, whatever the billing status', () => {
    const data = {
      shipments: [shipment({ id: 'a', status: 'Billed', agencyPaid: false })],
      agencies: [glt],
      partners,
      expenses: [],
      withdrawals: [],
    };

    const summary = computeFinancialSummary(data);

    expect(summary.earnedLoads).toBe(0);
    expect(summary.totalTeamCommission).toBe(0);
    // It is money coming, though, so it still shows up as pipeline.
    expect(summary.pipelineLoads).toBe(1);
    expect(summary.pipelineNetMargin).toBe(500);
    expect(computeLedgers(data).every((ledger) => ledger.totalEarned === 0)).toBe(true);
  });
});

describe('validation', () => {
  it('warns when partner shares do not total 100', () => {
    const skewed = partners.map((p) => (p.id === 'allah' ? { ...p, sharePercent: 10 } : p));
    expect(validatePartnerShares(skewed)).toHaveLength(1);
    expect(validatePartnerShares(partners)).toHaveLength(0);
  });

  it('rejects an agency split that does not total 100', () => {
    expect(validateAgency({ agentPercent: 50, agencyPercent: 50 })).toBeNull();
    expect(validateAgency({ agentPercent: 60, agencyPercent: 50 })).toContain('100%');
  });
});

describe('employee monthly settlement', () => {
  const employee: Employee = {
    id: 'sam', name: 'Sam', maxCommissionPercent: 30,
    commissionTiers: [
      { minBusiness: 0, maxBusiness: 1000, commissionPercent: 15 },
      { minBusiness: 1000.01, maxBusiness: 2000, commissionPercent: 17 },
      { minBusiness: 2000.01, maxBusiness: null, commissionPercent: 35 },
    ],
    active: true,
  };

  it('selects one matching tier for the full month, even when its rate is above the fallback rate', () => {
    const first = shipment({ id: 'employee-1', grossMargin: 3000, ownerType: 'employee', employeeId: 'sam', employeeCommissionTiers: employee.commissionTiers, employeeMaxCommissionPercent: 30 });
    const second = shipment({ id: 'employee-2', grossMargin: 3000, ownerType: 'employee', employeeId: 'sam', employeeCommissionTiers: employee.commissionTiers, employeeMaxCommissionPercent: 30 });
    const data = { shipments: [first, second], agencies: [glt], partners, employees: [employee], expenses: [], withdrawals: [] };

    const settlement = computeEmployeeSettlements(data)[0]!;
    expect(settlement.totalGenerated).toBe(3000);
    expect(settlement.applicableTier?.commissionPercent).toBe(35);
    expect(settlement.commissionPercent).toBe(35);
    expect(settlement.usesMaximumRateFallback).toBe(false);
    expect(settlement.finalPayout).toBe(1050);
    expect(settlement.amountRemainingForPartners).toBe(1950);
    expect(Object.values(settlement.payoutByShipmentId).reduce((sum, amount) => sum + amount, 0)).toBe(1050);
    // An unpaid settlement is only a liability: the team balance is unchanged
    // until the admin marks the employee payment paid.
    expect(computeLedgers(data).reduce((sum, ledger) => sum + ledger.totalEarned, 0)).toBe(3000);
  });

  it('falls back to the employee maximum rate when the monthly business matches no tier', () => {
    const fallbackEmployee: Employee = {
      ...employee,
      maxCommissionPercent: 20,
      commissionTiers: [{ minBusiness: 0, maxBusiness: 5000, commissionPercent: 15 }],
    };
    const load = shipment({
      id: 'outside-tier', grossMargin: 14000, ownerType: 'employee', employeeId: 'sam',
      employeeCommissionTiers: fallbackEmployee.commissionTiers, employeeMaxCommissionPercent: 20,
    });
    const settlement = computeEmployeeSettlements({
      shipments: [load], agencies: [glt], partners, employees: [fallbackEmployee], expenses: [], withdrawals: [],
    })[0]!;

    expect(settlement.commissionBasisGenerated).toBe(7000);
    expect(settlement.applicableTier).toBeNull();
    expect(settlement.usesMaximumRateFallback).toBe(true);
    expect(settlement.commissionPercent).toBe(20);
    expect(settlement.commissionCalculated).toBe(1400);
  });

  it('keeps the real agency margin for partners but pays employee commission from their disclosed basis', () => {
    const internal: Agency = { ...glt, agentPercent: 75, agencyPercent: 25, employeeCommissionBasisPercent: 60 };
    const employeeTerms: Employee = {
      ...employee, compensationType: 'salary-plus-commission', monthlySalary: 200,
      commissionTiers: [{ minBusiness: 0, maxBusiness: null, commissionPercent: 10 }],
    };
    const load = shipment({
      id: 'private-split', grossMargin: 1000, agencyId: internal.id, ownerType: 'employee', employeeId: 'sam',
      employeeCommissionBasisPercent: 60, employeeCommissionTiers: employeeTerms.commissionTiers,
      employeeMaxCommissionPercent: 30,
    }, internal);
    const data = { shipments: [load], agencies: [internal], partners, employees: [employeeTerms], expenses: [], withdrawals: [] };
    const settlement = computeEmployeeSettlements(data)[0]!;

    expect(load.netMargin).toBe(750); // internal 75/25 book
    expect(settlement.commissionBasisGenerated).toBe(600); // employee sees 60/40
    expect(settlement.commissionCalculated).toBe(60);
    expect(settlement.baseSalary).toBe(200);
    expect(settlement.finalPayout).toBe(260);
    expect(settlement.amountRemainingForPartners).toBe(490);
    expect(computeLedgers(data).reduce((sum, ledger) => sum + ledger.totalEarned, 0)).toBe(750);
  });

  it('uses the approved tier instead of a 0% registration placeholder captured on an earlier load', () => {
    const approvedEmployee: Employee = {
      ...employee,
      agencyBasisPercent: 60,
      // A zero cap is the old pending-registration placeholder and must mean
      // unconfigured, not silently cap every approved tier at zero.
      maxCommissionPercent: 0,
      commissionTiers: [{ minBusiness: 0, maxBusiness: null, commissionPercent: 15 }],
    };
    const load = shipment({
      id: 'registered-before-configured', grossMargin: 1000, ownerType: 'employee', employeeId: 'sam',
      employeeCommissionBasisPercent: 75,
      employeeCommissionTiers: [{ minBusiness: 0, maxBusiness: null, commissionPercent: 0 }],
      employeeMaxCommissionPercent: 0,
    });
    const settlement = computeEmployeeSettlements({
      shipments: [load], agencies: [glt], partners, employees: [approvedEmployee], expenses: [], withdrawals: [],
    })[0]!;

    expect(settlement.commissionBasisGenerated).toBe(600);
    expect(settlement.applicableTier?.commissionPercent).toBe(15);
    expect(settlement.commissionPercent).toBe(15);
    expect(settlement.commissionCalculated).toBe(90);
  });

  it('pays salary-only employees without applying their stored commission tiers', () => {
    const salaryEmployee: Employee = {
      ...employee,
      compensationType: 'salary',
      monthlySalary: 1200,
      commissionTiers: [{ minBusiness: 0, maxBusiness: null, commissionPercent: 50 }],
    };
    const load = shipment({
      ownerType: 'employee', employeeId: 'sam', employeeCommissionTiers: salaryEmployee.commissionTiers,
      employeeMaxCommissionPercent: 50,
    });
    const settlement = computeEmployeeSettlements({
      shipments: [load], agencies: [glt], partners, employees: [salaryEmployee], expenses: [], withdrawals: [],
    })[0]!;

    expect(settlement.commissionCalculated).toBe(250);
    expect(settlement.baseSalary).toBe(1200);
    expect(settlement.finalPayout).toBe(1200);
  });

  it('builds a branded-pay-slip-ready report for a selected employee', () => {
    const profile: Employee = {
      ...employee, firstName: 'Sam', lastName: 'Taylor', contactPhone: '555-0100',
      address: '100 Main Street', email: 'sam@example.test', compensationType: 'commission',
    };
    const load = shipment({ ownerType: 'employee', employeeId: 'sam', employeeCommissionTiers: profile.commissionTiers, employeeMaxCommissionPercent: 30 });
    const report = buildReport('employee-payslip', {
      shipments: [load], agencies: [glt], partners, employees: [profile], expenses: [], withdrawals: [],
    }, { ...EMPTY_FILTERS, employeeId: 'sam' }, []);

    expect(report.payslips).toHaveLength(1);
    expect(report.payslips?.[0]).toMatchObject({ employeeName: 'Sam', employeeEmail: 'sam@example.test', employeePhone: '555-0100' });
    expect(report.sheets[0]?.rows).toHaveLength(1);
  });
});

describe('money allocation', () => {
  it('conserves the total when a split does not divide evenly', () => {
    const parts = allocateEqually(100, 3);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
  });

  it('handles zero weights without producing NaN', () => {
    expect(allocate(100, [0, 0])).toEqual([0, 0]);
  });

  it('conserves negative totals too', () => {
    const parts = allocate(-100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(-100, 10);
  });
});
