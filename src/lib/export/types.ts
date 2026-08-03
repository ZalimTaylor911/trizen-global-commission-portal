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
}
