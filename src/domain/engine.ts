/**
 * Commission and balance engine.
 *
 * Pure functions only — no Firebase, no React. Everything the dashboard and the
 * reports show is derived here from the raw collections, so there is exactly one
 * place where the money rules live and it can be unit tested against SPEC.md.
 */

import { allocate, allocateEqually, round2 } from './money';
import {
  DEAD_STATUSES,
  LEGACY_AGENCY_PAID_STATUS,
  SHIPMENT_STATUSES,
  SHIPMENT_TYPES,
  type Agency,
  type CommissionShare,
  type CommissionTier,
  type Expense,
  type Employee,
  type Partner,
  type Shipment,
  type ShipmentStatus,
  type ShipmentType,
  type Withdrawal,
} from './types';

export interface DataSet {
  shipments: Shipment[];
  agencies: Agency[];
  partners: Partner[];
  employees?: Employee[];
  employeeSettlements?: import('./types').EmployeeSettlementRecord[];
  expenses: Expense[];
  withdrawals: Withdrawal[];
}

function isEmployeeShipment(shipment: Shipment): boolean {
  return shipment.ownerType === 'employee' && Boolean(shipment.employeeId);
}

export interface EmployeeSettlement {
  employeeId: string;
  employeeName: string;
  month: string;
  shipments: Shipment[];
  totalGenerated: number;
  /** Business at the employee-facing agency split; this selects their tier. */
  commissionBasisGenerated: number;
  applicableTier: CommissionTier | null;
  commissionPercent: number;
  commissionCalculated: number;
  baseSalary: number;
  maxCommissionPercent: number;
  /** True when no configured tier covered the month's final business total. */
  usesMaximumRateFallback: boolean;
  finalPayout: number;
  amountRemainingForPartners: number;
  /** Each load's portion of the final payout, used for partner allocation. */
  payoutByShipmentId: Record<string, number>;
}

/**
 * Monthly employee settlement. Only agency-paid loads are real money. Terms
 * The approved employee profile supplies the current tier and employee-facing
 * agency basis until a settlement is paid. This is deliberate: loads are often
 * booked before an admin finishes configuring a newly registered employee, and
 * the provisional 0% registration shell must never erase a real tier. Once a
 * settlement is paid, its saved `EmployeeSettlementRecord` is the immutable
 * accounting source of truth.
 */
