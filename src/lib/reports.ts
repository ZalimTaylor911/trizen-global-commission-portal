/**
 * Turns the live collections into printable report documents.
 *
 * Every builder returns the same neutral `ReportDocument` shape, so the Excel
 * and PDF writers stay ignorant of the business domain and the on-screen preview
 * renders from exactly the same rows that get exported — no chance of the two
 * drifting apart.
 */

import {
  computeAgencySummaries,
  computeFinancialSummary,
  computeEmployeeSettlements,
  computeLedgers,
  computeMonthlySummaries,
  splitExpense,
  splitShipment,
  type DataSet,
} from '@/domain/engine';
import { formatCurrency, formatPercent, round2 } from '@/domain/money';
import { formatDate, monthLabel } from './dates';
import type { PaySlip, ReportDocument } from './export/types';
import type { Expense, ExpenseCategory, ShipmentStatus, ShipmentType } from '@/domain/types';

export type ReportKind =
  | 'shipments'
  | 'partner-earnings'
  | 'monthly'
  | 'agency'
  | 'expenses'
  | 'withdrawals'
  | 'employee-settlement'
  | 'employee-payslip';

export const REPORT_KINDS: { value: ReportKind; label: string; description: string }[] = [
  { value: 'shipments', label: 'Shipment detail', description: 'Every load with its margins and commission.' },
  { value: 'partner-earnings', label: 'Partner earnings', description: 'Earned, deducted, withdrawn and current balance per partner.' },
  { value: 'monthly', label: 'Monthly summary', description: 'Loads, margin, expenses and running balance by month.' },
  { value: 'agency', label: 'Agency summary', description: 'Volume and earnings split by brokerage.' },
  { value: 'expenses', label: 'Expenses', description: 'Operational costs and agency deductions.' },
  { value: 'withdrawals', label: 'Withdrawals', description: 'Payouts recorded against each partner.' },
  { value: 'employee-settlement', label: 'Employee monthly settlement', description: 'Employee commission, caps, and the amount released to partners.' },
  { value: 'employee-payslip', label: 'Employee pay / commission slips', description: 'Branded individual or combined employee salary and commission slips.' },
];

export interface ReportFilters {
  month: string;
  year: string;
  agencyId: string;
  customer: string;
  partnerId: string;
  employeeId: string;
  status: '' | ShipmentStatus;
  shipmentType: '' | ShipmentType;
  carrier: string;
  lane: string;
}

export const EMPTY_FILTERS: ReportFilters = {
  month: '',
  year: '',
  agencyId: '',
  customer: '',
  partnerId: '',
  employeeId: '',
  status: '',
  shipmentType: '',
  carrier: '',
  lane: '',
};

/** Narrows the whole dataset once, so every builder sees a consistent slice. */
export function applyFilters(data: DataSet, filters: ReportFilters): DataSet {
  const customer = filters.customer.trim().toLowerCase();

  const inPeriod = (month: string) => {
    if (filters.month && month !== filters.month) return false;
    if (filters.year && !month.startsWith(filters.year)) return false;
    return true;
  };

  const carrier = filters.carrier.trim().toLowerCase();
  const lane = filters.lane.trim().toLowerCase();

  const shipments = data.shipments.filter((shipment) => {
    if (!inPeriod(shipment.month)) return false;
    if (filters.agencyId && shipment.agencyId !== filters.agencyId) return false;
    if (filters.status && shipment.status !== filters.status) return false;
    if (filters.shipmentType && shipment.shipmentType !== filters.shipmentType) return false;
    if (customer && !shipment.companyName.toLowerCase().includes(customer)) return false;
    if (carrier && !shipment.carrierName.toLowerCase().includes(carrier)) return false;
    if (lane && !shipment.lane.toLowerCase().includes(lane)) return false;
    if (filters.employeeId && shipment.employeeId !== filters.employeeId) return false;
    return true;
  });

  return {
    ...data,
    shipments,
    expenses: data.expenses.filter((expense) => inPeriod(expense.month)),
    withdrawals: data.withdrawals.filter((withdrawal) => {
      if (!inPeriod(withdrawal.month)) return false;
      if (filters.partnerId && withdrawal.partnerId !== filters.partnerId) return false;
      return true;
    }),
  };
}

