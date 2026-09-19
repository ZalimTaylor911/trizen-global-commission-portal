/**
 * Bulk shipment import.
 *
 * Reads a filled-in CSV or Excel template, checks every row, and reports what
 * it found before anything is written. Net margin is never read from the file —
 * it is always derived from Gross Margin and the agency's split, so a
 * mistyped figure in a spreadsheet can't quietly corrupt a partner's balance.
 */

import ExcelJS from 'exceljs';
import { parseCsv, toCsv } from './csv';
import { computeNetMargin } from '@/domain/engine';
import { estimateDelivery } from '@/domain/transit';
import {
  BILLED_STATUS,
  SHIPMENT_STATUSES,
  SHIPMENT_TYPES,
  type Agency,
  type Customer,
  type Shipment,
  type ShipmentStatus,
  type ShipmentType,
} from '@/domain/types';
import { round2 } from '@/domain/money';
import { XLSX_MIME, saveOutput } from '../export/save';

export type ShipmentDraft = Omit<Shipment, 'id' | 'createdAt' | 'updatedAt'>;

/** Column order of the template. Header text is matched case-insensitively. */
export const TEMPLATE_COLUMNS = [
  'Date',
  'Load Number',
  'Customer',
  'Company Name',
  'POC',
  'Lane',
  'Carrier Name',
  'Shipment Type',
  'AR',
  'AP',
  'Gross Margin',
  'Agency',
  'Status',
  'Invoice Date',
  'Transit Days',
  'Actual Pickup Date',
  'Estimated Delivery Date',
  'Actual Delivery Date',
  'Notes',
] as const;

/**
 * Columns the importer can manage without — everything else must be present.
 * There is no invoice-number column: the load number is the invoice number.
 */
const OPTIONAL_COLUMNS = new Set([
  'POC',
  'Customer',
  'Invoice Date',
  'Transit Days',
  'Actual Pickup Date',
  'Estimated Delivery Date',
  'Actual Delivery Date',
  'Notes',
]);

const SAMPLE_ROWS = [
  [
    '2026-07-15',
    'L-4101',
    'Acme Foods',
    'Acme Foods',
    'Dana Whitfield',
    'Chicago, IL → Dallas, TX',
    'Blue Line Trucking',
    'FTL',
    '3000',
    '2300',
    '700',
    'GLT Logistics',
    'Customer Paid',
    '2026-07-16',
    '2',
    '2026-07-15',
    '2026-07-17',
    '2026-07-17',
    '',
  ],
  [
    '2026-07-18',
    'L-4102',
    'Northwind Produce',
    'Northwind Produce',
    'Luis Ramos',
    'Atlanta, GA → Miami, FL',
    'Sierra Transport',
    'LTL',
    '1850',
    '1400',
    '450',
    'GLT Logistics',
    'Billed',
    '2026-07-19',
    '3',
    '2026-07-18',
    '',
    '',
    'Reefer, 34F',
  ],
  [
    '2026-07-22',
    'L-4103',
    'Cedar Mill Supply',
    'Cedar Mill Supply',
    'Priya Nair',
    'Denver, CO → Phoenix, AZ',
    'Redrock Carriers',
    'FTL',
    '2400',
    '1900',
    '500',
    'GLT Logistics',
    'Completed',
    // Not billed yet, so there is no invoice date to record.
    '',
    '2',
    '2026-07-22',
    '2026-07-24',
    '2026-07-24',
    '',
  ],
];

export interface ImportIssue {
  column: string;
  message: string;
}

export interface ImportRow {
  /** Row number as it appears in the spreadsheet, header included. */
  lineNumber: number;
  draft: ShipmentDraft | null;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** Kept for the preview table so the user sees what they typed. */
  raw: Record<string, string>;
}

export interface ImportResult {
  rows: ImportRow[];
  validCount: number;
  errorCount: number;
  warningCount: number;
  /** Set when the file itself is unusable — wrong headers, empty, unreadable. */
  fatalError: string | null;
}

// ---------------------------------------------------------------------------
// Template generation
// ---------------------------------------------------------------------------

export async function downloadCsvTemplate(): Promise<{ saved: boolean; filePath?: string }> {
  const csv = toCsv([[...TEMPLATE_COLUMNS], ...SAMPLE_ROWS]);
  // Prefixed with a BOM so Excel opens the → arrow in lane names correctly.
  const bytes = new TextEncoder().encode(`﻿${csv}`);
  return saveOutput('trizen-shipment-template.csv', bytes, 'text/csv', [
    { name: 'CSV file', extensions: ['csv'] },
  ]);
}

