import { describe, expect, it } from 'vitest';
import {
  actualTransitDays,
  addBusinessDays,
  dayOfWeek,
  deliveryPerformance,
  estimateDelivery,
  isWeekend,
} from './transit';

// Anchor dates, so the weekday arithmetic below is easy to check by eye.
const MONDAY = '2026-07-13';
const FRIDAY = '2026-07-17';
const SATURDAY = '2026-07-18';
const SUNDAY = '2026-07-19';

describe('weekday helpers', () => {
  it('identifies the day of the week', () => {
    expect(dayOfWeek(MONDAY)).toBe(1);
    expect(dayOfWeek(FRIDAY)).toBe(5);
    expect(dayOfWeek(SATURDAY)).toBe(6);
    expect(dayOfWeek(SUNDAY)).toBe(0);
  });

  it('treats Saturday and Sunday as the weekend', () => {
    expect(isWeekend(SATURDAY)).toBe(true);
    expect(isWeekend(SUNDAY)).toBe(true);
    expect(isWeekend(MONDAY)).toBe(false);
    expect(isWeekend(FRIDAY)).toBe(false);
  });
});

describe('addBusinessDays', () => {
  it('steps over the weekend', () => {
    // Friday + 1 business day is the following Monday, not Saturday.
    expect(addBusinessDays(FRIDAY, 1)).toBe('2026-07-20');
    expect(addBusinessDays(FRIDAY, 3)).toBe('2026-07-22');
  });

  it('counts a plain mid-week run normally', () => {
    expect(addBusinessDays(MONDAY, 3)).toBe('2026-07-16');
  });

  it('spans several weeks', () => {
    // 10 business days is exactly two working weeks.
    expect(addBusinessDays(MONDAY, 10)).toBe('2026-07-27');
  });

  it('moves a weekend pickup to the next working day', () => {
    expect(addBusinessDays(SATURDAY, 1)).toBe('2026-07-20');
    expect(addBusinessDays(SUNDAY, 1)).toBe('2026-07-20');
  });

  it('returns the same day for zero or negative transit', () => {
    expect(addBusinessDays(MONDAY, 0)).toBe(MONDAY);
    expect(addBusinessDays(MONDAY, -2)).toBe(MONDAY);
  });
});

describe('estimateDelivery — SPEC.md §21', () => {
  it('LTL: Monday plus 3 business days delivers Thursday', () => {
    const delivery = estimateDelivery(MONDAY, 3, 'LTL');
    expect(delivery).toBe('2026-07-16');
    expect(dayOfWeek(delivery)).toBe(4); // Thursday
  });

  it('FTL: Friday plus 3 calendar days delivers Monday', () => {
    const delivery = estimateDelivery(FRIDAY, 3, 'FTL');
    expect(delivery).toBe('2026-07-20');
    expect(dayOfWeek(delivery)).toBe(1); // Monday
  });

  it('gives the two types different answers for the same booking', () => {
    // Friday + 3: FTL rolls through the weekend, LTL waits for Monday.
    expect(estimateDelivery(FRIDAY, 3, 'FTL')).toBe('2026-07-20');
    expect(estimateDelivery(FRIDAY, 3, 'LTL')).toBe('2026-07-22');
  });

  it('returns nothing when there is no pickup date to count from', () => {
    expect(estimateDelivery('', 3, 'FTL')).toBe('');
  });

  it('handles a same-day run', () => {
    expect(estimateDelivery(MONDAY, 0, 'FTL')).toBe(MONDAY);
    expect(estimateDelivery(MONDAY, 0, 'LTL')).toBe(MONDAY);
  });

  it('crosses a month boundary', () => {
    expect(estimateDelivery('2026-07-30', 3, 'FTL')).toBe('2026-08-02');
  });
});

describe('actualTransitDays', () => {
  it('counts calendar days for FTL', () => {
    expect(actualTransitDays(FRIDAY, '2026-07-20', 'FTL')).toBe(3);
  });

  it('counts only working days for LTL', () => {
    // Friday to Monday is 3 calendar days but only 1 business day.
    expect(actualTransitDays(FRIDAY, '2026-07-20', 'LTL')).toBe(1);
  });

  it('returns null until both dates are known', () => {
    expect(actualTransitDays('', '2026-07-20', 'FTL')).toBeNull();
    expect(actualTransitDays(FRIDAY, '', 'FTL')).toBeNull();
  });
});

describe('deliveryPerformance', () => {
  it('reports on time, early and late', () => {
    expect(
      deliveryPerformance({ estimatedDeliveryDate: MONDAY, actualDeliveryDate: MONDAY }),
    ).toEqual({ state: 'on-time', daysDifference: 0 });

    expect(
      deliveryPerformance({ estimatedDeliveryDate: '2026-07-16', actualDeliveryDate: '2026-07-14' }),
    ).toEqual({ state: 'early', daysDifference: 2 });

    expect(
      deliveryPerformance({ estimatedDeliveryDate: '2026-07-16', actualDeliveryDate: '2026-07-18' }),
    ).toEqual({ state: 'late', daysDifference: 2 });
  });

  it('says in transit when nothing has been delivered yet', () => {
    expect(
      deliveryPerformance({ estimatedDeliveryDate: MONDAY, actualDeliveryDate: '' }).state,
    ).toBe('in-transit');
  });

  it('says unknown when no delivery was ever estimated', () => {
    expect(
      deliveryPerformance({ estimatedDeliveryDate: '', actualDeliveryDate: '' }).state,
    ).toBe('unknown');
  });
});