export function describeFilters(
  filters: ReportFilters,
  lookups: { agencyName: (id: string) => string; partnerName: (id: string) => string; employeeName: (id: string) => string },
): string {
  const parts: string[] = [];
  if (filters.month) parts.push(monthLabel(filters.month));
  else if (filters.year) parts.push(filters.year);
  if (filters.agencyId) parts.push(lookups.agencyName(filters.agencyId));
  if (filters.partnerId) parts.push(lookups.partnerName(filters.partnerId));
  if (filters.employeeId) parts.push(lookups.employeeName(filters.employeeId));
  if (filters.status) parts.push(`status: ${filters.status}`);
  if (filters.shipmentType) parts.push(filters.shipmentType);
  if (filters.customer) parts.push(`customer: ${filters.customer}`);
  if (filters.carrier) parts.push(`carrier: ${filters.carrier}`);
  if (filters.lane) parts.push(`lane: ${filters.lane}`);
  return parts.length > 0 ? parts.join(' · ') : 'All records';
}

export function buildReport(
  kind: ReportKind,
  data: DataSet,
  filters: ReportFilters,
  categories: ExpenseCategory[],
): ReportDocument {
  const agencyById = new Map(data.agencies.map((agency) => [agency.id, agency]));
  const partnerById = new Map(data.partners.map((partner) => [partner.id, partner]));
  const employeeById = new Map((data.employees ?? []).map((employee) => [employee.id, employee]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const subtitle = describeFilters(filters, {
    agencyName: (id) => agencyById.get(id)?.name ?? 'Unknown agency',
    partnerName: (id) => partnerById.get(id)?.name ?? 'Unknown partner',
    employeeName: (id) => employeeById.get(id)?.name ?? 'Unknown employee',
  });

  const summary = computeFinancialSummary(data);
  const keyFigures = [
    { label: 'Loads (paid)', value: `${summary.earnedLoads} of ${summary.totalLoads}` },
    { label: 'Revenue (AR)', value: formatCurrency(summary.totalRevenue) },
    { label: 'Gross margin', value: formatCurrency(summary.totalGrossMargin) },
    { label: 'Agency keeps', value: formatCurrency(summary.totalAgencyCommission) },
    { label: 'Net margin — ours', value: formatCurrency(summary.totalNetMargin) },
    { label: 'Expenses', value: formatCurrency(summary.totalExpenses) },
    { label: 'Withdrawals', value: formatCurrency(summary.totalWithdrawals) },
    { label: 'Outstanding balance', value: formatCurrency(summary.totalOutstandingBalance) },
  ];

  switch (kind) {
    case 'shipments': {
      const rows = data.shipments.map((shipment) => {
        const split = splitShipment(shipment, data.partners);
        return [
          formatDate(shipment.date),
          shipment.loadNumber,
          shipment.companyName,
          shipment.poc,
          shipment.lane,
          shipment.carrierName,
          shipment.shipmentType,
          agencyById.get(shipment.agencyId)?.name ?? '',
          shipment.status,
          round2(shipment.ar),
          round2(shipment.ap),
          round2(shipment.grossMargin),
          round2(split.agencyEarnings),
          round2(shipment.netMargin),
        ];
      });

      const totals = data.shipments.reduce(
        (acc, shipment) => {
          const split = splitShipment(shipment, data.partners);
          return {
            ar: acc.ar + shipment.ar,
            ap: acc.ap + shipment.ap,
            gross: acc.gross + shipment.grossMargin,
            net: acc.net + shipment.netMargin,
            agency: acc.agency + split.agencyEarnings,
            team: acc.team + split.teamCommission,
          };
        },
        { ar: 0, ap: 0, gross: 0, net: 0, agency: 0, team: 0 },
      );

      return {
        title: 'Shipment Report',
        subtitle,
        summary: keyFigures,
        sheets: [
          {
            name: 'Shipments',
            columns: [
              { header: 'Date' },
              { header: 'Load #' },
              { header: 'Company' },
              { header: 'POC' },
              { header: 'Lane' },
              { header: 'Carrier' },
              { header: 'Type' },
              { header: 'Agency' },
              { header: 'Status' },
              { header: 'AR', numeric: true, currency: true },
              { header: 'AP', numeric: true, currency: true },
              { header: 'Gross Margin', numeric: true, currency: true },
              { header: 'Agency Keeps', numeric: true, currency: true },
              { header: 'Net Margin (ours)', numeric: true, currency: true },
            ],
            rows,
            totals: [
              `${data.shipments.length} loads`,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              round2(totals.ar),
              round2(totals.ap),
              round2(totals.gross),
              round2(totals.agency),
              round2(totals.net),
            ],
          },
        ],
      };
    }

    case 'partner-earnings': {
      const ledgers = computeLedgers(data).filter(
        (ledger) => !filters.partnerId || ledger.partnerId === filters.partnerId,
      );

      const totals = ledgers.reduce(
        (acc, ledger) => ({
          earned: acc.earned + ledger.totalEarned,
          opex: acc.opex + ledger.operationalExpenses,
          deductions: acc.deductions + ledger.agencyDeductions,
          withdrawals: acc.withdrawals + ledger.withdrawals,
          balance: acc.balance + ledger.balance,
        }),
        { earned: 0, opex: 0, deductions: 0, withdrawals: 0, balance: 0 },
      );

      return {
        title: 'Partner Earnings Report',
        subtitle,
        summary: keyFigures,
        sheets: [
          {
            name: 'Partner Earnings',
            columns: [
              { header: 'Partner' },
              { header: 'Share', numeric: true },
              { header: 'Total Earned', numeric: true, currency: true },
              { header: 'Expenses Deducted', numeric: true, currency: true },
              { header: 'Agency Deductions', numeric: true, currency: true },
              { header: 'Withdrawals', numeric: true, currency: true },
              { header: 'Current Balance', numeric: true, currency: true },
            ],
            rows: ledgers.map((ledger) => [
              ledger.partnerName,
              formatPercent(ledger.sharePercent),
              round2(ledger.totalEarned),
              round2(ledger.operationalExpenses),
              round2(ledger.agencyDeductions),
              round2(ledger.withdrawals),
              round2(ledger.balance),
            ]),
            totals: [
              'Total',
              null,
              round2(totals.earned),
              round2(totals.opex),
              round2(totals.deductions),
              round2(totals.withdrawals),
              round2(totals.balance),
            ],
          },
        ],
      };
    }

    case 'monthly': {
      const months = computeMonthlySummaries(data);
      return {
        title: 'Monthly Summary Report',
        subtitle,
        summary: keyFigures,
        sheets: [
          {
            name: 'Monthly Summary',
            columns: [
              { header: 'Month' },
              { header: 'Loads Moved', numeric: true },
              { header: 'Revenue', numeric: true, currency: true },
              { header: 'Gross Margin', numeric: true, currency: true },
              { header: 'Net Margin (ours)', numeric: true, currency: true },
              { header: 'Expenses', numeric: true, currency: true },
              { header: 'Withdrawals', numeric: true, currency: true },
              { header: 'Remaining Balance', numeric: true, currency: true },
            ],
            rows: months.map((month) => [
              monthLabel(month.month),
              month.loadsMoved,
              round2(month.revenue),
              round2(month.grossMargin),
              round2(month.netMargin),
              round2(month.expenses),
              round2(month.withdrawals),
              round2(month.remainingBalance),
            ]),
          },
        ],
      };
    }

    case 'agency': {
      const agencies = computeAgencySummaries(data).filter(
        (agency) => !filters.agencyId || agency.agencyId === filters.agencyId,
      );
      return {
        title: 'Agency Summary Report',
        subtitle,
        summary: keyFigures,
        sheets: [
          {
            name: 'Agency Summary',
            columns: [
              { header: 'Agency' },
              { header: 'Team %', numeric: true },
              { header: 'Agency %', numeric: true },
              { header: 'Total Loads', numeric: true },
              { header: 'Gross Margin', numeric: true, currency: true },
              { header: 'Agency Earnings', numeric: true, currency: true },
              { header: 'Team Earnings', numeric: true, currency: true },
            ],
            rows: agencies.map((agency) => [
              agency.agencyName,
              agency.agentPercent,
              agency.agencyPercent,
              agency.totalLoads,
              round2(agency.grossMargin),
              round2(agency.agencyEarnings),
              round2(agency.teamEarnings),
            ]),
          },
        ],
      };
    }

    case 'expenses': {
      const perPartnerShare = (expense: Expense) => {
        const split = splitExpense(expense, data.partners);
        return filters.partnerId ? (split[filters.partnerId] ?? 0) : 0;
      };

      const columns = [
        { header: 'Date' },
        { header: 'Category' },
        { header: 'Type' },
        { header: 'Amount', numeric: true, currency: true },
        { header: 'Notes' },
      ];
      if (filters.partnerId) {
        columns.splice(4, 0, { header: 'Charged to partner', numeric: true, currency: true });
      }

      const rows = data.expenses.map((expense) => {
        const base = [
          formatDate(expense.date),
          categoryById.get(expense.categoryId)?.name ?? 'Uncategorised',
          expense.type === 'operational'
            ? 'Operational'
            : expense.type === 'employee-compensation'
              ? 'Employee settlement'
              : 'Agency deduction',
          round2(expense.amount),
        ];
        if (filters.partnerId) base.push(round2(perPartnerShare(expense)));
        base.push(expense.notes);
        return base;
      });

      const total = round2(data.expenses.reduce((sum, expense) => sum + expense.amount, 0));
      const totals: (string | number | null)[] = [`${data.expenses.length} entries`, null, null, total];
      if (filters.partnerId) {
        totals.push(round2(data.expenses.reduce((sum, expense) => sum + perPartnerShare(expense), 0)));
      }
      totals.push(null);

      return {
        title: 'Expense Report',
        subtitle,
        summary: keyFigures,
        sheets: [{ name: 'Expenses', columns, rows, totals }],
      };
    }

    case 'withdrawals': {
      const total = round2(data.withdrawals.reduce((sum, w) => sum + w.amount, 0));
      return {
        title: 'Withdrawal Report',
        subtitle,
        summary: keyFigures,
        sheets: [
          {
            name: 'Withdrawals',
            columns: [
              { header: 'Date' },
              { header: 'Partner' },
              { header: 'Amount', numeric: true, currency: true },
              { header: 'Notes' },
            ],
            rows: data.withdrawals.map((withdrawal) => [
              formatDate(withdrawal.date),
              partnerById.get(withdrawal.partnerId)?.name ?? 'Unknown',
              round2(withdrawal.amount),
              withdrawal.notes,
            ]),
            totals: [`${data.withdrawals.length} withdrawals`, null, total, null],
          },
        ],
      };
    }

    case 'employee-settlement': {
      const settlements = computeEmployeeSettlements(data);
      const employeeRows = settlements.map((settlement) => [
        monthLabel(settlement.month),
        settlement.employeeName,
        settlement.shipments.length,
        round2(settlement.commissionBasisGenerated),
        settlement.applicableTier
          ? `${formatCurrency(settlement.applicableTier.minBusiness)} – ${settlement.applicableTier.maxBusiness == null ? 'No maximum' : formatCurrency(settlement.applicableTier.maxBusiness)}`
          : 'No matching tier',
        formatPercent(settlement.commissionPercent),
        round2(settlement.commissionCalculated),
        settlement.baseSalary > 0 ? round2(settlement.baseSalary) : null,
        round2(settlement.finalPayout),
      ]);
      const shipmentRows = settlements.flatMap((settlement) => settlement.shipments.map((shipment) => [
        monthLabel(settlement.month), settlement.employeeName, shipment.loadNumber,
        shipment.companyName, formatDate(shipment.date), round2(shipment.grossMargin * ((shipment.employeeCommissionBasisPercent ?? 0) / 100)),
        round2(settlement.payoutByShipmentId[shipment.id] ?? 0),
      ]));
      const totalPayout = round2(settlements.reduce((sum, row) => sum + row.finalPayout, 0));
      return {
        title: 'Employee Monthly Settlement', subtitle,
        summary: [
          { label: 'Employee shipments', value: String(shipmentRows.length) },
          { label: 'Employee payout', value: formatCurrency(totalPayout) },
        ],
        sheets: [
          { name: 'Employee Settlement', columns: [
            { header: 'Month' }, { header: 'Employee' }, { header: 'Shipments', numeric: true },
            { header: 'Total Net Business', numeric: true, currency: true }, { header: 'Applicable tier' }, { header: 'Commission %' },
            { header: 'Commission calculated', numeric: true, currency: true }, { header: 'Salary', numeric: true, currency: true }, { header: 'Final employee payout', numeric: true, currency: true },
          ], rows: employeeRows },
          { name: 'Employee Shipments', columns: [
            { header: 'Month' }, { header: 'Employee' }, { header: 'Load #' }, { header: 'Company' }, { header: 'Date' },
            { header: 'Total Net Business', numeric: true, currency: true }, { header: 'Employee payout', numeric: true, currency: true },
          ], rows: shipmentRows },
        ],
      };
    }

    case 'employee-payslip': {
      const payslips: PaySlip[] = computeEmployeeSettlements(data).map((settlement) => {
        const employee = employeeById.get(settlement.employeeId);
        const recorded = data.employeeSettlements?.find((row) => row.employeeId === settlement.employeeId && row.month === settlement.month);
        const compensationType = employee?.compensationType ?? 'commission';
        return {
          employeeName: settlement.employeeName,
          employeeEmail: employee?.email,
          employeePhone: employee?.contactPhone,
          employeeAddress: employee?.address,
          employeeNotes: employee?.notes,
          agencyName: employee?.agencyName ?? undefined,
          agencyBasisPercent: employee?.agencyBasisPercent ?? null,
          month: settlement.month,
          compensationLabel: compensationType === 'salary'
            ? 'Salary'
            : compensationType === 'salary-plus-commission' ? 'Salary + Commission' : 'Commission',
          status: recorded?.status ?? 'unpaid',
          internalGenerated: settlement.totalGenerated,
          commissionBasis: settlement.commissionBasisGenerated,
          commissionPercent: settlement.commissionPercent,
          salary: settlement.baseSalary,
          commission: settlement.commissionCalculated,
          totalDue: settlement.finalPayout,
          loadCount: settlement.shipments.length,
        };
      });
      const totalDue = round2(payslips.reduce((sum, slip) => sum + slip.totalDue, 0));
      return {
        title: filters.employeeId ? 'Employee Pay Slip' : 'Employee Pay & Commission Slips',
        subtitle,
        summary: [{ label: 'Slips', value: String(payslips.length) }, { label: 'Total payroll', value: formatCurrency(totalDue) }],
        sheets: [{
          name: 'Pay Slip Register',
          columns: [{ header: 'Month' }, { header: 'Employee' }, { header: 'Working agency' }, { header: 'Employee basis' }, { header: 'Type' }, { header: 'Salary', numeric: true, currency: true }, { header: 'Commission', numeric: true, currency: true }, { header: 'Total due', numeric: true, currency: true }],
          rows: payslips.map((slip) => [monthLabel(slip.month), slip.employeeName, slip.agencyName ?? '—', slip.agencyBasisPercent == null ? '—' : `${slip.agencyBasisPercent}/${100 - slip.agencyBasisPercent}`, slip.compensationLabel, round2(slip.salary), round2(slip.commission), round2(slip.totalDue)]),
          totals: ['Total', null, null, null, null, round2(payslips.reduce((sum, slip) => sum + slip.salary, 0)), round2(payslips.reduce((sum, slip) => sum + slip.commission, 0)), totalDue],
        }],
        payslips,
      };
    }
  }
}
