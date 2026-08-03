/**
 * Transit time and delivery dates. SPEC.md §21.
 *
 * The two service types count time differently, and getting it wrong misleads
 * the customer:
 *
 *   LTL — line-haul runs on the carrier's weekday network, so transit is
 *         counted in business days and weekends don't tick.
 *   FTL — a dedicated truck keeps rolling, so every calendar day counts.
 *
 * Worked examples from the spec:
 *   LTL picked up Monday, 3 days transit  → delivers Thursday.
 *   FTL picked up Friday,  3 days transit → delivers Monday.
 */

import { addDays, daysBetween } from './receivables';
import type { ShipmentType } from './types';

/** Day of week for a 'YYYY-MM-DD' date. 0 = Sunday, 6 = Saturday. */
export function dayOfWeek(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12)).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const day = dayOfWeek(date);
  return day === 0 || day === 6;
}

/** Adds `days` working days, skipping Saturdays and Sundays. */
export function addBusinessDays(date: string, days: number): string {
  if (days <= 0) return date;

  let result = date;
  let remaining = days;
  while (remaining > 0) {
    result = addDays(result, 1);
    if (!isWeekend(result)) remaining -= 1;
  }
  return result;
}

/**
 * When a load picked up on `pickupDate` should arrive.
 * Returns '' if there's no pickup date to count from.
 */
export function estimateDelivery(
  pickupDate: string,
  transitDays: number,
  shipmentType: ShipmentType,
): string {
  if (!pickupDate || !Number.isFinite(transitDays) || transitDays < 0) return '';
  return shipmentType === 'LTL'
    ? addBusinessDays(pickupDate, transitDays)
    : addDays(pickupDate, transitDays);
}

/** How long the load actually took, counted the same way its type is quoted. */
export function actualTransitDays(
  pickupDate: string,
  deliveryDate: string,
  shipmentType: ShipmentType,
): number | null {
  if (!pickupDate || !deliveryDate) return null;

  const calendarDays = daysBetween(pickupDate, deliveryDate);
  if (calendarDays < 0) return calendarDays;
  if (shipmentType === 'FTL') return calendarDays;

  // Count only the working days crossed, to match how LTL transit is quoted.
  let business = 0;
  let cursor = pickupDate;
  while (cursor !== deliveryDate) {
    cursor = addDays(cursor, 1);
    if (!isWeekend(cursor)) business += 1;
  }
  return business;
}

export type DeliveryPerformance = 'early' | 'on-time' | 'late' | 'in-transit' | 'unknown';

/** Compares the actual delivery against what was promised. */
export function deliveryPerformance(shipment: {
  estimatedDeliveryDate: string;
  actualDeliveryDate: string;
}): { state: DeliveryPerformance; daysDifference: number } {
  const { estimatedDeliveryDate, actualDeliveryDate } = shipment;

  if (!estimatedDeliveryDate) return { state: 'unknown', daysDifference: 0 };
  if (!actualDeliveryDate) return { state: 'in-transit', daysDifference: 0 };

  const difference = daysBetween(estimatedDeliveryDate, actualDeliveryDate);
  if (difference === 0) return { state: 'on-time', daysDifference: 0 };
  return { state: difference > 0 ? 'late' : 'early', daysDifference: Math.abs(difference) };
}