/**
 * Excel version of the template, with dropdowns for the fields that must match
 * a known value and a reference sheet listing what those values are.
 */
export async function downloadExcelTemplate(
  agencies: Agency[],
  customers: Customer[],
): Promise<{ saved: boolean; filePath?: string }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Trizen Commission Portal';

  const sheet = workbook.addWorksheet('Shipments');
  const reference = workbook.addWorksheet('Reference');

  const headerRow = sheet.addRow([...TEMPLATE_COLUMNS]);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF101A2E' } };
  });
  headerRow.height = 20;

  for (const row of SAMPLE_ROWS) sheet.addRow(row);

  TEMPLATE_COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = Math.max(14, column.length + 6);
  });

  // Money columns (AR, AP, Gross Margin) formatted so the person filling this
  // in sees real amounts. Indices follow TEMPLATE_COLUMNS, 1-based.
  for (const columnIndex of [9, 10, 11]) {
    sheet.getColumn(columnIndex).numFmt = '#,##0.00';
  }
  // Date columns: Date, Invoice Date, Actual Pickup, Estimated Delivery, Actual Delivery.
  for (const columnIndex of [1, 14, 16, 17, 18]) {
    sheet.getColumn(columnIndex).numFmt = 'yyyy-mm-dd';
  }

  const activeAgencies = agencies.filter((agency) => agency.active);
  const activeCustomers = customers.filter((customer) => customer.active);

  reference.addRow(['Valid values — do not edit this sheet']).font = { bold: true, size: 12 };
  reference.addRow([]);
  reference.addRow(['Agency', 'Team %', 'Agency %']).font = { bold: true };
  for (const agency of activeAgencies) {
    reference.addRow([agency.name, agency.agentPercent, agency.agencyPercent]);
  }
  reference.addRow([]);
  reference.addRow(['Customer', 'Payment terms']).font = { bold: true };
  for (const customer of activeCustomers) {
    reference.addRow([
      customer.companyName,
      customer.paymentTermsDays === 0 ? 'Due on receipt' : `Net ${customer.paymentTermsDays}`,
    ]);
  }
  reference.addRow([]);
  reference.addRow(['Status']).font = { bold: true };
  for (const status of SHIPMENT_STATUSES) reference.addRow([status]);
  reference.addRow([]);
  reference.addRow(['Shipment Type']).font = { bold: true };
  for (const type of SHIPMENT_TYPES) reference.addRow([type]);
  reference.addRow([]);
  reference.addRow(['Notes']).font = { bold: true };
  reference.addRow(['Leave Net Margin out — the portal works it out from Gross Margin']);
  reference.addRow(['and the agency split, so it can never disagree with the books.']);
  reference.addRow(['The Load Number is the invoice number — there is no separate field.']);
  reference.addRow(['Completed = delivered with the POD in the TMS, ready to invoice.']);
  reference.addRow(['Billed = accounting has invoiced the customer. "Invoiced" is accepted']);
  reference.addRow(['as the same status, and Invoice Date is required on those rows.']);
  reference.addRow(['Estimated Delivery Date is optional: leave it blank and the portal']);
  reference.addRow(['calculates it from pickup + transit days (LTL skips weekends, FTL']);
  reference.addRow(['counts them).']);
  reference.getColumn(1).width = 62;
  reference.getColumn(2).width = 10;
  reference.getColumn(3).width = 10;

  // Dropdowns down the first 500 data rows. Column letters track the order of
  // TEMPLATE_COLUMNS: C Customer, H Shipment Type, L Agency, M Status.
  const listFormula = (values: readonly string[]) => `"${values.join(',')}"`;
  const agencyRange = `Reference!$A$4:$A$${3 + activeAgencies.length}`;
  const customerFirstRow = 6 + activeAgencies.length;
  const customerRange = `Reference!$A$${customerFirstRow}:$A$${customerFirstRow + activeCustomers.length - 1}`;

  for (let rowNumber = 2; rowNumber <= 501; rowNumber += 1) {
    sheet.getCell(`H${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [listFormula(SHIPMENT_TYPES)],
    };
    sheet.getCell(`M${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [listFormula(SHIPMENT_STATUSES)],
    };
    if (activeAgencies.length > 0) {
      sheet.getCell(`L${rowNumber}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [agencyRange],
      };
    }
    if (activeCustomers.length > 0) {
      sheet.getCell(`C${rowNumber}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [customerRange],
      };
    }
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return saveOutput('trizen-shipment-template.xlsx', new Uint8Array(buffer), XLSX_MIME, [
    { name: 'Excel Workbook', extensions: ['xlsx'] },
  ]);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Accepts what people actually type: `$1,234.50`, `(200)`, `1 234`, blanks. */
function parseNumber(value: string): number | null {
  const cleaned = value.trim().replace(/[$,\s]/g, '');
  if (cleaned === '') return null;

  const negated = /^\((.*)\)$/.exec(cleaned);
  const parsed = Number(negated ? `-${negated[1]}` : cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Returns 'YYYY-MM-DD', or null if the value isn't a date we recognise. */
function parseDate(value: string): string | null {
  const text = value.trim();
  if (text === '') return null;

  const pad = (n: number) => String(n).padStart(2, '0');

  // 2026-07-15
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;

  // 7/15/2026 or 07-15-2026 — US order, which is what freight paperwork uses.
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${us[3]}-${pad(month)}-${pad(day)}`;
    }
  }

  // 15 Jul 2026 / 15-Jul-2026
  const named = /^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{4})$/.exec(text);
  if (named) {
    const monthIndex = MONTH_ABBR.indexOf(named[2]!.slice(0, 3).toLowerCase());
    if (monthIndex >= 0) return `${named[3]}-${pad(monthIndex + 1)}-${pad(Number(named[1]))}`;
  }

  return null;
}

/**
 * Wording the importer treats as an existing status. "Invoiced" and "Billed"
 * describe the same step, so a sheet typed either way loads without editing.
 */
const STATUS_ALIASES: Record<string, ShipmentStatus> = {
  invoiced: BILLED_STATUS,
};

function matchStatus(value: string): ShipmentStatus | null {
  const text = value.trim().toLowerCase();
  return (
    SHIPMENT_STATUSES.find((status) => status.toLowerCase() === text) ??
    STATUS_ALIASES[text] ??
    null
  );
}

function matchType(value: string): ShipmentType | null {
  const text = value.trim().toUpperCase();
  return SHIPMENT_TYPES.find((type) => type === text) ?? null;
}

/** Reads the raw grid out of a CSV or XLSX file. */
async function readGrid(file: File): Promise<string[][]> {
  const isExcel = /\.xlsx?$/i.test(file.name);

  if (!isExcel) {
    return parseCsv(await file.text());
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  const sheet =
    workbook.worksheets.find((worksheet) => /shipment/i.test(worksheet.name)) ??
    workbook.worksheets[0];
  if (!sheet) return [];

  const grid: string[][] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    // `row.values` is 1-based with a leading hole, hence the slice.
    const values = (row.values as unknown[]).slice(1);
    for (const value of values) {
      if (value === null || value === undefined) {
        cells.push('');
      } else if (value instanceof Date) {
        const pad = (n: number) => String(n).padStart(2, '0');
        cells.push(`${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`);
      } else if (typeof value === 'object' && 'result' in (value as object)) {
        // Formula cell — take the computed value.
        cells.push(String((value as { result: unknown }).result ?? ''));
      } else if (typeof value === 'object' && 'text' in (value as object)) {
        // Rich text / hyperlink cell.
        cells.push(String((value as { text: unknown }).text ?? ''));
      } else {
        cells.push(String(value));
      }
    }
    grid.push(cells);
  });

  return grid.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

export async function parseShipmentFile(
  file: File,
  context: { agencies: Agency[]; customers: Customer[]; existingLoadNumbers: Set<string> },
): Promise<ImportResult> {
  const empty: ImportResult = {
    rows: [],
    validCount: 0,
    errorCount: 0,
    warningCount: 0,
    fatalError: null,
  };

  let grid: string[][];
  try {
    grid = await readGrid(file);
  } catch (error) {
    return { ...empty, fatalError: `Could not read the file: ${(error as Error).message}` };
  }

  if (grid.length === 0) return { ...empty, fatalError: 'That file is empty.' };

  const header = (grid[0] ?? []).map(normaliseHeader);
  const columnIndex = new Map<string, number>();
  for (const column of TEMPLATE_COLUMNS) {
    columnIndex.set(column, header.indexOf(normaliseHeader(column)));
  }

  const missing = TEMPLATE_COLUMNS.filter(
    (column) => (columnIndex.get(column) ?? -1) < 0 && !OPTIONAL_COLUMNS.has(column),
  );
  if (header.every((cell) => !TEMPLATE_COLUMNS.some((column) => normaliseHeader(column) === cell))) {
    return {
      ...empty,
      fatalError:
        'None of the expected column headings were found. Download the template and paste your data under its headings.',
    };
  }
  if (missing.length > 0) {
    return {
      ...empty,
      fatalError: `These columns are missing from the file: ${missing.join(', ')}.`,
    };
  }

  const agencyByName = new Map(
    context.agencies.map((agency) => [agency.name.trim().toLowerCase(), agency]),
  );
  const customerByName = new Map(
    context.customers.map((customer) => [customer.companyName.trim().toLowerCase(), customer]),
  );
  const seenLoadNumbers = new Set<string>();

  const rows: ImportRow[] = [];

  for (let index = 1; index < grid.length; index += 1) {
    const cells = grid[index]!;
    const value = (column: (typeof TEMPLATE_COLUMNS)[number]) => {
      const at = columnIndex.get(column) ?? -1;
      return at >= 0 ? (cells[at] ?? '').toString().trim() : '';
    };

    const raw: Record<string, string> = {};
    for (const column of TEMPLATE_COLUMNS) raw[column] = value(column);

    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];

    const date = parseDate(value('Date'));
    if (!date) {
      errors.push({
        column: 'Date',
        message: value('Date')
          ? `"${value('Date')}" isn't a date the importer recognises. Use YYYY-MM-DD.`
          : 'Date is required.',
      });
    }

    // The Customer column links to a CRM record; Company Name is the label kept
    // on the load. Either can stand in for the other.
    const customerText = value('Customer');
    const customer = customerByName.get(customerText.toLowerCase());
    if (customerText && !customer) {
      errors.push({
        column: 'Customer',
        message: `No customer called "${customerText}". Create them under CRM first, or correct the spelling.`,
      });
    }

    const companyName = value('Company Name') || customer?.companyName || customerText;
    if (!companyName) {
      errors.push({ column: 'Company Name', message: 'A customer or company name is required.' });
    }
    if (!customerText) {
      warnings.push({
        column: 'Customer',
        message: 'Not linked to a CRM customer — invoice terms fall back to Net 30.',
      });
    }

    const agencyText = value('Agency');
    const agency = agencyByName.get(agencyText.toLowerCase());
    if (!agencyText) {
      errors.push({ column: 'Agency', message: 'Agency is required — it sets the commission split.' });
    } else if (!agency) {
      errors.push({
        column: 'Agency',
        message: `No agency called "${agencyText}". Add it under Agencies first, or correct the spelling.`,
      });
    } else if (!agency.active) {
      warnings.push({ column: 'Agency', message: `${agency.name} is marked inactive.` });
    }

    // A customer restricted to certain brokerages shouldn't quietly acquire a
    // load booked under a different one.
    if (agency && customer && customer.agencyIds.length > 0 && !customer.agencyIds.includes(agency.id)) {
      warnings.push({
        column: 'Agency',
        message: `${agency.name} isn't one of ${customer.companyName}'s assigned agencies.`,
      });
    }

    const statusText = value('Status');
    let status: ShipmentStatus = 'Assigned';
    let agencyPaid = false;
    if (statusText) {
      // Older exports used Agency Paid as a shipment status. Preserve the
      // financial history while importing it into the new separate payment
      // field, with Customer Paid as the GLT operational state.
      if (statusText.trim().toLowerCase() === 'agency paid') {
        status = 'Customer Paid';
        agencyPaid = true;
        warnings.push({ column: 'Status', message: 'Legacy Agency Paid was imported as Customer Paid with agency payment recorded.' });
      } else {
        const matched = matchStatus(statusText);
        if (matched) status = matched;
        else {
          errors.push({
            column: 'Status',
            message: `"${statusText}" isn't a valid status. See the Reference sheet.`,
          });
        }
      }
    } else {
      warnings.push({ column: 'Status', message: 'Blank — imported as Assigned.' });
    }

    const typeText = value('Shipment Type');
    let shipmentType: ShipmentType = 'FTL';
    if (typeText) {
      const matched = matchType(typeText);
      if (matched) shipmentType = matched;
      else {
        errors.push({
          column: 'Shipment Type',
          message: `"${typeText}" isn't valid. Use LTL or FTL.`,
        });
      }
    } else {
      warnings.push({ column: 'Shipment Type', message: 'Blank — imported as FTL.' });
    }

    const ar = parseNumber(value('AR')) ?? 0;
    const ap = parseNumber(value('AP')) ?? 0;
    const grossInput = parseNumber(value('Gross Margin'));

    let grossMargin: number;
    if (grossInput === null) {
      grossMargin = round2(ar - ap);
      if (ar === 0 && ap === 0) {
        errors.push({
          column: 'Gross Margin',
          message: 'Gross margin is required when AR and AP are both blank.',
        });
      } else {
        warnings.push({
          column: 'Gross Margin',
          message: `Blank — calculated as AR − AP (${grossMargin.toFixed(2)}).`,
        });
      }
      grossMargin = round2(grossMargin);
    } else {
      grossMargin = round2(grossInput);
      const implied = round2(ar - ap);
      if (ar !== 0 && ap !== 0 && Math.abs(implied - grossMargin) > 0.01) {
        warnings.push({
          column: 'Gross Margin',
          message: `Doesn't match AR − AP (${implied.toFixed(2)}). Imported as typed.`,
        });
      }
      if (grossMargin < 0) {
        warnings.push({ column: 'Gross Margin', message: 'Negative margin — this load loses money.' });
      }
    }

    const loadNumber = value('Load Number');
    if (loadNumber) {
      const key = loadNumber.toLowerCase();
      if (seenLoadNumbers.has(key)) {
        errors.push({ column: 'Load Number', message: `"${loadNumber}" appears twice in this file.` });
      } else if (context.existingLoadNumbers.has(key)) {
        warnings.push({
          column: 'Load Number',
          message: `"${loadNumber}" already exists in the portal — importing will create a duplicate.`,
        });
      }
      seenLoadNumbers.add(key);
    }

    /** Optional date column: blank is fine, but a value we can't read is an error. */
    const optionalDate = (column: (typeof TEMPLATE_COLUMNS)[number]) => {
      const raw = value(column);
      if (!raw) return '';
      const parsed = parseDate(raw);
      if (!parsed) {
        errors.push({
          column,
          message: `"${raw}" isn't a date the importer recognises.`,
        });
        return '';
      }
      return parsed;
    };

    const invoicedDate = optionalDate('Invoice Date');

    // 'Billed' asserts the customer has actually been invoiced, so the date it
    // happened isn't optional — the due date is counted from it. Stay quiet when
    // the cell held something unreadable; optionalDate has already said so.
    if (status === BILLED_STATUS && !invoicedDate && !value('Invoice Date')) {
      errors.push({
        column: 'Invoice Date',
        message: 'Invoice Date is required when the status is Billed.',
      });
    }

    const actualPickupDate = optionalDate('Actual Pickup Date');
    const actualDeliveryDate = optionalDate('Actual Delivery Date');
    const providedEta = optionalDate('Estimated Delivery Date');

    const transitDays = Math.max(0, Math.round(parseNumber(value('Transit Days')) ?? 0));

    // The template says the ETA is optional because we can work it out: LTL
    // counts business days, FTL calendar days.
    const estimatedDeliveryDate =
      providedEta || estimateDelivery(actualPickupDate, transitDays, shipmentType);

    if (actualPickupDate && actualDeliveryDate && actualDeliveryDate < actualPickupDate) {
      warnings.push({
        column: 'Actual Delivery Date',
        message: 'Delivery is before pickup — check the dates.',
      });
    }

    const draft: ShipmentDraft | null =
      errors.length > 0 || !date || !agency
        ? null
        : {
            month: date.slice(0, 7),
            date,
            customerId: customer?.id ?? '',
            companyName,
            poc: value('POC') || customer?.poc || '',
            lane: value('Lane'),
            ar: round2(ar),
            carrierName: value('Carrier Name'),
            ap: round2(ap),
            grossMargin,
            // Always derived — never taken from the file.
            netMargin: computeNetMargin(grossMargin, agency),
            loadNumber,
            status,
            shipmentType,
            agencyId: agency.id,
            agencyPaid,
            agencyPaidAt: null,
            customerPaidAt: null,
            invoicedDate,
            transitDays,
            actualPickupDate,
            estimatedDeliveryDate,
            actualDeliveryDate,
            notes: value('Notes'),
          };

    rows.push({ lineNumber: index + 1, draft, errors, warnings, raw });
  }

  return {
    rows,
    validCount: rows.filter((row) => row.draft !== null).length,
    errorCount: rows.filter((row) => row.errors.length > 0).length,
    warningCount: rows.filter((row) => row.warnings.length > 0).length,
    fatalError: rows.length === 0 ? 'The file has headings but no data rows.' : null,
  };
}
