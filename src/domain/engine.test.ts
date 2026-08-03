import { describe, expect, it } from 'vitest';
import { allocate, allocateEqually, round2 } from './money';
import {
  computeFinancialSummary,
  computeLedgers,
  computeNetMargin,
  computeOperationsSummary,
  freezeCommissionSplit,
  splitExpense,
  splitShipment,
  validateAgency,
  validatePartnerShares,
} from './engine';
import type { Agency, Expense, Partner, Shipment, Withdrawal } from './types';

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
    status: 'Agency Paid',
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

  it('earns nothing until the shipment reaches Agency Paid', () => {
    for (const status of ['Assigned', 'In Transit', 'Delivered', 'Customer Paid'] as const) {
      const split = splitShipment(shipment({ status }), partners);
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
  it('counts only Agency Paid shipments as earned and the rest as pipeline', () => {
    const data = {
      shipments: [
        shipment({ id: 'a', status: 'Agency Paid' }),
        shipment({ id: 'b', status: 'Delivered' }),
        shipment({ id: 'c', status: 'Dissolved' }),
        // Written off alongside Dissolved and Claim — SPEC.md §14 — so it is
        // neither earned nor money we expect to see.
        shipment({ id: 'd', status: 'TONU' }),
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
    const frozen = freezeCommissionSplit(shipment({ status: 'Agency Paid' }), partners);

    expect(frozen.commissionSplit).toEqual([
      { partnerId: 'shabbir', sharePercent: 25 },
      { partnerId: 'abrar', sharePercent: 25 },
      { partnerId: 'muddasir', sharePercent: 25 },
      { partnerId: 'muzammil', sharePercent: 20 },
      { partnerId: 'allah', sharePercent: 5 },
    ]);
  });

  it('leaves a load that is not yet earned unstamped', () => {
    expect(freezeCommissionSplit(shipment({ status: 'Billed' }), partners).commissionSplit)
      .toBeUndefined();
  });

  it('never overwrites a stamp that is already there', () => {
    const booked = [{ partnerId: 'shabbir', sharePercent: 100 }];
    const frozen = freezeCommissionSplit(
      shipment({ status: 'Agency Paid', commissionSplit: booked }),
      partners,
    );

    expect(frozen.commissionSplit).toBe(booked);
  });

  it('drops the stamp when a load is moved back out of Agency Paid', () => {
    const frozen = freezeCommissionSplit(
      shipment({ status: 'Customer Paid', commissionSplit: [{ partnerId: 'shabbir', sharePercent: 100 }] }),
      partners,
    );

    expect(frozen.commissionSplit).toBeNull();
  });

  it('keeps an earned load on the shares it was paid under when they later change', () => {
    // Booked under the 25/25/25/20/5 split, on $1,000 of team commission.
    const earned = freezeCommissionSplit(shipment({ status: 'Agency Paid', netMargin: 1000 }), partners);

    // The team later moves to an even five-way split.
    const revised = partners.map((partner) => ({ ...partner, sharePercent: 20 }));
    const split = splitShipment(earned as Shipment, revised);

    expect(split.partnerEarnings.shabbir).toBe(250);
    expect(split.partnerEarnings.muzammil).toBe(200);
    expect(split.partnerEarnings.allah).toBe(50);

    // An unstamped load — one not yet earned when the shares changed — follows
    // the new percentages instead.
    const unstamped = splitShipment(shipment({ status: 'Agency Paid', netMargin: 1000 }), revised);
    expect(unstamped.partnerEarnings.allah).toBe(200);
  });

  it('does not re-spread an earned balance when a share is edited', () => {
    const data = {
      shipments: [freezeCommissionSplit(shipment({ status: 'Agency Paid', netMargin: 1000 }), partners) as Shipment],
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
      shipments: [shipment({ id: 'a', status: 'Billed' })],
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