export function computeEmployeeSettlements(data: DataSet): EmployeeSettlement[] {
  const employees = new Map((data.employees ?? []).map((employee) => [employee.id, employee]));
  const groups = new Map<string, Shipment[]>();
  for (const shipment of data.shipments) {
    if (!isEarned(shipment) || !isEmployeeShipment(shipment)) continue;
    // Settlement month is the month cash arrived from the agency, not the
    // month the load moved. Legacy loads fall back to their recorded month.
    const earnedMonth = shipment.agencyPaidAt?.slice(0, 7) || shipment.agencyPaidDate?.slice(0, 7) || shipment.month;
    const key = `${earnedMonth}:${shipment.employeeId}`;
    groups.set(key, [...(groups.get(key) ?? []), shipment]);
  }

  return [...groups.entries()].map(([key, shipments]) => {
    const [month, employeeId] = key.split(':');
    const employee = employees.get(employeeId!);
    const totalGenerated = round2(shipments.reduce((sum, shipment) => sum + shipment.netMargin, 0));
    const employeeBasisPercent = employee?.agencyBasisPercent;
    const commissionBasisGenerated = round2(shipments.reduce(
      (sum, shipment) => {
        const basisPercent = employeeBasisPercent ?? shipment.employeeCommissionBasisPercent;
        return sum + (basisPercent == null
          ? shipment.netMargin // legacy loads retain the original real-net behaviour
          : shipment.grossMargin * (basisPercent / 100));
      },
      0,
    ));
    const compensationType = employee?.compensationType ?? 'commission';
    const capturedTiers = shipments.find((shipment) => shipment.employeeCommissionTiers?.length)?.employeeCommissionTiers;
    // Prefer a configured live profile. The records created during employee
    // registration contain a 0% placeholder tier/cap, and old loads may have
    // captured that placeholder before the admin configured the real terms.
    // Salary-only rows retain the captured calculated value for reporting;
    // it is never included in their final payroll payout.
    const tiers = compensationType === 'salary'
      ? capturedTiers ?? employee?.commissionTiers ?? []
      : employee?.commissionTiers?.length
        ? employee.commissionTiers
        : capturedTiers ?? [];
    const capturedMaximumRate = shipments.find((shipment) => shipment.employeeMaxCommissionPercent != null)?.employeeMaxCommissionPercent;
    const configuredMaximumRate = compensationType === 'salary'
      ? capturedMaximumRate ?? employee?.maxCommissionPercent ?? null
      : employee?.maxCommissionPercent ?? capturedMaximumRate ?? null;
    // The maximum rate is the fallback for a business total that falls outside
    // every configured tier. A matching tier always wins; this is not a cap.
    const maxCommissionPercent = Math.max(0, configuredMaximumRate ?? 0);
    const applicableTier = [...tiers]
      .sort((a, b) => b.minBusiness - a.minBusiness)
      .find((tier) => commissionBasisGenerated >= tier.minBusiness && (tier.maxBusiness == null || commissionBasisGenerated <= tier.maxBusiness))
      ?? null;
    const configuredPercent = applicableTier?.commissionPercent ?? maxCommissionPercent;
    const commissionPercent = configuredPercent;
    // One final-monthly rate applies to every dollar of that month's business.
    const commissionCalculated = round2(commissionBasisGenerated * (commissionPercent / 100));
    const baseSalary = compensationType === 'salary' || compensationType === 'salary-plus-commission'
      ? round2(employee?.monthlySalary ?? 0)
      : 0;
    const finalPayout = round2(baseSalary + (compensationType === 'salary' ? 0 : commissionCalculated));
    const payoutParts = allocate(finalPayout, shipments.map((shipment) => shipment.netMargin));
    const payoutByShipmentId: Record<string, number> = {};
    shipments.forEach((shipment, index) => { payoutByShipmentId[shipment.id] = payoutParts[index] ?? 0; });
    return {
      employeeId: employeeId!,
      employeeName: employee?.name ?? 'Former employee',
      month: month!,
      shipments,
      totalGenerated,
      commissionBasisGenerated,
      applicableTier,
      commissionPercent,
      commissionCalculated,
      baseSalary,
      maxCommissionPercent,
      usesMaximumRateFallback: applicableTier === null,
      finalPayout,
      amountRemainingForPartners: round2(totalGenerated - finalPayout),
      payoutByShipmentId,
    };
  }).sort((a, b) => b.month.localeCompare(a.month) || a.employeeName.localeCompare(b.employeeName));
}

export interface ShipmentSplit {
  shipmentId: string;
  agencyId: string;
  grossMargin: number;
  /** Our share — identical to `teamCommission` once the shipment is earned. */
  netMargin: number;
  agencyEarnings: number;
  teamCommission: number;
  /** partnerId → that partner's cut of the team commission. */
  partnerEarnings: Record<string, number>;
}

/** SPEC.md §4 — nothing counts until the agency has actually paid. */
export function isAgencyPaid(shipment: Pick<Shipment, 'status' | 'agencyPaid'>): boolean {
  return shipment.agencyPaid === true || (shipment.status as string) === LEGACY_AGENCY_PAID_STATUS;
}

export function isEarned(shipment: Pick<Shipment, 'status' | 'agencyPaid'>): boolean {
  return isAgencyPaid(shipment);
}

/** Partners eligible to receive commission, in a stable order. */
export function commissionPartners(partners: Partner[]): Partner[] {
  return partners.filter((p) => p.active);
}

/** Partners who carry operational expenses (SPEC.md §6 Type 1). */
export function operationalPartners(partners: Partner[]): Partner[] {
  return partners.filter((p) => p.active && p.bearsOperationalExpenses);
}

