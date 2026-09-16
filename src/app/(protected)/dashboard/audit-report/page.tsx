'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { usePagination } from '@/lib/usePagination';
import DatePicker from '@/components/DatePicker';
import Pagination from '@/components/Pagination';
import DonutChart from '@/components/DonutChart';
import RankedBarList from '@/components/RankedBarList';
import AuditTrendChart from '@/components/AuditTrendChart';
import FindingDetailModal, { FindingRow } from '@/components/FindingDetailModal';

interface Summary {
  transactionsReviewed: number;
  transactionsReviewedAmount: number;
  compliantTransactions: number;
  complianceRate: number;
  auditExceptions: number;
  auditExceptionsAmount: number;
  highRiskFindings: number;
  highRiskFindingsAmount: number;
  outstandingSettlement: number;
  outstandingSettlementCount: number;
  documentsCompletePct: number;
}

interface FindingTypeRow {
  key: string;
  label: string;
  count: number;
  amount: number;
  color: string;
}

interface DonutRow {
  id: string;
  label: string;
  value: number;
  color: string;
  subtitle?: string;
}

interface TrendRow {
  month: string;
  totalExpense: number;
  totalSettled: number;
  exceptionsCount: number;
}

interface PodValueRow {
  id: string;
  name: string;
  value: number;
}

interface AgingRow {
  id: string;
  name: string;
  value: number;
}

interface Alert {
  id: string;
  level: 'danger' | 'warning';
  message: string;
}

interface DepartmentOption {
  id: string;
  name: string;
}

const RISK_OPTIONS = ['HIGH', 'MEDIUM', 'LOW'];
const FINDING_TYPE_OPTIONS = [
  { value: 'MISSING_RECEIPT', label: 'Missing Receipt' },
  { value: 'UNMATCHED_TRANSACTION', label: 'Unmatched Transaction' },
  { value: 'OVERDUE_SETTLEMENT', label: 'Overdue Settlement' },
  { value: 'DUPLICATE_CLAIM', label: 'Duplicate Claim' },
  { value: 'POLICY_EXCEPTION', label: 'Policy Exception' },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function formatCompactCurrency(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `Rp${(value / 1_000_000_000).toFixed(2)}M`;
  if (abs >= 1_000_000) return `Rp${(value / 1_000_000).toFixed(0)}Jt`;
  if (abs >= 1_000) return `Rp${(value / 1_000).toFixed(0)}rb`;
  return `Rp${value}`;
}

function buildQuery(params: Record<string, string>) {
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qp.set(k, v);
  }
  const qs = qp.toString();
  return qs ? `?${qs}` : '';
}

function complianceColor(score: number) {
  if (score >= 90) return '#3fd085';
  if (score >= 75) return '#f7b955';
  return '#f0605f';
}

function riskBadgeClass(risk: string) {
  return risk === 'HIGH' ? 'badge-danger' : risk === 'MEDIUM' ? 'badge-warning' : 'badge-info';
}

function statusBadgeClass(status: string) {
  return status === 'RESOLVED' ? 'badge-success' : status === 'OPEN' ? 'badge-danger' : 'badge-warning';
}

function statusLabel(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase().replace('_', ' ');
}

