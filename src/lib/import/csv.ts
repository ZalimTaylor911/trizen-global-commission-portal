/**
 * A small RFC-4180 CSV reader.
 *
 * Written by hand rather than pulled from a dependency because the one thing
 * that actually matters here is quoted fields — freight lanes contain commas
 * ("Chicago, IL → Dallas, TX"), and a naive `split(',')` would shred them.
 */
export function parseCsv(input: string): string[][] {
  // Excel writes a BOM when you "Save As CSV UTF-8".
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index]!;

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r') {
      index += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field.length > 0 || row.length > 0) endRow();

  // Drop trailing blank lines the editor may have left behind.
  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

/** Quote a value only when it needs it, so the template stays readable. */
export function toCsvField(value: string | number): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(toCsvField).join(',')).join('\r\n');
}