/**
 * Our share of a load's gross margin, once the agency has taken its cut.
 *
 * This is what gets stored as the shipment's net margin — it is derived, never
 * typed in, so the two figures can't drift apart. SPEC.md §5.
 *
 *     gross 700 @ 50/50  →  net 350
 *     gross 700 @ 60/40  →  net 420
 */
export function computeNetMargin(grossMargin: number, agency: Agency | undefined): number {
  if (!agency) return 0;
  const [, teamShare] = allocate(grossMargin, [agency.agencyPercent, agency.agentPercent]) as [
    number,
    number,
  ];
  return teamShare;
}

/**
 * The shares a shipment's commission should be divided by.
 *
 * A load earned under an older set of shares keeps them: `commissionSplit` is
 * stamped onto the shipment when it is marked agency paid (see
 * `freezeCommissionSplit`), so editing a partner's percentage today cannot
 * re-spread money that was already earned and possibly drawn against.
 *
 * Loads with no stamp — everything not yet earned, plus anything created before
 * the field existed — fall back to the partners as they stand now.
 */
export function sharesFor(
  shipment: Pick<Shipment, 'commissionSplit'>,
  partners: Partner[],
): CommissionShare[] {
  const frozen = shipment.commissionSplit;
  if (frozen && frozen.length > 0) return frozen;
  return commissionPartners(partners).map((partner) => ({
    partnerId: partner.id,
    sharePercent: partner.sharePercent,
  }));
}

/**
 * Stamp the current partner shares onto a load that has just been earned.
 *
 * Called on the way into Firestore rather than on the way out, so the figures
 * are fixed at the moment the agency paid. An existing stamp is never
 * overwritten — that is the whole point of it. A load moved back out of
 * agency-paid state loses its stamp, so re-earning it freezes the shares in force
 * at that later moment.
 */
export function freezeCommissionSplit<T extends Pick<Shipment, 'status' | 'agencyPaid' | 'agencyPaidAt' | 'commissionSplit'>>(
  shipment: T,
  partners: Partner[],
): T {
  if (!isEarned(shipment)) {
    return shipment.commissionSplit ? { ...shipment, commissionSplit: null } : shipment;
  }
  if (shipment.commissionSplit && shipment.commissionSplit.length > 0) return shipment;

  return {
    ...shipment,
    commissionSplit: commissionPartners(partners).map((partner) => ({
      partnerId: partner.id,
      sharePercent: partner.sharePercent,
    })),
  };
}

/**
 * Distribute a shipment's commission across the partners.
 *
 * The agency split has already been applied at entry time — `netMargin` is our
 * share and therefore the team commission outright, and whatever is left of the
 * gross belongs to the brokerage. Deriving the agency's cut by subtraction
 * rather than re-applying the percentage means an agency whose split changes
 * later doesn't silently rewrite the history of loads already paid.
 *
 * Partner shares are treated as weights and normalised, which guarantees the
 * distributed amounts add back to the team commission exactly. Use
 * `validatePartnerShares` to warn when the configured shares don't total 100.
 */
export function splitShipment(shipment: Shipment, partners: Partner[]): ShipmentSplit {
  const eligible = commissionPartners(partners);
  const empty: Record<string, number> = {};
  for (const partner of eligible) empty[partner.id] = 0;

  if (!isEarned(shipment)) {
    return {
      shipmentId: shipment.id,
      agencyId: shipment.agencyId,
      grossMargin: shipment.grossMargin,
      netMargin: shipment.netMargin,
      agencyEarnings: 0,
      teamCommission: 0,
      partnerEarnings: empty,
    };
  }

  const teamCommission = round2(shipment.netMargin);
  const agencyEarnings = round2(shipment.grossMargin - shipment.netMargin);

  const booked = sharesFor(shipment, partners);
  const shares = allocate(
    teamCommission,
    booked.map((share) => share.sharePercent),
  );

  // Start from the live partners so a screen reading this always sees a key for
  // everyone on the team, then lay the booked amounts over the top. A partner
  // who has since left still gets their historical cut reported.
  const partnerEarnings: Record<string, number> = { ...empty };
  booked.forEach((share, index) => {
    partnerEarnings[share.partnerId] = shares[index] ?? 0;
  });

  return {
    shipmentId: shipment.id,
    agencyId: shipment.agencyId,
    grossMargin: shipment.grossMargin,
    netMargin: shipment.netMargin,
    agencyEarnings,
    teamCommission,
    partnerEarnings,
  };
}

