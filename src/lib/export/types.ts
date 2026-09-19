/** A report rendered to a neutral shape that both the Excel and PDF writers understand. */

export type CellValue = string | number | null;

export interface ReportColumn {
  header: string;
  /** Right-align and format as currency in both outputs. */
  numeric?: boolean;
  currency?: boolean;
  width?: number;
}

export interface ReportSheet {
  name: string;
  columns: ReportColumn[];
  rows: CellValue[][];
  /** Rendered as a bold summary row under the table. */
  totals?: CellValue[];
}

export interface ReportDocument {
  title: string;
  subtitle?: string;
  /** Key figures printed above the tables. */
  summary?: { label: string; value: string }[];
  sheets: ReportSheet[];
  /** Dedicated printable employee slips; one PDF page is created per entry. */
  payslips?: PaySlip[];
}

export interface PaySlip {
  employeeName: string;
  employeeEmail?: string;
  employeePhone?: string;
  employeeAddress?: string;
  employeeNotes?: string;
  agencyName?: string;
  agencyBasisPercent?: number | null;
  month: string;
  compensationLabel: string;
  status: 'unpaid' | 'paid';
  internalGenerated: number;
  commissionBasis: number;
  commissionPercent: number;
  salary: number;
  commission: number;
  totalDue: number;
  loadCount: number;
}
