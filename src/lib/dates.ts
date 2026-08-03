/** Date helpers. All stored dates are plain 'YYYY-MM-DD' strings — no timezones to get wrong. */

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** 'YYYY-MM' → 'July 2026' */
export function monthLabel(month: string): string {
  const [year, index] = month.split('-');
  const name = MONTH_NAMES[Number(index) - 1];
  return name ? `${name} ${year}` : month;
}

/** 'YYYY-MM-DD' → '15 Jul 2026' */
export function formatDate(date: string): string {
  if (!date) return '—';
  const [year, month, day] = date.split('-');
  const name = MONTH_NAMES[Number(month) - 1];
  return name ? `${Number(day)} ${name.slice(0, 3)} ${year}` : date;
}

export function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Distinct months present in a set of records, newest first. */
export function distinctMonths(records: { month: string }[]): string[] {
  return [...new Set(records.map((r) => r.month))].filter(Boolean).sort((a, b) => b.localeCompare(a));
}

export function distinctYears(records: { month: string }[]): string[] {
  return [...new Set(records.map((r) => r.month.slice(0, 4)))]
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
}
