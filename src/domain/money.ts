/**
 * Money helpers.
 *
 * Every split in this app has to add back up to the original amount — a $100
 * expense shared three ways must not quietly become $99.99. So all division
 * happens in integer cents and any leftover cent is handed out by the largest
 * remainder method rather than dropped.
 */

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function round2(amount: number): number {
  return fromCents(toCents(amount));
}

/**
 * Split `total` across `weights`, preserving the exact total.
 * Weights need not be normalised. Zero or negative total weight yields all zeros.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];

  const totalWeight = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (totalWeight <= 0) return weights.map(() => 0);

  const totalCents = toCents(total);
  const exact = weights.map((w) => (totalCents * Math.max(0, w)) / totalWeight);
  const floored = exact.map((c) => Math.floor(c));

  let remainder = totalCents - floored.reduce((sum, c) => sum + c, 0);

  // Hand the leftover cents to the entries with the largest fractional part.
  const order = exact
    .map((c, index) => ({ index, frac: c - Math.floor(c) }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floored];
  let cursor = 0;
  while (remainder > 0 && order.length > 0) {
    const entry = order[cursor % order.length]!;
    result[entry.index] = result[entry.index]! + 1;
    remainder -= 1;
    cursor += 1;
  }
  // Negative totals floor the other way; claw the excess back symmetrically.
  cursor = 0;
  while (remainder < 0 && order.length > 0) {
    const entry = order[cursor % order.length]!;
    result[entry.index] = result[entry.index]! - 1;
    remainder += 1;
    cursor += 1;
  }

  return result.map(fromCents);
}

/** Split `total` into `count` equal parts that still sum to `total`. */
export function allocateEqually(total: number, count: number): number[] {
  return allocate(total, new Array(count).fill(1));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(percent: number): string {
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}
