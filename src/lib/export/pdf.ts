import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDF_MIME, saveOutput, timestampedName } from './save';
import logoUrl from '@/assets/brand/primary_full_color_logo.png';
import type { ReportDocument } from './types';

/** Landscape by default — these tables are wide. */
export async function exportToPdf(report: ReportDocument): Promise<{ saved: boolean; filePath?: string }> {
  if (report.payslips && report.payslips.length > 0) return exportPaySlips(report);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const logo = await asDataUrl(logoUrl);
  drawReportHeader(doc, report, logo, pageWidth, pageHeight);
  let cursorY = 104;

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
      cursorY = 104;
    }

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 49, 94);
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
      headStyles: { fillColor: [16, 49, 94], fontSize: 8, textColor: [255, 255, 255], fontStyle: 'bold' },
      footStyles: { fillColor: [229, 249, 239], textColor: [16, 49, 94], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: [22, 32, 46] },
      alternateRowStyles: { fillColor: [246, 250, 254] },
      columnStyles: numericColumns,
      margin: { left: 40, right: 40, top: 100, bottom: 42 },
      didDrawPage: () => drawReportHeader(doc, report, logo, pageWidth, pageHeight),
    });
  });

  const bytes = new Uint8Array(doc.output('arraybuffer'));
  return saveOutput(timestampedName(report.title, 'pdf'), bytes, PDF_MIME, [
    { name: 'PDF Document', extensions: ['pdf'] },
  ]);
}

function drawReportHeader(doc: jsPDF, report: ReportDocument, logo: string | null, pageWidth: number, pageHeight: number) {
  const navy: [number, number, number] = [16, 49, 94];
  const green: [number, number, number] = [0, 150, 101];
  if (logo) doc.addImage(logo, 'PNG', 40, 24, 128, 34);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...navy);
  doc.text(report.title, 188, 39);
  if (report.subtitle) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(102, 116, 138); doc.text(report.subtitle, 188, 54); }
  doc.setFontSize(8); doc.setTextColor(102, 116, 138); doc.text('Generated', pageWidth - 40, 30, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy); doc.text(new Date().toLocaleDateString('en-GB'), pageWidth - 40, 43, { align: 'right' });
  doc.setDrawColor(...navy); doc.setLineWidth(1); doc.line(40, 76, pageWidth - 40, 76);
  doc.setDrawColor(...green); doc.setLineWidth(2); doc.line(pageWidth - 125, 76, pageWidth - 40, 76);
  doc.setDrawColor(216, 228, 242); doc.setLineWidth(.6); doc.line(40, pageHeight - 30, pageWidth - 40, pageHeight - 30);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(116, 133, 157);
  doc.text('Trizen Global  |  Commission Portal', 40, pageHeight - 16);
  doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - 40, pageHeight - 16, { align: 'right' });
}

