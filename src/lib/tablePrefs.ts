/**
 * Per-user table layout preferences. SPEC.md §24.
 *
 * Stored in localStorage rather than Firestore: these are personal display
 * choices, they change constantly while someone drags a column about, and
 * writing every drag to Firestore would burn the Spark plan's write quota for
 * something nobody else needs to see.
 */

export interface SortState {
  columnId: string;
  direction: 'asc' | 'desc';
}

export interface TablePrefs {
  /** Column ids in display order. */
  order: string[];
  hidden: string[];
  /** Pinned to the left edge, in `order` sequence. */
  pinned: string[];
  widths: Record<string, number>;
  sort: SortState | null;
}

export interface SavedLayout {
  name: string;
  prefs: TablePrefs;
}

interface StoredState {
  current: TablePrefs;
  layouts: SavedLayout[];
  /** False when nothing was saved yet, so the caller can seed its defaults. */
  hasStored: boolean;
}

export const MIN_COLUMN_WIDTH = 70;
export const MAX_COLUMN_WIDTH = 640;

export function emptyPrefs(): TablePrefs {
  return { order: [], hidden: [], pinned: [], widths: {}, sort: null };
}

function storageKey(tableId: string, userId: string): string {
  return `trizen.table.${tableId}.${userId || 'anonymous'}`;
}

export function loadState(tableId: string, userId: string): StoredState {
  const fallback: StoredState = { current: emptyPrefs(), layouts: [], hasStored: false };
  try {
    const raw = localStorage.getItem(storageKey(tableId, userId));
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      current: { ...emptyPrefs(), ...(parsed.current ?? {}) },
      layouts: Array.isArray(parsed.layouts) ? parsed.layouts : [],
      hasStored: true,
    };
  } catch {
    // A corrupt or hand-edited entry shouldn't stop the table rendering.
    return fallback;
  }
}

export function saveState(
  tableId: string,
  userId: string,
  state: Omit<StoredState, 'hasStored'>,
): void {
  try {
    localStorage.setItem(storageKey(tableId, userId), JSON.stringify(state));
  } catch {
    // Private mode or a full quota — the table still works, just doesn't persist.
  }
}

export function clearState(tableId: string, userId: string): void {
  try {
    localStorage.removeItem(storageKey(tableId, userId));
  } catch {
    /* nothing useful to do */
  }
}

/**
 * Reconciles saved preferences against the columns that exist today.
 *
 * Columns added to the app after someone saved a layout must still appear, and
 * columns since removed must not linger — otherwise a release that adds a field
 * would be invisible to everyone with an existing layout.
 */
export function reconcile(prefs: TablePrefs, availableIds: string[]): TablePrefs {
  const available = new Set(availableIds);

  const ordered = prefs.order.filter((id) => available.has(id));
  const missing = availableIds.filter((id) => !ordered.includes(id));

  return {
    order: [...ordered, ...missing],
    hidden: prefs.hidden.filter((id) => available.has(id)),
    pinned: prefs.pinned.filter((id) => available.has(id)),
    widths: Object.fromEntries(
      Object.entries(prefs.widths).filter(([id]) => available.has(id)),
    ),
    sort: prefs.sort && available.has(prefs.sort.columnId) ? prefs.sort : null,
  };
}

/** Moves a column so it sits at `toIndex` in the visible order. */
export function moveColumn(order: string[], columnId: string, toIndex: number): string[] {
  const from = order.indexOf(columnId);
  if (from < 0) return order;

  const next = [...order];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, columnId);
  return next;
}

export function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export function clampWidth(width: number): number {
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
}

/**
 * Final column sequence: pinned columns first (in their saved order), then the
 * rest. Hidden columns are dropped entirely.
 */
export function resolveVisible(prefs: TablePrefs): string[] {
  const hidden = new Set(prefs.hidden);
  const pinned = new Set(prefs.pinned);
  const visible = prefs.order.filter((id) => !hidden.has(id));

  return [
    ...visible.filter((id) => pinned.has(id)),
    ...visible.filter((id) => !pinned.has(id)),
  ];
}

/** Left offset for each pinned column, so they stack rather than overlap. */
export function pinnedOffsets(
  visibleIds: string[],
  prefs: TablePrefs,
  defaultWidth: (id: string) => number,
): Record<string, number> {
  const pinned = new Set(prefs.pinned);
  const offsets: Record<string, number> = {};

  let cursor = 0;
  for (const id of visibleIds) {
    if (!pinned.has(id)) break; // pinned columns are always the leading run
    offsets[id] = cursor;
    cursor += prefs.widths[id] ?? defaultWidth(id);
  }
  return offsets;
}
