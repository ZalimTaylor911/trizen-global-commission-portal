import { useState } from 'react';
import { Eye, EyeOff, GripVertical, Pin, PinOff, RotateCcw, Save, Trash2 } from 'lucide-react';
import { moveColumn } from '@/lib/tablePrefs';
import type { TableController } from '@/lib/useTablePrefs';
import { Banner, Field, Modal } from './ui';

/** Show/hide, reorder, pin and save layouts for one table. SPEC.md §24. */
export default function ColumnManager<T>({
  table,
  onClose,
}: {
  table: TableController<T>;
  onClose: () => void;
}) {
  const { columns, prefs, layouts } = table;
  const [dragging, setDragging] = useState<string | null>(null);
  const [layoutName, setLayoutName] = useState('');

  const hidden = new Set(prefs.hidden);
  const pinned = new Set(prefs.pinned);
  const ordered = prefs.order
    .map((id) => columns.find((column) => column.id === id))
    .filter((column): column is (typeof columns)[number] => !!column);

  function handleDrop(targetId: string) {
    if (!dragging || dragging === targetId) return;
    table.reorder(moveColumn(prefs.order, dragging, prefs.order.indexOf(targetId)));
    setDragging(null);
  }

  const visibleCount = ordered.length - hidden.size;

  return (
    <Modal
      title="Customise columns"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => table.reset()}>
            <RotateCcw size={14} />
            Reset to default
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <Banner tone="info">
        These are your own settings — they don't change what anyone else sees. Drag to reorder, pin
        a column to keep it in view while scrolling sideways, and drag a column's right edge in the
        table to resize it.
      </Banner>

      {visibleCount === 0 && (
        <Banner tone="warning">Every column is hidden, so the table will be blank.</Banner>
      )}

      <div className="column-list">
        {ordered.map((column) => {
          const isHidden = hidden.has(column.id);
          return (
            <div
              key={column.id}
              className={[
                'column-row',
                dragging === column.id ? 'dragging' : '',
                isHidden ? 'is-hidden' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              draggable
              onDragStart={() => setDragging(column.id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(column.id)}
            >
              <GripVertical size={15} className="grip" />
              <span className="column-name">{column.header}</span>

              <button
                className="btn ghost small"
                onClick={() => table.togglePinned(column.id)}
                title={pinned.has(column.id) ? 'Unpin' : 'Pin to the left'}
                aria-label={pinned.has(column.id) ? 'Unpin column' : 'Pin column'}
              >
                {pinned.has(column.id) ? <Pin size={14} /> : <PinOff size={14} />}
              </button>

              <button
                className="btn ghost small"
                onClick={() => table.toggleHidden(column.id)}
                disabled={column.locked}
                title={column.locked ? 'This column is always shown' : isHidden ? 'Show' : 'Hide'}
                aria-label={isHidden ? 'Show column' : 'Hide column'}
              >
                {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          );
        })}
      </div>

      <div className="section-title" style={{ marginTop: 20 }}>
        Saved layouts
      </div>

      <div className="inline" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Field label="Save the current layout as">
            <input
              value={layoutName}
              placeholder="e.g. Billing view"
              onChange={(event) => setLayoutName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  table.saveLayout(layoutName);
                  setLayoutName('');
                }
              }}
            />
          </Field>
        </div>
        <button
          className="btn primary"
          disabled={!layoutName.trim()}
          onClick={() => {
            table.saveLayout(layoutName);
            setLayoutName('');
          }}
        >
          <Save size={14} />
          Save
        </button>
      </div>

      {layouts.length === 0 ? (
        <p className="help" style={{ marginBottom: 0 }}>
          No saved layouts yet. Save one to switch quickly between, say, an operations view and a
          billing view.
        </p>
      ) : (
        <div className="stack">
          {layouts.map((layout) => (
            <div key={layout.name} className="inline" style={{ justifyContent: 'space-between' }}>
              <span>{layout.name}</span>
              <span className="inline">
                <button className="btn small" onClick={() => table.applyLayout(layout.name)}>
                  Apply
                </button>
                <button
                  className="btn ghost small"
                  onClick={() => table.deleteLayout(layout.name)}
                  aria-label={`Delete ${layout.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