/**
 * Charge an expense to partners.
 * Operational → equal split among expense-bearing partners.
 * Agency deduction → split by commission share among all active partners,
 * including silent partners.
 */
export function splitExpense(expense: Expense, partners: Partner[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const partner of commissionPartners(partners)) result[partner.id] = 0;
  const bearers =
    expense.type === 'operational' ? operationalPartners(partners) : commissionPartners(partners);

  if (bearers.length === 0) return result;

  const amounts = expense.type === 'agency-deduction' || expense.type === 'employee-compensation'
    ? allocate(expense.amount, bearers.map((partner) => partner.sharePercent))
    : allocateEqually(expense.amount, bearers.length);
  bearers.forEach((partner, index) => {
    result[partner.id] = amounts[index] ?? 0;
  });

  return result;
}

export interface PartnerLedger {
  partnerId: string;
  partnerName: string;
  sharePercent: number;
  bearsOperationalExpenses: boolean;
  totalEarned: number;
  operationalExpenses: number;
  agencyDeductions: number;
  withdrawals: number;
  /** earned − operational − deductions − withdrawals */
  balance: number;
  /**
   * Their share of commission on loads not yet marked agency paid —
   * money coming, but not theirs to draw against. SPEC.md §26.
   */
  pendingBalance: number;
}

export function computeLedgers(data: DataSet): PartnerLedger[] {
  const partners = commissionPartners(data.partners);

  const earned: Record<string, number> = {};
  const operational: Record<string, number> = {};
  const deductions: Record<string, number> = {};
  const withdrawn: Record<string, number> = {};
  for (const partner of partners) {
    earned[partner.id] = 0;
    operational[partner.id] = 0;
    deductions[partner.id] = 0;
    withdrawn[partner.id] = 0;
  }

  const pending: Record<string, number> = {};
  for (const partner of partners) pending[partner.id] = 0;

  for (const shipment of data.shipments) {
    if (isEarned(shipment)) {
      const booked = sharesFor(shipment, data.partners);
      const amounts = allocate(shipment.netMargin, booked.map((share) => share.sharePercent));
      booked.forEach((share, index) => {
        if (share.partnerId in earned) {
          earned[share.partnerId] = round2(earned[share.partnerId]! + (amounts[index] ?? 0));
        }
      });
      continue;
    }

    // Loads still in flight: work out what each partner stands to receive.
    if (DEAD_STATUSES.includes(shipment.status)) continue;
    const shares = allocate(
      shipment.netMargin,
      partners.map((partner) => partner.sharePercent),
    );
    partners.forEach((partner, index) => {
      pending[partner.id] = round2((pending[partner.id] ?? 0) + (shares[index] ?? 0));
    });
  }

  for (const expense of data.expenses) {
    const bucket = expense.type === 'operational' ? operational : deductions;
    const split = splitExpense(expense, data.partners);
    for (const [partnerId, amount] of Object.entries(split)) {
      if (partnerId in bucket) bucket[partnerId] = round2(bucket[partnerId]! + amount);
    }
  }

  for (const withdrawal of data.withdrawals) {
    if (withdrawal.partnerId in withdrawn) {
      withdrawn[withdrawal.partnerId] = round2(
        withdrawn[withdrawal.partnerId]! + withdrawal.amount,
      );
    }
  }

  return partners.map((partner) => {
    const totalEarned = earned[partner.id] ?? 0;
    const operationalExpenses = operational[partner.id] ?? 0;
    const agencyDeductions = deductions[partner.id] ?? 0;
    const withdrawals = withdrawn[partner.id] ?? 0;
    return {
      partnerId: partner.id,
      partnerName: partner.name,
      sharePercent: partner.sharePercent,
      bearsOperationalExpenses: partner.bearsOperationalExpenses,
      totalEarned,
      operationalExpenses,
      agencyDeductions,
      withdrawals,
      balance: round2(totalEarned - operationalExpenses - agencyDeductions - withdrawals),
      pendingBalance: pending[partner.id] ?? 0,
    };
  });
}