async function exportPaySlips(report: ReportDocument): Promise<{ saved: boolean; filePath?: string }> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const logo = await asDataUrl(logoUrl);
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();

  report.payslips!.forEach((slip, index) => {
    if (index > 0) doc.addPage();
    const navy: [number, number, number] = [16, 49, 94];
    const green: [number, number, number] = [0, 150, 101];
    const paleBlue: [number, number, number] = [242, 248, 255];
    const paleGreen: [number, number, number] = [229, 249, 239];
    const left = 34;
    const right = width - 34;
    if (logo) doc.addImage(logo, 'PNG', left, 27, 160, 42);
    doc.setFontSize(25); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy);
    doc.text(slip.compensationLabel === 'Commission' ? 'Commission Slip' : 'Employee Pay Slip', right, 45, { align: 'right' });
    doc.setFontSize(12); doc.setFont('helvetica', 'normal');
    doc.text(`Pay period: ${slip.month}`, right, 62, { align: 'right' });
    doc.setFontSize(8.5); doc.setTextColor(102, 116, 138);
    doc.text(`Generated on: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`, right, 77, { align: 'right' });
    // A paid slip gets a prominent watermark instead of a small status pill.
    // Keep it light enough that the header and employee details remain readable.
    if (slip.status === 'paid') {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(32);
      doc.setTextColor(190, 229, 210);
      doc.text('PAID', right - 52, 105, { align: 'center', angle: -12 });
      doc.setFontSize(8.5);
      doc.setTextColor(102, 116, 138);
    }
    doc.setDrawColor(...navy); doc.setLineWidth(1.1); doc.line(left, 93, right, 93);
    doc.setDrawColor(...green); doc.setLineWidth(2); doc.line(right - 96, 93, right, 93);

    // Employee card - mirrors the reference's pale panel and two-column detail grid.
    doc.setFillColor(...paleBlue); doc.roundedRect(left, 118, right - left, 126, 10, 10, 'F');
    doc.setFillColor(...navy); doc.circle(left + 22, 141, 15, 'F'); doc.setFontSize(16); doc.setTextColor(255, 255, 255); doc.text('•', left + 22, 146, { align: 'center' });
    doc.setFontSize(15); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy); doc.text('Employee Details', left + 48, 147);
    doc.setFillColor(255, 255, 255); doc.roundedRect(left + 10, 158, right - left - 20, 76, 7, 7, 'F');
    const detail = (label: string, value: string, x: number, y: number) => { doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy); doc.text(label, x, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 35, 58); doc.text(value || '—', x + 64, y); };
    detail('Employee', slip.employeeName, left + 24, 181); detail('Contact', slip.employeePhone || '—', left + 270, 181);
    detail('Email', slip.employeeEmail || '—', left + 24, 211); detail('Address', slip.employeeAddress || '—', left + 270, 211);

    doc.setDrawColor(216, 228, 242); doc.roundedRect(left, 268, right - left, 330, 10, 10, 'S');
    doc.setFillColor(...green); doc.circle(left + 22, 292, 15, 'F'); doc.setFontSize(14); doc.setTextColor(255, 255, 255); doc.text('$', left + 22, 297, { align: 'center' });
    doc.setFontSize(15); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy); doc.text('Earnings Summary', left + 48, 298);
    doc.setFillColor(...paleGreen); doc.roundedRect(right - 155, 278, 135, 24, 12, 12, 'F'); doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...green); doc.text(`Compensation Type: ${slip.compensationLabel}`, right - 87, 293, { align: 'center' });
    doc.setFontSize(8.5); doc.setTextColor(102, 116, 138);
    const basis = slip.agencyBasisPercent == null ? '—' : `${slip.agencyBasisPercent}/${100 - slip.agencyBasisPercent}`;
    doc.text(`Working agency: ${slip.agencyName || '—'}  ·  Employee basis: ${basis}`, left + 48, 312);
    const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    autoTable(doc, {
      startY: 322,
      head: [['DESCRIPTION', 'DETAILS', 'AMOUNT']],
      body: [
        ['Total Shipments', String(slip.loadCount), '—'],
        ['Total Net Business', '—', money(slip.commissionBasis)],
        ...(slip.compensationLabel === 'Salary' ? [] : [['Commission rate', `${slip.commissionPercent}%`, '—']]),
        ...(slip.compensationLabel === 'Commission' ? [] : [['Monthly salary', '—', money(slip.salary)]]),
        [slip.compensationLabel === 'Salary' ? 'Salary earned' : 'Commission earned', '—', money(slip.compensationLabel === 'Salary' ? slip.salary : slip.commission)],
      ],
      theme: 'striped', styles: { fontSize: 9.5, cellPadding: 6 }, tableWidth: right - left - 20, margin: { left: left + 10, right: left + 10 },
      headStyles: { fillColor: [229, 237, 246], textColor: navy, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 251, 254] }, bodyStyles: { textColor: [22, 32, 46] },
      columnStyles: { 0: { cellWidth: 190 }, 1: { halign: 'center', cellWidth: 140 }, 2: { halign: 'right' } },
      didParseCell: (data) => { if (data.row.index === data.table.body.length - 1) { data.cell.styles.fillColor = paleGreen; data.cell.styles.fontStyle = 'bold'; data.cell.styles.textColor = navy; } },
    });
    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    doc.setFillColor(...navy); doc.roundedRect(left + 10, finalY + 14, right - left - 20, 40, 5, 5, 'F'); doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255); doc.text('Total Payable', left + 36, finalY + 39); doc.text(money(slip.totalDue), right - 24, finalY + 39, { align: 'right' });
    if (slip.employeeNotes) {
      doc.setFontSize(8.5); doc.setTextColor(102, 116, 138);
      doc.text('Additional information', left + 10, finalY + 76);
      doc.setTextColor(22, 32, 46);
      doc.text(doc.splitTextToSize(slip.employeeNotes, width - 80), left + 10, finalY + 89);
    }
    doc.setDrawColor(...navy); doc.setLineWidth(.6); doc.line(left, height - 50, right, height - 50);
    doc.setFontSize(9); doc.setTextColor(78, 96, 123); doc.text('Thank you for your hard work and commitment!', width / 2, height - 29, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy); doc.text('Trizen Global', width / 2, height - 17, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(116, 133, 157); doc.text('PEOPLE  |  FREIGHT  |  OPPORTUNITY', right, height - 24, { align: 'right' });
  });
  return saveOutput(timestampedName(report.title, 'pdf'), new Uint8Array(doc.output('arraybuffer')), PDF_MIME, [{ name: 'PDF Document', extensions: ['pdf'] }]);
}

async function asDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
