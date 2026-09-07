'use client';

import { ChangeEvent, Suspense, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError, downloadFile, uploadFile } from '@/lib/api';

type EntityType = 'AGENCY' | 'ADVERTISER' | 'BRAND' | 'MERCHANT';

interface ImportRowResult {
  rowNumber: number;
  data: Record<string, string>;
  status: 'VALID' | 'INVALID' | 'DUPLICATE';
  errors: string[];
  insertError?: string;
}

interface ImportSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  importedRows: number;
  failedRows: number;
  rows: ImportRowResult[];
}

const ENTITY_OPTIONS: { value: EntityType; label: string; columns: string; template: string }[] = [
  { value: 'AGENCY', label: 'Agency', columns: 'code, name', template: 'code,name\nGRPM,GroupM Indonesia' },
  {
    value: 'ADVERTISER',
    label: 'Advertiser',
    columns: 'code, name, agencyCode (must already exist in Master Data)',
    template: 'code,name,agencyCode\nUNVR,PT Unilever Indonesia,GRPM',
  },
  {
    value: 'BRAND',
    label: 'Brand',
    columns: 'code, name, advertiserCode (must already exist in Master Data)',
    template: 'code,name,advertiserCode\nPEPSODENT,Pepsodent,UNVR',
  },
  { value: 'MERCHANT', label: 'Merchant', columns: 'name, alias (optional, comma-separated)', template: 'name,alias\nSushi Tei,SUSHITEI' },
];

function StatusBadge({ status }: { status: ImportRowResult['status'] }) {
  const cls = status === 'VALID' ? 'badge-success' : status === 'DUPLICATE' ? 'badge-warning' : 'badge-danger';
  return <span className={`badge ${cls}`}>{status}</span>;
}

// Excel/CSV/PDF Import (BRD section 17, 26 -> Import > Excel/CSV).
// Two-step flow: preview (parses + validates, nothing persisted) then confirm
// (re-sends the same rows to /commit, which only inserts the VALID ones).
export default function ImportPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ImportPageInner />
    </Suspense>
  );
}

function ImportPageInner() {
  const searchParams = useSearchParams();
  const preselected = searchParams.get('entityType') as EntityType | null;
  const [entityType, setEntityType] = useState<EntityType>(
    preselected && ENTITY_OPTIONS.some((o) => o.value === preselected) ? preselected : 'AGENCY',
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = ENTITY_OPTIONS.find((o) => o.value === entityType)!;

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onEntityChange = (value: EntityType) => {
    setEntityType(value);
    reset();
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setPreview(null);
    setResult(null);
    setError('');
  };

  const downloadTemplate = async () => {
    setError('');
    try {
      await downloadFile(`/import/${entityType}/template`, `${entityType.toLowerCase()}_import_template.xlsx`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Template download failed');
    }
  };

  const runPreview = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const summary = await uploadFile(`/import/${entityType}/preview`, file);
      setPreview(summary as ImportSummary);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const confirmImport = async () => {
    if (!preview) return;
    setLoading(true);
    setError('');
    try {
      const rows = preview.rows.map((r) => r.data);
      const summary = await api.post<ImportSummary>(`/import/${entityType}/commit`, { rows });
      setResult(summary);
      setPreview(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const allColumns = (rows: ImportRowResult[]) => {
    const cols = new Set<string>();
    rows.forEach((r) => Object.keys(r.data).forEach((k) => cols.add(k)));
    return Array.from(cols);
  };

  const summary = result ?? preview;

  return (
    <div>
      <h1>Import Master Data</h1>
      <p style={{ color: 'var(--muted)', marginTop: -8 }}>
        Excel (.xlsx), CSV, or PDF. PDF import is best-effort — it assumes a single simple table (e.g. exported from a
        spreadsheet) and may not parse correctly for other PDF layouts.
      </p>

      <div className="card">
        <div className="form-grid">
          <div className="form-row">
            <label>Import Target</label>
            <select value={entityType} onChange={(e) => onEntityChange(e.target.value as EntityType)}>
              {ENTITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>File</label>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={onFileChange} />
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          Expected columns: <strong>{selectedOption.columns}</strong>
          <br />
          Example CSV: <code style={{ background: '#f1f2f5', padding: '1px 6px', borderRadius: 4 }}>{selectedOption.template}</code>
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button className="btn" onClick={downloadTemplate}>
            Download Empty Template (.xlsx)
          </button>
          <button className="btn btn-primary" disabled={!file || loading} onClick={runPreview}>
            {loading && !preview ? 'Parsing...' : 'Preview'}
          </button>
          {(preview || result) && (
            <button className="btn" onClick={reset}>
              Start Over
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}

      {summary && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Total Rows</div>
              <div className="value">{summary.totalRows}</div>
            </div>
            <div className="stat">
              <div className="label">Valid</div>
              <div className="value" style={{ color: 'var(--success)' }}>{summary.validRows}</div>
            </div>
            <div className="stat">
              <div className="label">Duplicate</div>
              <div className="value" style={{ color: 'var(--warning)' }}>{summary.duplicateRows}</div>
            </div>
            <div className="stat">
              <div className="label">Invalid</div>
              <div className="value" style={{ color: 'var(--danger)' }}>{summary.invalidRows}</div>
            </div>
            {result && (
              <>
                <div className="stat">
                  <div className="label">Imported</div>
                  <div className="value" style={{ color: 'var(--success)' }}>{result.importedRows}</div>
                </div>
                <div className="stat">
                  <div className="label">Failed</div>
                  <div className="value" style={{ color: 'var(--danger)' }}>{result.failedRows}</div>
                </div>
              </>
            )}
          </div>

          {preview && !result && (
            <div style={{ marginBottom: 16 }}>
              <button className="btn btn-primary" disabled={loading || preview.validRows === 0} onClick={confirmImport}>
                {loading ? 'Importing...' : `Confirm Import (${preview.validRows} rows)`}
              </button>
            </div>
          )}

          <div className="card" style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Status</th>
                  {allColumns(summary.rows).map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td>{r.rowNumber}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    {allColumns(summary.rows).map((c) => (
                      <td key={c}>{r.data[c] ?? ''}</td>
                    ))}
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {[...r.errors, r.insertError].filter(Boolean).join('; ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
