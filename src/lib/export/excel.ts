import ExcelJS from 'exceljs';
import { XLSX_MIME, saveOutput, timestampedName } from './save';
import type { ReportDocument } from './types';

const HEADER_FILL = 'FF101A2E';
const BORDER = 'FFE3E6EA';

/** Writes one worksheet per sheet, with a title block and a bold totals row. */
export async function exportToExcel(report: ReportDocument): Promise<{ saved: boolean; filePath?: string }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Trizen Commission Portal';
  workbook.created = new Date();
  const logoBase64 = await loadLogo();
  const logo = logoBase64 ? workbook.addImage({ base64: logoBase64, extension: 'png' }) : null;

  for (const sheet of report.sheets) {
    // Excel rejects : \ / ? * [ ] in sheet names and caps them at 31 characters.
    const worksheet = workbook.addWorksheet(sheet.name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31));

    const titleRow = worksheet.addRow([report.title]);
    titleRow.font = { bold: true, size: 16, color: { argb: HEADER_FILL } };
    titleRow.alignment = { vertical: 'middle' };
    titleRow.height = 28;
    worksheet.mergeCells(1, 1, 1, Math.max(1, sheet.columns.length));
    if (logo) worksheet.addImage(logo, { tl: { col: Math.max(0, sheet.columns.length - 2), row: 0.15 }, ext: { width: 120, height: 32 } });

    if (report.subtitle) {
      const subtitleRow = worksheet.addRow([report.subtitle]);
      subtitleRow.font = { size: 10, color: { argb: 'FF66748A' } };
      worksheet.mergeCells(subtitleRow.number, 1, subtitleRow.number, Math.max(1, sheet.columns.length));
    }

    worksheet.addRow([]);

    const headerRow = worksheet.addRow(sheet.columns.map((column) => column.header));
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: 'middle' };
    });
    headerRow.height = 20;
    worksheet.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: sheet.columns.length } };

    for (const row of sheet.rows) {
      const added = worksheet.addRow(row);
      added.eachCell((cell, index) => {
        const column = sheet.columns[index - 1];
        if (column?.currency) cell.numFmt = '$#,##0.00';
        if (column?.numeric) cell.alignment = { horizontal: 'right' };
        cell.border = {
          bottom: { style: 'thin', color: { argb: BORDER } },
        };
      });
    }

    if (sheet.totals) {
      const totalRow = worksheet.addRow(sheet.totals);
      totalRow.eachCell((cell, index) => {
        const column = sheet.columns[index - 1];
        cell.font = { bold: true };
        if (column?.currency) cell.numFmt = '$#,##0.00';
        if (column?.numeric) cell.alignment = { horizontal: 'right' };
        cell.border = { top: { style: 'medium', color: { argb: 'FFCDD3DA' } } };
      });
    }

    sheet.columns.forEach((column, index) => {
      const widest = Math.max(
        column.header.length,
        ...sheet.rows.map((row) => String(row[index] ?? '').length),
      );
      worksheet.getColumn(index + 1).width = column.width ?? Math.min(38, Math.max(11, widest + 3));
    });

    worksheet.views = [{ state: 'frozen', ySplit: report.subtitle ? 4 : 3 }];
    worksheet.headerFooter.oddFooter = '&LTrizen Global | Commission Portal&CGenerated &D&RPage &P of &N';
    worksheet.headerFooter.oddHeader = '&R&"Arial,Bold"' + report.title;
  }

  if (report.summary && report.summary.length > 0) {
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.addRow([report.title]).font = { bold: true, size: 14 };
    if (report.subtitle) summarySheet.addRow([report.subtitle]);
    summarySheet.addRow([]);
    for (const item of report.summary) {
      const row = summarySheet.addRow([item.label, item.value]);
      row.getCell(1).font = { bold: true };
    }
    summarySheet.getColumn(1).width = 30;
    summarySheet.getColumn(2).width = 22;
    summarySheet.headerFooter.oddFooter = '&LTrizen Global | Commission Portal&CGenerated &D&RPage &P of &N';
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return saveOutput(timestampedName(report.title, 'xlsx'), new Uint8Array(buffer), XLSX_MIME, [
    { name: 'Excel Workbook', extensions: ['xlsx'] },
  ]);
}

async function loadLogo(): Promise<string | null> {
  try {
    const response = await fetch(new URL('@/assets/brand/primary_full_color_logo.png', import.meta.url));
    const blob = await response.blob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
    });
    return base64;
  } catch { return null; }
}
