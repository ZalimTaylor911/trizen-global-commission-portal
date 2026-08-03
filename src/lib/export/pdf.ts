import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDF_MIME, saveOutput, timestampedName } from './save';
import type { ReportDocument } from './types';

/** Landscape by default — these tables are wide. */
export async function exportToPdf(report: ReportDocument): Promise<{ saved: boolean; filePath?: string }> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(16);
  doc.setTextColor(22, 32, 46);
  doc.text(report.title, 40, 44);

  if (report.subtitle) {
    doc.setFontSize(9.5);
    doc.setTextColor(102, 116, 138);
    doc.text(report.subtitle, 40, 60);
  }

  doc.setFontSize(8.5);
  doc.setTextColor(147, 160, 177);
  doc.text('Trizen Global — Commission Portal', pageWidth - 40, 44, { align: 'right' });
  doc.text(new Date().toLocaleString('en-GB'), pageWidth - 40, 57, { align: 'right' });

  let cursorY = report.subtitle ? 82 : 68;

  if (report.summary && report.summary.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      body: report.summary.map((item) => [item.label, item.value]),
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 150, textColor: [102, 116, 138] },
        1: { halign: 'left' },
      },
      tableWidth: 340,
      margin: { left: 40 },
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22;
  }

  report.sheets.forEach((sheet, index) => {
    if (index > 0) {
      doc.addPage();
      cursorY = 44;
    }

    doc.setFontSize(11);
    doc.setTextColor(22, 32, 46);
    doc.text(sheet.name, 40, cursorY);

    const numericColumns: Record<number, { halign: 'right' }> = {};
    sheet.columns.forEach((column, columnIndex) => {
      if (column.numeric || column.currency) numericColumns[columnIndex] = { halign: 'right' };
    });

    autoTable(doc, {
      startY: cursorY + 10,
      head: [sheet.columns.map((column) => column.header)],
      body: sheet.rows.map((row) => row.map((cell) => (cell === null ? '' : String(cell)))),
      foot: sheet.totals
        ? [sheet.totals.map((cell) => (cell === null ? '' : String(cell)))]
        : undefined,
      theme: 'striped',
      headStyles: { fillColor: [16, 26, 46], fontSize: 8, textColor: [255, 255, 255] },
      footStyles: { fillColor: [244, 246, 248], textColor: [22, 32, 46], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [250, 251, 252] },
      columnStyles: numericColumns,
      margin: { left: 40, right: 40 },
      didDrawPage: () => {
        const page = doc.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(147, 160, 177);
        doc.text(
          `Page ${page}`,
          pageWidth - 40,
          doc.internal.pageSize.getHeight() - 18,
          { align: 'right' },
        );
      },
    });
  });

  const bytes = new Uint8Array(doc.output('arraybuffer'));
  return saveOutput(timestampedName(report.title, 'pdf'), bytes, PDF_MIME, [
    { name: 'PDF Document', extensions: ['pdf'] },
  ]);
}
