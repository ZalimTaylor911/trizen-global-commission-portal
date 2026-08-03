/**
 * Handing a generated file to the user.
 *
 * In Electron this goes through the main process so the user gets a real Save
 * dialog and picks where the file lands. Outside Electron (`npm run dev` in a
 * browser) it falls back to a normal download.
 */
export async function saveOutput(
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
  filters: { name: string; extensions: string[] }[],
): Promise<{ saved: boolean; filePath?: string }> {
  if (window.trizen) {
    return window.trizen.saveFile({ defaultName: filename, data: bytes, filters });
  }

  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return { saved: true };
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PDF_MIME = 'application/pdf';

/** 'Shipments 2026-07' → 'Shipments-2026-07-20260731.xlsx' */
export function timestampedName(base: string, extension: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const safe = base.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return `${safe}-${stamp}.${extension}`;
}