export default function AuditReportDashboardPage() {
  const [draftFrom, setDraftFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [draftTo, setDraftTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [draftDepartmentId, setDraftDepartmentId] = useState('');
  const [draftRiskLevel, setDraftRiskLevel] = useState('');
  const [draftFindingType, setDraftFindingType] = useState('');

  const [appliedFilter, setAppliedFilter] = useState({
    from: draftFrom,
    to: draftTo,
    departmentId: '',
    riskLevel: '',
    findingType: '',
  });

  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [findingsByType, setFindingsByType] = useState<FindingTypeRow[]>([]);
  const [riskBreakdown, setRiskBreakdown] = useState<DonutRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [complianceByPod, setComplianceByPod] = useState<PodValueRow[]>([]);
  const [highRiskByPod, setHighRiskByPod] = useState<PodValueRow[]>([]);
  const [documentCompleteness, setDocumentCompleteness] = useState<DonutRow[]>([]);
  const [settlementAging, setSettlementAging] = useState<AgingRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [reviewing, setReviewing] = useState<FindingRow | null>(null);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<DepartmentOption[]>('/departments?active=true').then(setDepartmentOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    const qs = buildQuery(appliedFilter);
    const findingsQs = buildQuery({ ...appliedFilter, pageSize: '200' });
    setLoading(true);
    Promise.all([
      api.get<Summary>(`/audit-report/summary${qs}`),
      api.get<FindingTypeRow[]>(`/audit-report/findings-by-type${qs}`),
      api.get<DonutRow[]>(`/audit-report/risk-breakdown${qs}`),
      api.get<TrendRow[]>(`/audit-report/trend${qs}`),
      api.get<PodValueRow[]>(`/audit-report/compliance-by-pod${qs}`),
      api.get<PodValueRow[]>(`/audit-report/high-risk-exposure-by-pod${qs}`),
      api.get<DonutRow[]>(`/audit-report/document-completeness${qs}`),
      api.get<AgingRow[]>(`/audit-report/settlement-aging${qs}`),
      api.get<Alert[]>(`/audit-report/director-attention${qs}`),
      api.get<{ rows: FindingRow[] }>(`/audit-report/findings${findingsQs}`),
    ])
      .then(([s, byType, risk, tr, compliance, highRisk, docComplete, aging, dirAlerts, findingsPage]) => {
        setSummary(s);
        setFindingsByType(byType);
        setRiskBreakdown(risk);
        setTrend(tr);
        setComplianceByPod(compliance);
        setHighRiskByPod(highRisk);
        setDocumentCompleteness(docComplete);
        setSettlementAging(aging);
        setAlerts(dirAlerts);
        setFindings(findingsPage.rows);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load audit report'))
      .finally(() => setLoading(false));
  }, [appliedFilter]);

  const applyFilter = () => {
    setAppliedFilter({ from: draftFrom, to: draftTo, departmentId: draftDepartmentId, riskLevel: draftRiskLevel, findingType: draftFindingType });
  };

  const clearFilter = () => {
    setDraftDepartmentId('');
    setDraftRiskLevel('');
    setDraftFindingType('');
    setAppliedFilter((f) => ({ ...f, departmentId: '', riskLevel: '', findingType: '' }));
  };

  const hasAppliedFilter = !!(appliedFilter.departmentId || appliedFilter.riskLevel || appliedFilter.findingType);

  // No PDF-generation library on the backend (see CLAUDE.md) - build a
  // printable summary client-side, same approach as Expense Analytics' Export Report.
  const exportReport = () => {
    if (!summary) return;
    const win = window.open('', '_blank');
    if (!win) return;
    const rows = findings
      .map(
        (f) => `<tr>
          <td>${f.findingNo}</td>
          <td>${f.findingLabel}</td>
          <td>${f.departmentName}</td>
          <td>${formatCurrency(f.amount)}</td>
          <td>${f.riskLevel}</td>
          <td>${f.agingDays}</td>
          <td>${statusLabel(f.status)}</td>
        </tr>`,
      )
      .join('');
    win.document.write(`<!doctype html><html><head><title>Audit Report Dashboard</title><style>
      body { font-family: sans-serif; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
      th { background: #eee; }
      .stats { display: flex; gap: 16px; flex-wrap: wrap; }
      .stats div { border: 1px solid #ccc; padding: 8px 12px; border-radius: 6px; }
    </style></head><body>
      <h2>Audit Report Dashboard</h2>
      <div>${draftFrom} &ndash; ${draftTo}</div>
      <div class="stats">
        <div>Transactions Reviewed<br/><strong>${summary.transactionsReviewed}</strong></div>
        <div>Compliant Transactions<br/><strong>${summary.compliantTransactions} (${summary.complianceRate}%)</strong></div>
        <div>Audit Exceptions<br/><strong>${summary.auditExceptions}</strong></div>
        <div>High-Risk Findings<br/><strong>${summary.highRiskFindings}</strong></div>
        <div>Outstanding Settlement<br/><strong>${formatCurrency(summary.outstandingSettlement)}</strong></div>
        <div>Documents Complete<br/><strong>${summary.documentsCompletePct}%</strong></div>
      </div>
      <h3>Priority Audit Findings</h3>
      <table><thead><tr>
        <th>Finding ID</th><th>Type</th><th>POD</th><th>Amount</th><th>Risk</th><th>Aging (days)</th><th>Status</th>
      </tr></thead><tbody>${rows}</tbody></table>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const findingsByTypeRows = findingsByType.map((f) => ({
    id: f.key,
    name: f.label,
    value: f.count,
    color: f.color,
    displayValue: `${f.count} · ${formatCompactCurrency(f.amount)}`,
  }));

  const complianceRows = complianceByPod.map((p) => ({ id: p.id, name: p.name, value: p.value, color: complianceColor(p.value), displayValue: `${p.value}%` }));

  const highRiskRows = highRiskByPod.map((p) => ({ id: p.id, name: p.name, value: p.value, color: '#f0605f', displayValue: formatCompactCurrency(p.value) }));

  const agingRows = settlementAging.map((a) => ({ id: a.id, name: a.name, value: a.value, color: '#f7b955', displayValue: formatCompactCurrency(a.value) }));

  const pagination = usePagination(findings);

  const updateFindingInList = (updated: FindingRow) => {
    setFindings((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  };

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1 style={{ marginBottom: 2 }}>Audit Report Dashboard</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Risk-based review of expenses, settlement compliance, and audit exceptions</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <DatePicker value={draftFrom} onChange={setDraftFrom} style={{ width: 135 }} />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>to</span>
          <DatePicker value={draftTo} onChange={setDraftTo} style={{ width: 135 }} />
          <select value={draftDepartmentId} onChange={(e) => setDraftDepartmentId(e.target.value)} style={{ width: 140 }}>
            <option value="">All POD</option>
            {departmentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select value={draftRiskLevel} onChange={(e) => setDraftRiskLevel(e.target.value)} style={{ width: 140 }}>
            <option value="">All Risk Levels</option>
            {RISK_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {statusLabel(r)}
              </option>
            ))}
          </select>
          <select value={draftFindingType} onChange={(e) => setDraftFindingType(e.target.value)} style={{ width: 170 }}>
            <option value="">All Findings</option>
            {FINDING_TYPE_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={applyFilter}>
            Filter
          </button>
          {hasAppliedFilter && (
            <button className="btn" onClick={clearFilter}>
              Clear
            </button>
          )}
          <button className="btn btn-primary" onClick={exportReport} disabled={!summary}>
            Download Audit Report
          </button>
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}
      {loading && !summary ? (
        <div>Loading...</div>
      ) : summary ? (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Transactions Reviewed</div>
              <div className="value">{summary.transactionsReviewed.toLocaleString('id-ID')}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatCurrency(summary.transactionsReviewedAmount)}</div>
            </div>
            <div className="stat">
              <div className="label">Compliant Transactions</div>
              <div className="value" style={{ color: 'var(--success)' }}>
                {summary.compliantTransactions.toLocaleString('id-ID')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{summary.complianceRate}%</div>
            </div>
            <div className="stat">
              <div className="label">Audit Exceptions</div>
              <div className="value" style={{ color: 'var(--danger)' }}>
                {summary.auditExceptions}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatCurrency(summary.auditExceptionsAmount)}</div>
            </div>
            <div className="stat">
              <div className="label">High-Risk Findings</div>
              <div className="value" style={{ color: 'var(--danger)' }}>
                {summary.highRiskFindings}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatCurrency(summary.highRiskFindingsAmount)}</div>
            </div>
            <div className="stat">
              <div className="label">Outstanding Settlement</div>
              <div className="value" style={{ color: 'var(--warning)' }}>
                {formatCurrency(summary.outstandingSettlement)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{summary.outstandingSettlementCount} settlements</div>
            </div>
            <div className="stat">
              <div className="label">Documents Complete</div>
              <div className="value">{summary.documentsCompletePct}%</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <div className="card">
              <h3>Audit Findings by Type</h3>
              <RankedBarList data={findingsByTypeRows} />
            </div>
            <div className="card">
              <h3>Risk Level</h3>
              <DonutChart data={riskBreakdown} centerLabel="Audit Exceptions" formatValue={(v) => String(v)} />
            </div>
            <div className="card">
              <h3>Expense vs Settlement Audit Trend</h3>
              <AuditTrendChart data={trend} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <div className="card">
              <h3>Compliance Score by POD</h3>
              <RankedBarList data={complianceRows} />
            </div>
            <div className="card">
              <h3>High-Risk Exposure by POD</h3>
              <RankedBarList data={highRiskRows} />
            </div>
            <div className="card">
              <h3>Document Completeness</h3>
              <DonutChart data={documentCompleteness} centerLabel="Transactions" formatValue={(v) => String(v)} />
            </div>
            <div className="card">
              <h3>Settlement Aging</h3>
              <RankedBarList data={agingRows} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
            <div className="card">
              <h3>Director Attention</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {alerts.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: 'var(--surface-2)',
                      borderLeft: `3px solid var(--${a.level})`,
                    }}
                  >
                    <span style={{ color: `var(--${a.level})`, fontWeight: 700 }}>{a.level === 'danger' ? '⛔' : '⚠'}</span>
                    <span style={{ fontSize: 12.5 }}>{a.message}</span>
                  </div>
                ))}
                {alerts.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>No alerts for this period</div>}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
            <div className="card">
              <h3>Priority Audit Findings</h3>
              <table>
                <thead>
                  <tr>
                    <th>Finding ID</th>
                    <th>Expense / Settlement No.</th>
                    <th>POD / Submitter</th>
                    <th>Finding Type</th>
                    <th>Amount</th>
                    <th>Risk Level</th>
                    <th>Aging</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagination.pageRows.map((f) => (
                    <tr key={f.id}>
                      <td>{f.findingNo}</td>
                      <td>{f.subjectNo}</td>
                      <td>
                        {f.departmentName}
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{f.submitterName}</div>
                      </td>
                      <td>{f.findingLabel}</td>
                      <td>{formatCurrency(f.amount)}</td>
                      <td>
                        <span className={`badge ${riskBadgeClass(f.riskLevel)}`}>{statusLabel(f.riskLevel)}</span>
                      </td>
                      <td>{f.agingDays} Days</td>
                      <td>
                        <span className={`badge ${statusBadgeClass(f.status)}`}>{statusLabel(f.status)}</span>
                      </td>
                      <td>
                        <button type="button" className="btn" onClick={() => setReviewing(f)}>
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                  {findings.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ color: 'var(--muted)' }}>No data</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {findings.length > 0 && (
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  pageSize={pagination.pageSize}
                  onPageChange={pagination.setPage}
                  onPageSizeChange={pagination.setPageSize}
                  total={pagination.total}
                  rangeStart={pagination.rangeStart}
                  rangeEnd={pagination.rangeEnd}
                />
              )}
            </div>
          </div>
        </>
      ) : null}

      {reviewing && <FindingDetailModal finding={reviewing} onClose={() => setReviewing(null)} onUpdated={updateFindingInList} />}
    </div>
  );
}