export interface FinancialSummary {
  /** Every shipment on file, whatever its status. */
  totalLoads: number;
  /** Shipments whose agency payment has been recorded. */
  earnedLoads: number;
  /** Customer billing (AR) on earned loads. */
  totalRevenue: number;
  /** Carrier cost (AP) on earned loads. */
  totalCarrierCost: number;
  totalGrossMargin: number;
  /** Our share after the agency split — the same figure as team commission. */
  totalNetMargin: number;
  totalAgencyCommission: number;
  totalTeamCommission: number;
  totalOperationalExpenses: number;
  totalAgencyDeductions: number;
  totalExpenses: number;
  totalWithdrawals: number;
  /** Sum of every partner's current balance — what the business still owes. */
  totalOutstandingBalance: number;
  /** Gross margin as a percentage of revenue. */
  grossMarginPercent: number;
  /** Average net margin per earned load. */
  averageNetPerLoad: number;
  /** Loads not yet paid by the agency, excluding dead ones. */
  pipelineLoads: number;
  pipelineGrossMargin: number;
  pipelineNetMargin: number;
}

export function computeFinancialSummary(data: DataSet): FinancialSummary {
  const ledgers = computeLedgers(data);

  let earnedLoads = 0;
  let totalRevenue = 0;
  let totalCarrierCost = 0;
  let totalGrossMargin = 0;
  let totalNetMargin = 0;
  let totalAgencyCommission = 0;
  let totalTeamCommission = 0;
  let pipelineLoads = 0;
  let pipelineGrossMargin = 0;
  let pipelineNetMargin = 0;

  for (const shipment of data.shipments) {
    if (isEarned(shipment)) {
      const split = splitShipment(shipment, data.partners);
      earnedLoads += 1;
      totalRevenue = round2(totalRevenue + shipment.ar);
      totalCarrierCost = round2(totalCarrierCost + shipment.ap);
      totalGrossMargin = round2(totalGrossMargin + shipment.grossMargin);
      totalNetMargin = round2(totalNetMargin + shipment.netMargin);
      totalAgencyCommission = round2(totalAgencyCommission + split.agencyEarnings);
      totalTeamCommission = round2(totalTeamCommission + split.teamCommission);
      continue;
    }

    // Dead shipments never become revenue, so they are not pipeline either.
    if (DEAD_STATUSES.includes(shipment.status)) continue;

    // Net margin was already worked out at entry time, so the pipeline value is
    // simply the sum of what we'd take home once these loads are paid.
    pipelineLoads += 1;
    pipelineGrossMargin = round2(pipelineGrossMargin + shipment.grossMargin);
    pipelineNetMargin = round2(pipelineNetMargin + shipment.netMargin);
  }

  const totalOperationalExpenses = round2(
    data.expenses
      .filter((e) => e.type === 'operational')
      .reduce((sum, e) => sum + e.amount, 0),
  );
  const totalAgencyDeductions = round2(
    data.expenses
      .filter((e) => e.type === 'agency-deduction')
      .reduce((sum, e) => sum + e.amount, 0),
  );
  const totalEmployeeCompensation = round2(
    data.expenses
      .filter((e) => e.type === 'employee-compensation')
      .reduce((sum, e) => sum + e.amount, 0),
  );
  const totalWithdrawals = round2(data.withdrawals.reduce((sum, w) => sum + w.amount, 0));

  return {
    totalLoads: data.shipments.length,
    earnedLoads,
    totalRevenue,
    totalCarrierCost,
    totalGrossMargin,
    totalNetMargin,
    totalAgencyCommission,
    totalTeamCommission,
    totalOperationalExpenses,
    totalAgencyDeductions,
    totalExpenses: round2(totalOperationalExpenses + totalAgencyDeductions + totalEmployeeCompensation),
    totalWithdrawals,
    totalOutstandingBalance: round2(ledgers.reduce((sum, l) => sum + l.balance, 0)),
    grossMarginPercent: totalRevenue > 0 ? round2((totalGrossMargin / totalRevenue) * 100) : 0,
    averageNetPerLoad: earnedLoads > 0 ? round2(totalNetMargin / earnedLoads) : 0,
    pipelineLoads,
    pipelineGrossMargin,
    pipelineNetMargin,
  };
}

