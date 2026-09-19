import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, UploadCloud } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { shipmentsCol } from '@/firebase/collections';
import { createManyRecords } from '@/firebase/repository';
import {
  downloadCsvTemplate,
  downloadExcelTemplate,
  parseShipmentFile,
  type ImportResult,
} from '@/lib/import/shipments';
import { freezeCommissionSplit } from '@/domain/engine';
import { formatCurrency } from '@/domain/money';
import { Banner, Card, Modal } from './ui';

type Stage = 'choose' | 'review' | 'done';

export default function BulkImport({ onClose }: { onClose: () => void }) {
  const { actor } = useAuth();
  const data = useData();
  const fileInput = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('choose');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(0);
  const [showOnlyProblems, setShowOnlyProblems] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  async function handleTemplate(kind: 'csv' | 'excel') {
    setError(null);
    try {
      if (kind === 'csv') await downloadCsvTemplate();
      else await downloadExcelTemplate(data.agencies, data.customers);
    } catch (caught) {
      setError(`Could not create the template: ${(caught as Error).message}`);
    }
  }

  const uploadDisabled = busy || data.agencies.length === 0;

  function openPicker() {
    if (!uploadDisabled) fileInput.current?.click();
  }

  /** Only these ever make it to the parser; anything else is rejected up front. */
  function hasSupportedExtension(file: File): boolean {
    return /\.(csv|xlsx|xls)$/i.test(file.name);
  }

  function handleDragEnter(event: React.DragEvent) {
    event.preventDefault();
    if (uploadDisabled) return;
    // dragenter/dragleave also fire for child elements, so count the nesting
    // rather than clearing the highlight on the first leave.
    dragDepth.current += 1;
    setDragging(true);
  }

  function handleDragOver(event: React.DragEvent) {
    // Without preventDefault the browser refuses the drop entirely.
    event.preventDefault();
    if (uploadDisabled) {
      event.dataTransfer.dropEffect = 'none';
      return;
    }
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (uploadDisabled) return;

    const files = [...event.dataTransfer.files];
    if (files.length === 0) return;

    if (files.length > 1) {
      setError('Drop one file at a time — that was ' + files.length + '.');
      return;
    }

    const file = files[0]!;
    if (!hasSupportedExtension(file)) {
      setError(`"${file.name}" isn't a spreadsheet. Drop an .xlsx, .xls or .csv file.`);
      return;
    }

    void handleFile(file);
  }

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setFileName(file.name);
    try {
      const parsed = await parseShipmentFile(file, {
        agencies: data.agencies,
        customers: data.customers,
        existingLoadNumbers: new Set(
          data.shipments.map((shipment) => shipment.loadNumber.toLowerCase()).filter(Boolean),
        ),
      });
      setResult(parsed);
      setStage('review');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function commit() {
    if (!result || !actor) return;
    const drafts = result.rows
      .map((row) => row.draft)
      .filter((draft) => draft !== null)
      // Legacy Agency Paid rows are converted by the importer to the separate
      // agency-payment field, so they record the shares in force on arrival.
      .map((draft) => freezeCommissionSplit(draft, data.partners));
    if (drafts.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      const written = await createManyRecords(
        shipmentsCol,
        {
          entity: 'shipment',
          actor,
          label: `Bulk import from ${fileName}`,
          identifiers: drafts.map(
            (draft) => draft.loadNumber || `${draft.companyName} ${draft.date}`,
          ),
        },
        drafts,
      );
      setImported(written);
      setStage('done');
    } catch (caught) {
      setError(`Import failed: ${(caught as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const totals = result
    ? result.rows.reduce(
        (acc, row) => ({
          gross: acc.gross + (row.draft?.grossMargin ?? 0),
          net: acc.net + (row.draft?.netMargin ?? 0),
        }),
        { gross: 0, net: 0 },
      )
    : { gross: 0, net: 0 };

  const visibleRows =
    result && showOnlyProblems
      ? result.rows.filter((row) => row.errors.length > 0 || row.warnings.length > 0)
      : (result?.rows ?? []);

  return (
    <Modal
      title="Import shipments"
      onClose={onClose}
      footer={
        stage === 'review' ? (
          <>
            <button className="btn" onClick={() => setStage('choose')} disabled={busy}>
              Back
            </button>
            <button
              className="btn primary"
              onClick={() => void commit()}
              disabled={busy || !result || result.validCount === 0}
            >
              {busy
                ? 'Importing…'
                : `Import ${result?.validCount ?? 0} shipment${result?.validCount === 1 ? '' : 's'}`}
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={onClose}>
            {stage === 'done' ? 'Done' : 'Close'}
          </button>
        )
      }
    >
      {error && <Banner tone="error">{error}</Banner>}

      {stage === 'choose' && (
        <>
          <Banner tone="info">
            Download the template, paste your loads under its headings, then upload it back here.
            <strong> Leave net margin out</strong> — the portal works it out from Gross Margin and
            each agency's split.
          </Banner>

          <Card title="1 · Get the template">
            <div className="inline">
              <button className="btn" onClick={() => void handleTemplate('excel')}>
                <Download size={15} />
                Excel template
              </button>
              <button className="btn" onClick={() => void handleTemplate('csv')}>
                <Download size={15} />
                CSV template
              </button>
            </div>
            <p className="help" style={{ marginTop: 10, marginBottom: 0 }}>
              The Excel version has dropdowns for agency, status and type, plus a reference sheet
              listing the valid values.
            </p>
          </Card>

          <Card title="2 · Upload your filled-in file">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />

            <div
              className={[
                'dropzone',
                dragging ? 'active' : '',
                uploadDisabled ? 'disabled' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={openPicker}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              aria-label="Drop a shipment file here, or click to browse"
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openPicker();
                }
              }}
            >
              <div className="dropzone-icon">
                {dragging ? <FileUp size={30} /> : <UploadCloud size={30} />}
              </div>

              <strong>
                {busy
                  ? 'Reading your file…'
                  : dragging
                    ? 'Drop it here'
                    : 'Drag your file here'}
              </strong>
              <div className="dropzone-hint">or browse for it</div>

              <button
                className="btn primary"
                disabled={uploadDisabled}
                onClick={(event) => {
                  // The zone already handles the click; don't open twice.
                  event.stopPropagation();
                  openPicker();
                }}
              >
                <FileUp size={15} />
                {busy ? 'Reading…' : 'Choose file'}
              </button>

              <div className="dropzone-formats">Excel (.xlsx, .xls) or CSV</div>
            </div>

            {data.agencies.length === 0 && (
              <p className="help" style={{ marginTop: 10, marginBottom: 0 }}>
                Add at least one agency first — every row needs one to determine the split.
              </p>
            )}
          </Card>
        </>
      )}

      {stage === 'review' && result && (
        <>
          {result.fatalError ? (
            <Banner tone="error">{result.fatalError}</Banner>
          ) : (
            <>
              <div className="tiles">
                <div className="tile">
                  <div className="label">Ready to import</div>
                  <div className="value positive">{result.validCount}</div>
                </div>
                <div className="tile">
                  <div className="label">Rows with errors</div>
                  <div className={result.errorCount > 0 ? 'value negative' : 'value'}>
                    {result.errorCount}
                  </div>
                  <div className="hint">Skipped</div>
                </div>
                <div className="tile">
                  <div className="label">Gross margin</div>
                  <div className="value">{formatCurrency(totals.gross)}</div>
                </div>
                <div className="tile accent">
                  <div className="label">Our share (net)</div>
                  <div className="value">{formatCurrency(totals.net)}</div>
                </div>
              </div>

              {result.errorCount > 0 && (
                <Banner tone="warning">
                  {result.errorCount} row{result.errorCount === 1 ? '' : 's'} can't be imported and
                  will be skipped. Fix them in your file and upload again if you need them.
                </Banner>
              )}

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={showOnlyProblems}
                  onChange={(event) => setShowOnlyProblems(event.target.checked)}
                />
                <span>Show only rows with errors or warnings</span>
              </label>

              <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Date</th>
                      <th>Load #</th>
                      <th>Company</th>
                      <th>Type</th>
                      <th className="num">Gross</th>
                      <th className="num">Net (ours)</th>
                      <th>Status</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.slice(0, 200).map((row) => (
                      <tr key={row.lineNumber}>
                        <td className="mono">{row.lineNumber}</td>
                        <td className="nowrap">{row.draft?.date ?? row.raw.Date}</td>
                        <td className="mono">{row.raw['Load Number'] || '—'}</td>
                        <td>{row.raw['Company Name'] || '—'}</td>
                        <td>{row.draft?.shipmentType ?? '—'}</td>
                        <td className="num">
                          {row.draft ? formatCurrency(row.draft.grossMargin) : '—'}
                        </td>
                        <td className="num">
                          {row.draft ? formatCurrency(row.draft.netMargin) : '—'}
                        </td>
                        <td>{row.draft?.status ?? '—'}</td>
                        <td>
                          {row.errors.length === 0 && row.warnings.length === 0 && (
                            <span className="badge success">OK</span>
                          )}
                          {row.errors.map((issue) => (
                            <div key={issue.column} style={{ color: 'var(--negative)' }}>
                              <strong>{issue.column}:</strong> {issue.message}
                            </div>
                          ))}
                          {row.warnings.map((issue) => (
                            <div key={issue.column} style={{ color: 'var(--warning)' }}>
                              <strong>{issue.column}:</strong> {issue.message}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {visibleRows.length > 200 && (
                <p className="muted">
                  Showing the first 200 of {visibleRows.length} rows. All valid rows will be
                  imported.
                </p>
              )}
            </>
          )}
        </>
      )}

      {stage === 'done' && (
        <Card>
          <div style={{ textAlign: 'center', padding: '18px 0' }}>
            <CheckCircle2 size={40} style={{ color: 'var(--positive)' }} />
            <h3 style={{ marginTop: 12 }}>
              {imported} shipment{imported === 1 ? '' : 's'} imported
            </h3>
            <p className="muted" style={{ marginTop: 6 }}>
              They're on the Shipments screen now. Only the ones with an <strong>agency payment recorded</strong>{' '}
              have credited anyone's balance.
            </p>
          </div>
        </Card>
      )}

      {stage === 'choose' && (
        <p className="help" style={{ marginBottom: 0 }}>
          <AlertTriangle size={12} style={{ verticalAlign: -1 }} /> Importing doesn't check for
          loads you've already entered by hand — matching load numbers are flagged as warnings in
          the preview.
        </p>
      )}

    </Modal>
  );
}
