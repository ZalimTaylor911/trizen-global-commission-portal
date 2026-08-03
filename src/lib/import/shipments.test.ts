import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';
import { parseShipmentFile, TEMPLATE_COLUMNS } from './shipments';
import type { Agency, Customer } from '@/domain/types';

const glt: Agency = {
  id: 'glt',
  name: 'GLT Logistics',
  agentPercent: 50,
  agencyPercent: 50,
  active: true,
};

const meridian: Agency = {
  id: 'meridian',
  name: 'Meridian Freight',
  agentPercent: 60,
  agencyPercent: 40,
  active: true,
};

const acme: Customer = {
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
  agencyIds: ['glt'],
  active: true,
};

const CONTEXT = {
  agencies: [glt, meridian],
  customers: [acme],
  existingLoadNumbers: new Set<string>(),
};

type Row = Partial<Record<(typeof TEMPLATE_COLUMNS)[number], string>>;

/** Sensible defaults so each test only states the fields it cares about. */
const DEFAULTS: Row = {
  Date: '2026-07-15',
  'Load Number': 'L-1',
  Customer: 'Acme Foods',
  'Company Name': 'Acme Foods',
  'Shipment Type': 'FTL',
  AR: '3000',
  AP: '2300',
  'Gross Margin': '700',
  Agency: 'GLT Logistics',
  Status: 'Agency Paid',
};

/** Builds a template-shaped CSV, so a column reorder can't silently break these. */
function csvFile(...rows: Row[]): File {
  const grid = [
    [...TEMPLATE_COLUMNS],
    ...rows.map((row) =>
      TEMPLATE_COLUMNS.map((column) => {
        const merged = { ...DEFAULTS, ...row };
        return merged[column] ?? '';
      }),
    ),
  ];
  return new File([toCsv(grid)], 'loads.csv', { type: 'text/csv' });
}