export interface MonthlySummary {
  /** 'YYYY-MM' */
  month: string;
  loadsMoved: number;
  revenue: number;
  grossMargin: number;
  netMargin: number;
  teamCommission: number;
  expenses: number;
  withdrawals: number;
  /** Running balance through the end of this month. */
  remainingBalance: number;
}

export function computeMonthlySummaries(data: DataSet): MonthlySummary[] {
  const months = new Map<string, Omit<MonthlySummary, 'remainingBalance'>>();

  const bucket = (month: string) => {
    let entry = months.get(month);
    if (!entry) {
      entry = {
        month,
        loadsMoved: 0,
        revenue: 0,
        grossMargin: 0,
        netMargin: 0,
        teamCommission: 0,
        expenses: 0,
        withdrawals: 0,
      };
      months.set(month, entry);
    }
    return entry;
  };

  for (const shipment of data.shipments) {
    if (!isEarned(shipment)) continue;
    const entry = bucket(shipment.month);
    entry.loadsMoved += 1;
    entry.revenue = round2(entry.revenue + shipment.ar);
    entry.grossMargin = round2(entry.grossMargin + shipment.grossMargin);
    entry.netMargin = round2(entry.netMargin + shipment.netMargin);
    entry.teamCommission = round2(entry.teamCommission + shipment.netMargin);
  }

  for (const expense of data.expenses) {
    const entry = bucket(expense.month);
    entry.expenses = round2(entry.expenses + expense.amount);
  }

  for (const withdrawal of data.withdrawals) {
    const entry = bucket(withdrawal.month);
    entry.withdrawals = round2(entry.withdrawals + withdrawal.amount);
  }

  const sorted = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));

  let running = 0;
  const withBalance = sorted.map((entry) => {
    running = round2(running + entry.teamCommission - entry.expenses - entry.withdrawals);
    return { ...entry, remainingBalance: running };
  });

  // Newest month first for display.
  return withBalance.reverse();
}

export interface AgencySummary {
  agencyId: string;
  agencyName: string;
  agentPercent: number;
  agencyPercent: number;
  totalLoads: number;
  grossMargin: number;
  netMargin: number;
  agencyEarnings: number;
  teamEarnings: number;
}

export function computeAgencySummaries(data: DataSet): AgencySummary[] {
  return data.agencies.map((agency) => {
    const shipments = data.shipments.filter(
      (s) => s.agencyId === agency.id && isEarned(s),
    );

    let grossMargin = 0;
    let netMargin = 0;
    let agencyEarnings = 0;
    let teamEarnings = 0;

    for (const shipment of shipments) {
      const split = splitShipment(shipment, data.partners);
      grossMargin = round2(grossMargin + shipment.grossMargin);
      netMargin = round2(netMargin + shipment.netMargin);
      agencyEarnings = round2(agencyEarnings + split.agencyEarnings);
      teamEarnings = round2(teamEarnings + shipment.netMargin);
    }

    return {
      agencyId: agency.id,
      agencyName: agency.name,
      agentPercent: agency.agentPercent,
      agencyPercent: agency.agencyPercent,
      totalLoads: shipments.length,
      grossMargin,
      netMargin,
      agencyEarnings,
      teamEarnings,
    };
  });
}

/** Load counts across the operational workflow. SPEC.md §26. */
export interface OperationsSummary {
  /** Booked but not yet delivered. */
  activeLoads: number;
  assigned: number;
  inTransit: number;
  delivered: number;
  completed: number;
  /** Invoiced to the customer, waiting on their money. */
  billed: number;
  customerPaid: number;
  agencyPaid: number;
  claims: number;
  disputes: number;
  tonu: number;
  dissolved: number;
}

