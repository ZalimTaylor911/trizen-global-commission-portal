import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  clampWidth,
  clearState,
  loadState,
  pinnedOffsets,
  reconcile,
  resolveVisible,
  saveState,
  toggleIn,
  type SavedLayout,
  type TablePrefs,
} from './tablePrefs';

export interface Column<T> {
  id: string;
  header: string;
  /** Default width in pixels before the user resizes it. */
  width?: number;
  numeric?: boolean;
  /** Set false for action columns that make no sense to sort by. */
  sortable?: boolean;
  /** Never hidden — used for the row-actions column. */
  locked?: boolean;
  /** Available but off until someone turns it on, to keep the table readable. */
  hiddenByDefault?: boolean;
  render: (row: T) => ReactNode;
  /** Sort key and export value. Falls back to the raw render for plain text. */
  value?: (row: T) => string | number;
}

const DEFAULT_WIDTH = 140;

export interface TableController<T> {
  columns: Column<T>[];
  prefs: TablePrefs;
  /** Columns actually rendered, pinned first, in order. */
  visibleColumns: Column<T>[];
  offsets: Record<string, number>;
  widthOf: (id: string) => number;
  layouts: SavedLayout[];

  toggleHidden: (id: string) => void;
  togglePinned: (id: string) => void;
  reorder: (order: string[]) => void;
  setWidth: (id: string, width: number) => void;
  toggleSort: (id: string) => void;
  reset: () => void;
  saveLayout: (name: string) => void;
  applyLayout: (name: string) => void;
  deleteLayout: (name: string) => void;

  sortRows: (rows: T[]) => T[];
}

/**
 * Owns one table's personal layout. The page keeps hold of the controller so it
 * can also export exactly the columns currently on screen.
 */
export function useTablePrefs<T>(
  tableId: string,
  userId: string,
  columns: Column<T>[],
): TableController<T> {
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns]);

  /** First-run layout: everything on except columns marked off by default. */
  const seedPrefs = useCallback(
    (): TablePrefs => ({
      order: [],
      hidden: columns.filter((column) => column.hiddenByDefault).map((column) => column.id),
      pinned: [],
      widths: {},
      sort: null,
    }),
    [columns],
  );

  const readInitial = useCallback(() => {
    const stored = loadState(tableId, userId);
    return {
      prefs: reconcile(stored.hasStored ? stored.current : seedPrefs(), columnIds),
      layouts: stored.layouts,
    };
  }, [tableId, userId, columnIds, seedPrefs]);

  const [prefs, setPrefsState] = useState<TablePrefs>(() => readInitial().prefs);
  const [layouts, setLayouts] = useState<SavedLayout[]>(() => readInitial().layouts);

  // Switching user (or the column set changing between releases) re-reconciles.
  useEffect(() => {
    const initial = readInitial();
    setPrefsState(initial.prefs);
    setLayouts(initial.layouts);
  }, [readInitial]);

  const persist = useCallback(
    (next: TablePrefs, nextLayouts: SavedLayout[] = layouts) => {
      setPrefsState(next);
      setLayouts(nextLayouts);
      saveState(tableId, userId, { current: next, layouts: nextLayouts });
    },
    [tableId, userId, layouts],
  );

  const byId = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns]);
  const widthOf = useCallback(
    (id: string) => prefs.widths[id] ?? byId.get(id)?.width ?? DEFAULT_WIDTH,
    [prefs.widths, byId],
  );

  const visibleIds = useMemo(() => resolveVisible(prefs), [prefs]);
  const visibleColumns = useMemo(
    () => visibleIds.map((id) => byId.get(id)).filter((column): column is Column<T> => !!column),
    [visibleIds, byId],
  );

  const offsets = useMemo(
    () => pinnedOffsets(visibleIds, prefs, (id) => byId.get(id)?.width ?? DEFAULT_WIDTH),
    [visibleIds, prefs, byId],
  );

  const sortRows = useCallback(
    (rows: T[]) => {
      if (!prefs.sort) return rows;
      const column = byId.get(prefs.sort.columnId);
      if (!column?.value) return rows;

      const direction = prefs.sort.direction === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) => {
        const left = column.value!(a);
        const right = column.value!(b);
        if (typeof left === 'number' && typeof right === 'number') {
          return (left - right) * direction;
        }
        return String(left).localeCompare(String(right)) * direction;
      });
    },
    [prefs.sort, byId],
  );

  return {
    columns,
    prefs,
    visibleColumns,
    offsets,
    widthOf,
    layouts,

    toggleHidden: (id) => {
      if (byId.get(id)?.locked) return;
      persist({ ...prefs, hidden: toggleIn(prefs.hidden, id) });
    },
    togglePinned: (id) => persist({ ...prefs, pinned: toggleIn(prefs.pinned, id) }),
    reorder: (order) => persist({ ...prefs, order }),
    setWidth: (id, width) =>
      persist({ ...prefs, widths: { ...prefs.widths, [id]: clampWidth(width) } }),

    toggleSort: (id) => {
      const column = byId.get(id);
      if (!column?.value || column.sortable === false) return;

      // Cycles ascending → descending → unsorted.
      if (prefs.sort?.columnId !== id) {
        persist({ ...prefs, sort: { columnId: id, direction: 'asc' } });
      } else if (prefs.sort.direction === 'asc') {
        persist({ ...prefs, sort: { columnId: id, direction: 'desc' } });
      } else {
        persist({ ...prefs, sort: null });
      }
    },

    reset: () => {
      clearState(tableId, userId);
      setPrefsState(reconcile(seedPrefs(), columnIds));
      setLayouts([]);
    },

    saveLayout: (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const without = layouts.filter((layout) => layout.name !== trimmed);
      persist(prefs, [...without, { name: trimmed, prefs }]);
    },
    applyLayout: (name) => {
      const layout = layouts.find((entry) => entry.name === name);
      if (layout) persist(reconcile(layout.prefs, columnIds));
    },
    deleteLayout: (name) =>
      persist(
        prefs,
        layouts.filter((layout) => layout.name !== name),
      ),

    sortRows,
  };
}