describe('parseCsv', () => {
  it('keeps commas that live inside quoted fields', () => {
    const rows = parseCsv('a,"Chicago, IL → Dallas, TX",c');
    expect(rows[0]).toEqual(['a', 'Chicago, IL → Dallas, TX', 'c']);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('"say ""hello""",x')[0]).toEqual(['say "hello"', 'x']);
  });

  it('handles CRLF line endings and a trailing newline', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('strips the BOM Excel writes', () => {
    expect(parseCsv('﻿Date,Load Number')[0]?.[0]).toBe('Date');
  });

  it('round-trips through toCsv', () => {
    const rows = [
      ['Lane', 'Notes'],
      ['Chicago, IL → Dallas, TX', 'He said "go"'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('parseShipmentFile', () => {
  it('derives net margin from gross and the agency split, never from the file', async () => {
    const result = await parseShipmentFile(csvFile({}), CONTEXT);

    expect(result.errorCount).toBe(0);
    // The owner's example: 700 gross at 50/50 is 350 to us.
    expect(result.rows[0]?.draft?.grossMargin).toBe(700);
    expect(result.rows[0]?.draft?.netMargin).toBe(350);
  });

  it('applies each row its own agency split', async () => {
    const result = await parseShipmentFile(
      csvFile({}, { 'Load Number': 'L-2', Agency: 'Meridian Freight', Customer: '' }),
      CONTEXT,
    );

    expect(result.rows[0]?.draft?.netMargin).toBe(350);
    expect(result.rows[1]?.draft?.netMargin).toBe(420);
  });

  it('links the row to its CRM customer', async () => {
    const result = await parseShipmentFile(csvFile({}), CONTEXT);

    expect(result.rows[0]?.draft?.customerId).toBe('acme');
    // POC falls back to the customer's contact when the column is blank.
    expect(result.rows[0]?.draft?.poc).toBe('Dana Whitfield');
  });

  it('rejects a customer that does not exist rather than inventing one', async () => {
    const result = await parseShipmentFile(csvFile({ Customer: 'Ghost Shipping' }), CONTEXT);

    expect(result.validCount).toBe(0);
    expect(result.rows[0]?.errors[0]?.column).toBe('Customer');
  });

  it('warns when a load is not linked to a customer', async () => {
    const result = await parseShipmentFile(csvFile({ Customer: '' }), CONTEXT);

    expect(result.validCount).toBe(1);
    expect(result.rows[0]?.draft?.customerId).toBe('');
    expect(result.rows[0]?.warnings.some((w) => w.column === 'Customer')).toBe(true);
  });

  it('warns when the agency is not one the customer is assigned to', async () => {
    const result = await parseShipmentFile(csvFile({ Agency: 'Meridian Freight' }), CONTEXT);

    expect(result.validCount).toBe(1);
    expect(result.rows[0]?.warnings.some((w) => w.column === 'Agency')).toBe(true);
  });

  it('carries the invoice date through, billing under the load number', async () => {
    const result = await parseShipmentFile(
      csvFile({ 'Load Number': 'L-777', Status: 'Completed', 'Invoice Date': '7/20/2026' }),
      CONTEXT,
    );

    expect(result.rows[0]?.draft?.invoicedDate).toBe('2026-07-20');
    // The load number is the invoice number — there is no separate field.
    expect(result.rows[0]?.draft?.loadNumber).toBe('L-777');
  });

  it('calculates the estimated delivery when the column is left blank', async () => {
    const result = await parseShipmentFile(
      csvFile(
        // LTL picked up Friday with 3 business days transit → the next Wednesday.
        {
          'Shipment Type': 'LTL',
          'Transit Days': '3',
          'Actual Pickup Date': '2026-07-17',
          'Estimated Delivery Date': '',
        },
        // Same booking as FTL rolls straight through the weekend.
        {
          'Load Number': 'L-2',
          'Shipment Type': 'FTL',
          'Transit Days': '3',
          'Actual Pickup Date': '2026-07-17',
          'Estimated Delivery Date': '',
          Customer: '',
        },
      ),
      CONTEXT,
    );

    expect(result.rows[0]?.draft?.estimatedDeliveryDate).toBe('2026-07-22');
    expect(result.rows[1]?.draft?.estimatedDeliveryDate).toBe('2026-07-20');
  });

  it('keeps an estimated delivery date that was supplied', async () => {
    const result = await parseShipmentFile(
      csvFile({
        'Transit Days': '3',
        'Actual Pickup Date': '2026-07-17',
        'Estimated Delivery Date': '2026-07-24',
      }),
      CONTEXT,
    );

    expect(result.rows[0]?.draft?.estimatedDeliveryDate).toBe('2026-07-24');
  });

  it('rejects an unreadable transit date rather than dropping it', async () => {
    const result = await parseShipmentFile(
      csvFile({ 'Actual Pickup Date': 'whenever' }),
      CONTEXT,
    );

    expect(result.rows[0]?.errors.some((e) => e.column === 'Actual Pickup Date')).toBe(true);
  });

  it('warns when delivery precedes pickup', async () => {
    const result = await parseShipmentFile(
      csvFile({ 'Actual Pickup Date': '2026-07-20', 'Actual Delivery Date': '2026-07-18' }),
      CONTEXT,
    );

    expect(result.rows[0]?.warnings.some((w) => w.column === 'Actual Delivery Date')).toBe(true);
  });

  it('accepts Completed as a status', async () => {
    const result = await parseShipmentFile(csvFile({ Status: 'Completed' }), CONTEXT);
    expect(result.rows[0]?.draft?.status).toBe('Completed');
  });

  it('accepts Billed, and Invoiced as the same status', async () => {
    const result = await parseShipmentFile(
      csvFile(
        { Status: 'Billed', 'Invoice Date': '2026-07-20' },
        { Status: 'invoiced', 'Load Number': 'L-2', 'Invoice Date': '7/21/2026' },
      ),
      CONTEXT,
    );

    expect(result.rows.map((row) => row.draft?.status)).toEqual(['Billed', 'Billed']);
    expect(result.rows.map((row) => row.draft?.invoicedDate)).toEqual([
      '2026-07-20',
      '2026-07-21',
    ]);
    expect(result.errorCount).toBe(0);
  });

  it('rejects a billed row with no invoice date', async () => {
    const result = await parseShipmentFile(csvFile({ Status: 'Billed' }), CONTEXT);

    expect(result.rows[0]?.draft).toBeNull();
    expect(result.rows[0]?.errors.some((e) => e.column === 'Invoice Date')).toBe(true);
  });

  it('still lets a completed row through without an invoice date', async () => {
    const result = await parseShipmentFile(csvFile({ Status: 'Completed' }), CONTEXT);

    expect(result.rows[0]?.draft?.invoicedDate).toBe('');
    expect(result.rows[0]?.errors).toEqual([]);
  });

  it('accepts the date formats freight paperwork actually uses', async () => {
    const result = await parseShipmentFile(
      csvFile(
        { Date: '2026-07-15' },
        { Date: '7/16/2026', 'Load Number': 'L-2' },
        { Date: '17 Jul 2026', 'Load Number': 'L-3' },
      ),
      CONTEXT,
    );

    expect(result.rows.map((row) => row.draft?.date)).toEqual([
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
    ]);
    expect(result.rows[0]?.draft?.month).toBe('2026-07');
  });

  it('strips currency formatting from amounts', async () => {
    const result = await parseShipmentFile(
      csvFile({ AR: '$3,000.00', AP: '$2,300.00', 'Gross Margin': '$700.00' }),
      CONTEXT,
    );

    expect(result.rows[0]?.draft?.ar).toBe(3000);
    expect(result.rows[0]?.draft?.grossMargin).toBe(700);
  });

  it('falls back to AR − AP when gross margin is blank', async () => {
    const result = await parseShipmentFile(csvFile({ 'Gross Margin': '' }), CONTEXT);

    expect(result.rows[0]?.draft?.grossMargin).toBe(700);
    expect(result.rows[0]?.warnings.some((w) => w.column === 'Gross Margin')).toBe(true);
  });

  it('rejects a row rather than guessing an unknown agency', async () => {
    const result = await parseShipmentFile(csvFile({ Agency: 'Nonexistent Brokerage' }), CONTEXT);

    expect(result.validCount).toBe(0);
    expect(result.rows[0]?.draft).toBeNull();
    expect(result.rows[0]?.errors.some((e) => e.column === 'Agency')).toBe(true);
  });

  it('rejects an unrecognised status instead of silently defaulting', async () => {
    const result = await parseShipmentFile(csvFile({ Status: 'Paid Out' }), CONTEXT);
    expect(result.rows[0]?.errors.some((e) => e.column === 'Status')).toBe(true);
  });

  it('requires a date and a company name', async () => {
    const result = await parseShipmentFile(
      csvFile({ Date: '', Customer: '', 'Company Name': '' }),
      CONTEXT,
    );

    const columns = result.rows[0]?.errors.map((issue) => issue.column);
    expect(columns).toContain('Date');
    expect(columns).toContain('Company Name');
  });

  it('flags a load number repeated within the file', async () => {
    const result = await parseShipmentFile(csvFile({}, {}), CONTEXT);

    expect(result.rows[1]?.errors.some((e) => e.column === 'Load Number')).toBe(true);
    expect(result.validCount).toBe(1);
  });

  it('warns — but still imports — when a load number already exists', async () => {
    const result = await parseShipmentFile(csvFile({}), {
      ...CONTEXT,
      existingLoadNumbers: new Set(['l-1']),
    });

    expect(result.validCount).toBe(1);
    expect(result.rows[0]?.warnings.some((w) => w.column === 'Load Number')).toBe(true);
  });

  it('defaults a blank type to FTL and a blank status to Assigned, with warnings', async () => {
    const result = await parseShipmentFile(
      csvFile({ 'Shipment Type': '', Status: '' }),
      CONTEXT,
    );

    expect(result.rows[0]?.draft?.shipmentType).toBe('FTL');
    expect(result.rows[0]?.draft?.status).toBe('Assigned');
    expect(result.rows[0]?.warnings.some((w) => w.column === 'Shipment Type')).toBe(true);
    expect(result.rows[0]?.warnings.some((w) => w.column === 'Status')).toBe(true);
  });

  it('refuses a file whose headings do not match the template', async () => {
    const file = new File(['Name,Amount\nAcme,100'], 'wrong.csv', { type: 'text/csv' });
    const result = await parseShipmentFile(file, CONTEXT);

    expect(result.fatalError).toContain('column headings');
    expect(result.validCount).toBe(0);
  });

  it('reports an empty file rather than importing nothing silently', async () => {
    const result = await parseShipmentFile(new File([''], 'empty.csv'), CONTEXT);
    expect(result.fatalError).toBe('That file is empty.');
  });

  it('keeps good rows when others are broken', async () => {
    const result = await parseShipmentFile(
      csvFile(
        {},
        { Date: 'not-a-date', 'Load Number': 'L-2' },
        {
          'Load Number': 'L-3',
          Customer: '',
          'Company Name': 'Northwind',
          Agency: 'Meridian Freight',
          AR: '2000',
          AP: '1500',
          'Gross Margin': '500',
          Status: 'Delivered',
        },
      ),
      CONTEXT,
    );

    expect(result.validCount).toBe(2);
    expect(result.errorCount).toBe(1);
    expect(result.rows[2]?.draft?.netMargin).toBe(300);
  });
});