export function computeOperationsSummary(shipments: Shipment[]): OperationsSummary {
  const count = (status: ShipmentStatus) =>
    shipments.filter((shipment) => shipment.status === status).length;

  const assigned = count('Assigned');
  const inTransit = count('In Transit');
  const delivered = count('Delivered');

  return {
    activeLoads: assigned + inTransit + delivered,
    assigned,
    inTransit,
    delivered,
    completed: count('Completed'),
    billed: count('Billed'),
    customerPaid: count('Customer Paid'),
    agencyPaid: shipments.filter(isAgencyPaid).length,
    claims: count('Claim'),
    disputes: count('Issue / Dispute'),
    tonu: count('TONU'),
    dissolved: count('Dissolved'),
  };
}

/** One row of a "top customers / lanes / carriers" table. */
export interface BreakdownRow {
  key: string;
  loads: number;
  revenue: number;
  grossMargin: number;
  netMargin: number;
}

/**
 * Group earned loads by an arbitrary attribute — customer, lane, carrier —
 * sorted by the money they brought in.
 */
export function computeBreakdown(
  shipments: Shipment[],
  keyOf: (shipment: Shipment) => string,
): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>();

  for (const shipment of shipments) {
    if (!isEarned(shipment)) continue;
    const key = keyOf(shipment).trim() || '—';

    let row = rows.get(key);
    if (!row) {
      row = { key, loads: 0, revenue: 0, grossMargin: 0, netMargin: 0 };
      rows.set(key, row);
    }
    row.loads += 1;
    row.revenue = round2(row.revenue + shipment.ar);
    row.grossMargin = round2(row.grossMargin + shipment.grossMargin);
    row.netMargin = round2(row.netMargin + shipment.netMargin);
  }

  return [...rows.values()].sort((a, b) => b.netMargin - a.netMargin);
}

/** Load counts per status, in the workflow's own order. */
export function computeStatusCounts(shipments: Shipment[]): { status: ShipmentStatus; loads: number }[] {
  return SHIPMENT_STATUSES.map((status) => ({
    status,
    loads: shipments.filter((shipment) => shipment.status === status).length,
  })).filter((row) => row.loads > 0);
}

/** LTL vs FTL mix across every load on file, earned or not. */
export function computeTypeCounts(
  shipments: Shipment[],
): { type: ShipmentType; loads: number; netMargin: number }[] {
  return SHIPMENT_TYPES.map((type) => {
    const matching = shipments.filter((shipment) => shipment.shipmentType === type);
    return {
      type,
      loads: matching.length,
      netMargin: round2(
        matching.filter(isEarned).reduce((sum, shipment) => sum + shipment.netMargin, 0),
      ),
    };
  }).filter((row) => row.loads > 0);
}

export interface ValidationIssue {
  level: 'warning' | 'error';
  message: string;
}

/** Surfaced as a banner so misconfigured shares can't silently skew payouts. */
export function validatePartnerShares(partners: Partner[]): ValidationIssue[] {
  const active = commissionPartners(partners);
  if (active.length === 0) {
    return [{ level: 'error', message: 'No active partners — commission cannot be distributed.' }];
  }

  const total = round2(active.reduce((sum, p) => sum + p.sharePercent, 0));
  if (total !== 100) {
    return [
      {
        level: 'warning',
        message: `Partner shares total ${total}%, not 100%. Commission is still distributed in proportion to the shares, but the split is probably not what you intend.`,
      },
    ];
  }
  return [];
}

export function validateAgency(agency: Pick<Agency, 'agentPercent' | 'agencyPercent'>): string | null {
  const total = round2(agency.agentPercent + agency.agencyPercent);
  if (total !== 100) return `Agent and agency percentages must total 100% (currently ${total}%).`;
  if (agency.agentPercent < 0 || agency.agencyPercent < 0) return 'Percentages cannot be negative.';
  return null;
}
