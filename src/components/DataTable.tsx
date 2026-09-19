import { useCallback, useRef, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, Pin, Square } from 'lucide-react';
import type { TableController } from '@/lib/useTablePrefs';
import { EmptyState } from './ui';

/**
 * Column-driven table with sorting, pinning and drag-to-resize. Layout comes
 * from the controller so the page can export exactly what's on screen.
 */
export default function DataTable<T>({
  table,
  rows,
  rowKey,
  onRowClick,
  footer,
  emptyTitle,
  emptyMessage,
  selectable = false,
  selectedIds,
  rowId,
  onToggleRow,
  onToggleAll,
}: {
  table: TableController<T>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
  emptyTitle: string;
  emptyMessage: string;
  selectable?: boolean;
  selectedIds?: string[];
  rowId?: (row: T) => string;
  onToggleRow?: (row: T) => void;
  onToggleAll?: () => void;
}) {
  const { visibleColumns, prefs, offsets, widthOf, setWidth, toggleSort } = table;
  const resizing = useRef<{ id: string; startX: number; startWidth: number } | null>(null);

  const beginResize = useCallback(
    (event: React.MouseEvent, id: string) => {
      // Stop the click reaching the header, which would sort the column.
      event.preventDefault();
      event.stopPropagation();
      resizing.current = { id, startX: event.clientX, startWidth: widthOf(id) };

      const onMove = (move: MouseEvent) => {
        const state = resizing.current;
        if (!state) return;
        setWidth(state.id, state.startWidth + (move.clientX - state.startX));
      };
      const onUp = () => {
        resizing.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
    },
    [setWidth, widthOf],
  );

  const pinned = new Set(prefs.pinned);
  const selected = new Set(selectedIds ?? []);
  const selectableRows = rows.filter((row) => rowId?.(row));
  const allSelected = selectableRows.length > 0 && selectableRows.every((row) => selected.has(rowId!(row)));

  return (
    <div className="table-wrap">
      <table className="data resizable">
        <colgroup>
          {visibleColumns.map((column) => (
            <col key={column.id} style={{ width: widthOf(column.id) }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {visibleColumns.map((column) => {
              const isPinned = pinned.has(column.id);
              const sorted = prefs.sort?.columnId === column.id ? prefs.sort.direction : null;
              const canSort = Boolean(column.value) && column.sortable !== false;

              return (
                <th
                  key={column.id}
                  className={[
                    column.numeric ? 'num' : '',
                    isPinned ? 'pinned' : '',
                    `${column.id}-column`,
                    canSort ? 'sortable' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={isPinned ? { left: offsets[column.id] ?? 0 } : undefined}
                  onClick={() => canSort && toggleSort(column.id)}
                  title={canSort ? `Sort by ${column.header}` : undefined}
                >
                  <span className="th-label">
                    {isPinned && <Pin size={10} className="pin-mark" />}
                    {column.header}
                    {sorted === 'asc' && <ArrowUp size={12} />}
                    {sorted === 'desc' && <ArrowDown size={12} />}
                  </span>
                  <span
                    className="col-resizer"
                    onMouseDown={(event) => beginResize(event, column.id)}
                    onClick={(event) => event.stopPropagation()}
                    role="separator"
                    aria-label={`Resize ${column.header}`}
                  />
                </th>
              );
            })}
            {selectable && <th className="selection-column" aria-label="Select shipments">
              <button type="button" className="table-select-button" onClick={onToggleAll} aria-label={allSelected ? 'Clear selection' : 'Select all visible shipments'}>
                {allSelected ? <Check size={15} /> : <Square size={15} />}
              </button>
            </th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={Math.max(1, visibleColumns.length + (selectable ? 1 : 0))}>
                <EmptyState title={emptyTitle} message={emptyMessage} />
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {visibleColumns.map((column) => {
                const isPinned = pinned.has(column.id);
                return (
                  <td
                    key={column.id}
                    className={[column.numeric ? 'num' : '', isPinned ? 'pinned' : '', `${column.id}-column`]
                      .filter(Boolean)
                      .join(' ')}
                    style={isPinned ? { left: offsets[column.id] ?? 0 } : undefined}
                  >
                    {column.render(row)}
                  </td>
                );
              })}
              {selectable && <td className="selection-column" onClick={(event) => event.stopPropagation()}>
                <button type="button" className="table-select-button" onClick={() => onToggleRow?.(row)} aria-label={selected.has(rowId?.(row) ?? '') ? 'Clear shipment selection' : 'Select shipment'}>
                  {selected.has(rowId?.(row) ?? '') ? <Check size={15} /> : <Square size={15} />}
                </button>
              </td>}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  );
}
