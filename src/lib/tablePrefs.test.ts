import { describe, expect, it } from 'vitest';
import {
  clampWidth,
  emptyPrefs,
  moveColumn,
  pinnedOffsets,
  reconcile,
  resolveVisible,
  toggleIn,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  type TablePrefs,
} from './tablePrefs';

const ALL = ['date', 'load', 'company', 'ar', 'status'];

function prefs(overrides: Partial<TablePrefs> = {}): TablePrefs {
  return { ...emptyPrefs(), order: [...ALL], ...overrides };
}

describe('reconcile', () => {
  it('appends columns added since the layout was saved', () => {
    // Someone saved a layout before 'status' existed.
    const saved = prefs({ order: ['date', 'load', 'company', 'ar'] });
    expect(reconcile(saved, ALL).order).toEqual(['date', 'load', 'company', 'ar', 'status']);
  });

  it('keeps a new column visible rather than hiding it by default', () => {
    const saved = prefs({ order: ['date'], hidden: [] });
    const result = reconcile(saved, ALL);
    expect(resolveVisible(result)).toContain('status');
  });

  it('drops columns that no longer exist', () => {
    const saved = prefs({
      order: ['date', 'removed', 'load'],
      hidden: ['removed'],
      pinned: ['removed'],
      widths: { removed: 120, date: 90 },
    });
    const result = reconcile(saved, ALL);

    expect(result.order).not.toContain('removed');
    expect(result.hidden).not.toContain('removed');
    expect(result.pinned).not.toContain('removed');
    expect(result.widths).not.toHaveProperty('removed');
    expect(result.widths.date).toBe(90);
  });

  it('discards a sort on a column that has gone', () => {
    const saved = prefs({ sort: { columnId: 'removed', direction: 'asc' } });
    expect(reconcile(saved, ALL).sort).toBeNull();
  });

  it('keeps a sort on a column that still exists', () => {
    const saved = prefs({ sort: { columnId: 'ar', direction: 'desc' } });
    expect(reconcile(saved, ALL).sort).toEqual({ columnId: 'ar', direction: 'desc' });
  });

  it('produces the full column set from empty preferences', () => {
    expect(reconcile(emptyPrefs(), ALL).order).toEqual(ALL);
  });
});

describe('moveColumn', () => {
  it('moves a column later in the order', () => {
    expect(moveColumn(ALL, 'date', 2)).toEqual(['load', 'company', 'date', 'ar', 'status']);
  });

  it('moves a column earlier', () => {
    expect(moveColumn(ALL, 'status', 0)).toEqual(['status', 'date', 'load', 'company', 'ar']);
  });

  it('clamps an index past the end', () => {
    expect(moveColumn(ALL, 'date', 99)).toEqual(['load', 'company', 'ar', 'status', 'date']);
  });

  it('leaves the order alone for an unknown column', () => {
    expect(moveColumn(ALL, 'nope', 0)).toEqual(ALL);
  });
});

describe('resolveVisible', () => {
  it('drops hidden columns', () => {
    expect(resolveVisible(prefs({ hidden: ['company', 'ar'] }))).toEqual([
      'date',
      'load',
      'status',
    ]);
  });

  it('floats pinned columns to the front, keeping their relative order', () => {
    expect(resolveVisible(prefs({ pinned: ['status', 'load'] }))).toEqual([
      'load',
      'status',
      'date',
      'company',
      'ar',
    ]);
  });

  it('ignores a column that is both pinned and hidden', () => {
    const result = resolveVisible(prefs({ pinned: ['status'], hidden: ['status'] }));
    expect(result).not.toContain('status');
  });
});

describe('pinnedOffsets', () => {
  it('stacks pinned columns by their widths', () => {
    const state = prefs({ pinned: ['date', 'load'], widths: { date: 100, load: 80 } });
    const visible = resolveVisible(state);

    expect(pinnedOffsets(visible, state, () => 120)).toEqual({ date: 0, load: 100 });
  });

  it('falls back to the default width when none is saved', () => {
    const state = prefs({ pinned: ['date', 'load'] });
    const visible = resolveVisible(state);

    expect(pinnedOffsets(visible, state, () => 120)).toEqual({ date: 0, load: 120 });
  });

  it('offsets nothing when no column is pinned', () => {
    const state = prefs();
    expect(pinnedOffsets(resolveVisible(state), state, () => 120)).toEqual({});
  });
});

describe('helpers', () => {
  it('toggles membership', () => {
    expect(toggleIn(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleIn(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('keeps widths inside sensible bounds', () => {
    expect(clampWidth(10)).toBe(MIN_COLUMN_WIDTH);
    expect(clampWidth(9999)).toBe(MAX_COLUMN_WIDTH);
    expect(clampWidth(180.6)).toBe(181);
  });
});
