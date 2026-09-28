'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date';
import DatePicker from '@/components/DatePicker';
import NumberInput from '@/components/NumberInput';

interface DepartmentOption {
  id: string;
  name: string;
}

interface UnitOption {
  id: string;
  code: string;
  name: string;
  revenueSharePercent: string | null;
}

// One row of the Unit/Persentase/... section below the Expense list -
// Original Price/Unit Price/Total Price are computed client-side just for
// display; the server always recomputes them from the picked Expenses'
// total * percentage (never trusts these back).
interface AllocationRow {
  key: string;
  unitId: string;
  percentage: string;
  description: string;
  analyticAcc: string;
  account: string;
  wilayah: string;
  linePr: string;
  qty: string;
  curr: string;
  rate: string;
}

function AllocFieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <label style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</label>
      {children}
    </div>
  );
}

function emptyAllocationRow(): AllocationRow {
  return {
    key: Math.random().toString(36).slice(2),
    unitId: '',
    percentage: '',
    description: '',
    analyticAcc: '',
    account: '',
    wilayah: '',
    linePr: '',
    qty: '1',
    curr: 'IDR',
    rate: '1',
  };
}

interface GeneratedExpenseRow {
  id: string;
  expenseNo: string;
  expenseDate: string;
  purpose: string;
  amount: string;
  status: string;
  sales: { name: string };
}

interface PreviewResult {
  expenses: GeneratedExpenseRow[];
  existingDraftSettlement: { id: string; settlementNo: string } | null;
}

function formatCurrency(value: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));
}

const defaultFromDate = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};
const defaultToDate = () => new Date().toISOString().slice(0, 10);

// Existing DRAFT_SETTLEMENT as returned by GET /settlements/:id - prefills the form in edit mode.
interface ExistingSettlement {
  id: string;
  settlementNo: string;
  status: string;
  department: { id: string; name: string };
  expenses: (GeneratedExpenseRow & { paymentMethod?: { code: string } | null })[];
  allocations: {
    percentage: string;
    description: string | null;
    analyticAcc: string | null;
    account: string | null;
    wilayah: string | null;
    linePr: string | null;
    qty: string;
    curr: string;
    rate: string;
    unit: { id: string };
  }[];
}

// Shared by "Create Settlement" (no settlementId) and the Settlement list's
// "Edit" on a DRAFT_SETTLEMENT (settlementId set: fields prefilled from that
// settlement, Save Changes PATCHes it instead of creating a new one).
export default function SettlementForm({ settlementId }: { settlementId?: string } = {}) {
  const router = useRouter();
  const { hasRole } = useAuth();
  const canManage = hasRole('ADMINISTRATOR');
  const isEdit = !!settlementId;
  const [existing, setExisting] = useState<ExistingSettlement | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(isEdit);

  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([]);

  const [genDepartmentId, setGenDepartmentId] = useState('');
  const [genFromDate, setGenFromDate] = useState(defaultFromDate);
  const [genToDate, setGenToDate] = useState(defaultToDate);
  const [genPaymentMethodGroup, setGenPaymentMethodGroup] = useState<'CORPORATE_CARD' | 'NON_CORPORATE_CARD' | ''>('');
  const [searching, setSearching] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);
  const [creatingSettlement, setCreatingSettlement] = useState(false);
  const [allocationRows, setAllocationRows] = useState<AllocationRow[]>([]);

  useEffect(() => {
    const path = canManage ? '/departments?active=true' : '/departments/me';
    api.get<DepartmentOption[]>(path).then(setDepartmentOptions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  useEffect(() => {
    api.get<UnitOption[]>('/units?active=true').then(setUnitOptions).catch(() => undefined);
  }, []);

  // Sum of the Expenses the user has checked in the preview table - what each
  // allocation row's Original/Unit/Total Price is a percentage of. Recomputed
  // server-side too (SettlementsService.buildAllocationRow) - this is only for
  // this page's live preview.
  const selectedExpensesTotal = (previewResult?.expenses ?? [])
    .filter((e) => selectedExpenseIds.has(e.id))
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const updateAllocationRow = (key: string, patch: Partial<AllocationRow>) =>
    setAllocationRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // "Generate Allocation": replaces manual row-adding with 4 preset rows, one
  // per Unit (RCTI/MNCTV/GTV/INEWS), each prefilled with that Unit's default
  // Settlement % from Units master data - still freely editable afterwards.
  const PRESET_UNIT_CODES = ['RCTI', 'MNCTV', 'GTV', 'INEWS'];
  const generateAllocationRows = () => {
    setAllocationRows(
      PRESET_UNIT_CODES.map((code) => {
        const unit = unitOptions.find((u) => u.code === code);
        return { ...emptyAllocationRow(), unitId: unit?.id ?? '', percentage: unit?.revenueSharePercent ?? '' };
      }),
    );
  };

  const removeAllocationRow = (key: string) => setAllocationRows((prev) => prev.filter((r) => r.key !== key));

  // Picking a Unit prefills that Unit's default Settlement % (Units master data,
  // e.g. RCTI 48%) - still freely editable afterwards.
  const selectAllocationUnit = (key: string, unitId: string) => {
    const unit = unitOptions.find((u) => u.id === unitId);
    updateAllocationRow(key, { unitId, percentage: unit?.revenueSharePercent ?? '' });
  };

  const allocationAmount = (row: AllocationRow) => (selectedExpensesTotal * (Number(row.percentage) || 0)) / 100;

  // Edit mode: load the draft settlement once and prefill every field from it -
  // Department/payment group (fixed), a date range widened to cover its
  // members, the member Expenses (pre-checked) and its allocation rows.
  useEffect(() => {
    if (!settlementId) return;
    api
      .get<ExistingSettlement>(`/settlements/${settlementId}`)
      .then((s) => {
        setExisting(s);
        if (s.status !== 'DRAFT_SETTLEMENT') {
          setGenerateError('Only a draft settlement can be edited.');
          return;
        }
        const group = s.expenses[0]?.paymentMethod?.code === 'CORPORATE_CARD' ? 'CORPORATE_CARD' : 'NON_CORPORATE_CARD';
        const dates = s.expenses.map((e) => e.expenseDate.slice(0, 10)).sort();
        const from = dates.length > 0 && dates[0] < defaultFromDate() ? dates[0] : defaultFromDate();
        const to = dates.length > 0 && dates[dates.length - 1] > defaultToDate() ? dates[dates.length - 1] : defaultToDate();
        setGenDepartmentId(s.department.id);
        setGenPaymentMethodGroup(group);
        setGenFromDate(from);
        setGenToDate(to);
        setSelectedExpenseIds(new Set(s.expenses.map((e) => e.id)));
        setAllocationRows(
          s.allocations.map((a) => ({
            key: Math.random().toString(36).slice(2),
            unitId: a.unit.id,
            percentage: String(Number(a.percentage)),
            description: a.description ?? '',
            analyticAcc: a.analyticAcc ?? '',
            account: a.account ?? '',
            wilayah: a.wilayah ?? '',
            linePr: a.linePr ?? '',
            qty: String(Number(a.qty)),
            curr: a.curr,
            rate: String(Number(a.rate)),
          })),
        );
        return runSearch(s, s.department.id, from, to, group);
      })
      .catch((err) => setGenerateError(err instanceof ApiError ? err.message : 'Failed to load settlement'))
      .finally(() => setLoadingExisting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlementId]);

  // Search step: scopes the search to one Department + one date range
  // (instead of grabbing every eligible Department at once) and lists the
  // matching, already bank-matched Expenses for review/checklisting - nothing
  // is pre-checked, the user picks which ones to include. Nothing is created
  // yet - the backend bundles in whether a DRAFT settlement already covers
  // this exact Department/date range too, which the Generate Settlement step
  // below uses to decide whether to prompt before committing anything.
  // In edit mode the settlement's own members are always kept in the list (and
  // keep their checked state), with newly found eligible Expenses added after.
  const runSearch = async (
    current: ExistingSettlement | null,
    departmentId: string,
    fromDate: string,
    toDate: string,
    paymentMethodGroup: 'CORPORATE_CARD' | 'NON_CORPORATE_CARD',
  ) => {
    setSearching(true);
    setGenerateError('');
    setShowDuplicateConfirm(false);
    try {
      const result = await api.post<PreviewResult>('/settlements/generate', { departmentId, fromDate, toDate, paymentMethodGroup });
      if (current) {
        const memberIds = new Set(current.expenses.map((e) => e.id));
        const merged = [...current.expenses, ...result.expenses.filter((e) => !memberIds.has(e.id))].sort((a, b) =>
          a.expenseDate.localeCompare(b.expenseDate),
        );
        setPreviewResult({ expenses: merged, existingDraftSettlement: null });
      } else {
        setPreviewResult(result);
        setSelectedExpenseIds(new Set());
      }
    } catch (err) {
      setGenerateError(err instanceof ApiError ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const searchExpenses = async () => {
    if (!genDepartmentId) {
      setGenerateError('Pilih Department terlebih dahulu.');
      return;
    }
    if (!genPaymentMethodGroup) {
      setGenerateError('Pilih Metode Pembayaran terlebih dahulu.');
      return;
    }
    await runSearch(existing, genDepartmentId, genFromDate, genToDate, genPaymentMethodGroup);
  };

  const toggleSelectedExpense = (id: string) =>
    setSelectedExpenseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Generate Settlement step: first checks whether a DRAFT settlement already
  // covers this exact Department/date-range search (returned alongside the
  // search results) - if so, ask Yes/No before committing anything;
  // otherwise there's nothing to conflict with, so create the new settlement
  // straight away.
  const handleGenerateSettlement = () => {
    if (selectedExpenseIds.size === 0) return;
    if (previewResult?.existingDraftSettlement) {
      setShowDuplicateConfirm(true);
      return;
    }
    createNewSettlement();
  };

  const buildAllocationPayload = () =>
    allocationRows
      .filter((r) => r.unitId)
      .map((r) => ({
        unitId: r.unitId,
        percentage: Number(r.percentage) || 0,
        description: r.description || undefined,
        analyticAcc: r.analyticAcc || undefined,
        account: r.account || undefined,
        wilayah: r.wilayah || undefined,
        linePr: r.linePr || undefined,
        qty: r.qty ? Number(r.qty) : undefined,
        curr: r.curr || undefined,
        rate: r.rate ? Number(r.rate) : undefined,
      }));

  // Edit mode's "Save Changes" - replaces the draft's Expenses + allocations.
  const saveChanges = async () => {
    if (!settlementId || selectedExpenseIds.size === 0) return;
    setCreatingSettlement(true);
    setGenerateError('');
    try {
      await api.patch(`/settlements/${settlementId}`, {
        expenseIds: Array.from(selectedExpenseIds),
        allocations: buildAllocationPayload(),
      });
      router.push('/settlement');
    } catch (err) {
      setGenerateError(err instanceof ApiError ? err.message : 'Failed to save settlement');
    } finally {
      setCreatingSettlement(false);
    }
  };

  // Also doubles as "No" on the duplicate-settlement prompt.
  const createNewSettlement = async () => {
    setCreatingSettlement(true);
    setGenerateError('');
    try {
      await api.post('/settlements/from-selection', {
        departmentId: genDepartmentId,
        expenseIds: Array.from(selectedExpenseIds),
        paymentMethodGroup: genPaymentMethodGroup,
        allocations: buildAllocationPayload(),
      });
      router.push('/settlement');
    } catch (err) {
      setGenerateError(err instanceof ApiError ? err.message : 'Failed to create settlement');
    } finally {
      setCreatingSettlement(false);
    }
  };

  // "Yes" on the duplicate-settlement prompt.
  const addSelectionToExisting = async () => {
    if (!previewResult?.existingDraftSettlement) return;
    setCreatingSettlement(true);
    setGenerateError('');
    try {
      await api.post(`/settlements/${previewResult.existingDraftSettlement.id}/expenses`, { expenseIds: Array.from(selectedExpenseIds) });
      router.push('/settlement');
    } catch (err) {
      setGenerateError(err instanceof ApiError ? err.message : 'Failed to add expenses');
    } finally {
      setCreatingSettlement(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/settlement" className="btn" title="Back to Settlement">
            ← Back
          </Link>
          <h1 style={{ margin: 0 }}>{isEdit ? `Edit Settlement${existing ? ` ${existing.settlementNo}` : ''}` : 'Create Settlement'}</h1>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: -8, fontSize: 12 }}>
        {isEdit
          ? 'Department and Metode Pembayaran are fixed. Widen the date range and click Search to find more Expenses, check/uncheck the ones to include, adjust the allocation, then click Save Changes.'
          : 'Pick a Department and date range, click Search to list its already bank-matched Expenses, check the ones to include, then click Generate Settlement - each Expense is then approved per its Approval Level from inside the Settlement list.'}
      </p>
      {loadingExisting && <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading settlement...</p>}

      <div>
        <div className="form-grid">
          <div className="form-row">
            <label>Department</label>
            <select value={genDepartmentId} disabled={isEdit} onChange={(e) => setGenDepartmentId(e.target.value)}>
              <option value="">Select Department</option>
              {departmentOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>From</label>
            <DatePicker value={genFromDate} onChange={setGenFromDate} />
          </div>
          <div className="form-row">
            <label>To</label>
            <DatePicker value={genToDate} onChange={setGenToDate} />
          </div>
          <div className="form-row">
            <label>Metode Pembayaran</label>
            <select
              value={genPaymentMethodGroup}
              disabled={isEdit}
              onChange={(e) => setGenPaymentMethodGroup(e.target.value as 'CORPORATE_CARD' | 'NON_CORPORATE_CARD' | '')}
            >
              <option value="">Select Metode Pembayaran</option>
              <option value="CORPORATE_CARD">Corporate Card</option>
              <option value="NON_CORPORATE_CARD">Non Corporate Card</option>
            </select>
          </div>
        </div>

        {generateError && <div className="error-text">{generateError}</div>}

        <button className="btn btn-primary" disabled={searching || loadingExisting} style={{ marginTop: 12 }} onClick={searchExpenses}>
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {previewResult && (
        <div className="card" style={{ marginTop: 20 }}>
            {previewResult.expenses.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                Tidak ada expense yang cocok (Department/tanggal/sudah matched) untuk dibuatkan settlement.
              </p>
            ) : (
              <>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 28 }}>
                        <input
                          type="checkbox"
                          style={{ width: 'auto' }}
                          checked={selectedExpenseIds.size === previewResult.expenses.length}
                          onChange={(e) =>
                            setSelectedExpenseIds(e.target.checked ? new Set(previewResult.expenses.map((x) => x.id)) : new Set())
                          }
                        />
                      </th>
                      <th>Expense No</th>
                      <th>Date</th>
                      <th>Sales</th>
                      <th>Purpose</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewResult.expenses.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <input
                            type="checkbox"
                            style={{ width: 'auto' }}
                            checked={selectedExpenseIds.has(e.id)}
                            onChange={() => toggleSelectedExpense(e.id)}
                          />
                        </td>
                        <td>
                          <Link href={`/expenses/${e.id}`}>{e.expenseNo}</Link>
                        </td>
                        <td>{formatDate(e.expenseDate)}</td>
                        <td>{e.sales?.name}</td>
                        <td>{e.purpose}</td>
                        <td>{formatCurrency(e.amount)}</td>
                        <td>
                          <span className={`badge ${e.status === 'APPROVED' ? 'badge-success' : 'badge-info'}`}>{e.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {selectedExpenseIds.size > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 12 }}>Settlement Allocation</strong>
                    <button type="button" className="btn" onClick={generateAllocationRows}>
                      Generate Allocation
                    </button>
                  </div>
                  {allocationRows.map((row) => {
                    const amount = allocationAmount(row);
                    return (
                      <div
                        key={row.key}
                        style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginTop: 8 }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
                          <AllocFieldLabel label="Settlement No">
                            <input type="text" value="(auto)" disabled style={{ width: '100%', color: 'var(--muted)' }} />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Unit">
                            <select
                              style={{ width: '100%' }}
                              value={row.unitId}
                              onChange={(e) => selectAllocationUnit(row.key, e.target.value)}
                            >
                              <option value="">Select</option>
                              {unitOptions.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.code}
                                </option>
                              ))}
                            </select>
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Persentase (%)">
                            <NumberInput
                              allowDecimals
                              style={{ width: '100%' }}
                              value={row.percentage}
                              onChange={(v) => updateAllocationRow(row.key, { percentage: v })}
                            />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Analytic Acc">
                            <input
                              type="text"
                              style={{ width: '100%' }}
                              value={row.analyticAcc}
                              onChange={(e) => updateAllocationRow(row.key, { analyticAcc: e.target.value })}
                            />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Account">
                            <input
                              type="text"
                              style={{ width: '100%' }}
                              value={row.account}
                              onChange={(e) => updateAllocationRow(row.key, { account: e.target.value })}
                            />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Wilayah">
                            <input
                              type="text"
                              style={{ width: '100%' }}
                              value={row.wilayah}
                              onChange={(e) => updateAllocationRow(row.key, { wilayah: e.target.value })}
                            />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Line PR">
                            <input
                              type="text"
                              style={{ width: '100%' }}
                              value={row.linePr}
                              onChange={(e) => updateAllocationRow(row.key, { linePr: e.target.value })}
                            />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Qty">
                            <NumberInput
                              allowDecimals
                              style={{ width: '100%' }}
                              value={row.qty}
                              onChange={(v) => updateAllocationRow(row.key, { qty: v })}
                            />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Curr">
                            <input
                              type="text"
                              style={{ width: '100%' }}
                              value={row.curr}
                              onChange={(e) => updateAllocationRow(row.key, { curr: e.target.value })}
                            />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Original Price">
                            <input type="text" disabled value={formatCurrency(amount)} style={{ width: '100%' }} />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Rate">
                            <NumberInput
                              allowDecimals
                              style={{ width: '100%' }}
                              value={row.rate}
                              onChange={(v) => updateAllocationRow(row.key, { rate: v })}
                            />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Unit Price">
                            <input type="text" disabled value={formatCurrency(amount)} style={{ width: '100%' }} />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Total Price (IDR)">
                            <input type="text" disabled value={formatCurrency(amount)} style={{ width: '100%' }} />
                          </AllocFieldLabel>
                        </div>

                        <div style={{ marginTop: 8 }}>
                          <AllocFieldLabel label="Description">
                            <textarea
                              rows={3}
                              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
                              value={row.description}
                              onChange={(e) => updateAllocationRow(row.key, { description: e.target.value })}
                            />
                          </AllocFieldLabel>
                        </div>

                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ marginTop: 8 }}
                          onClick={() => removeAllocationRow(row.key)}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
                )}

                {isEdit ? (
                  <button
                    className="btn btn-primary"
                    disabled={creatingSettlement || selectedExpenseIds.size === 0 || existing?.status !== 'DRAFT_SETTLEMENT'}
                    style={{ marginTop: 12 }}
                    onClick={saveChanges}
                  >
                    {creatingSettlement ? 'Saving...' : `Save Changes (${selectedExpenseIds.size})`}
                  </button>
                ) : showDuplicateConfirm && previewResult.existingDraftSettlement ? (
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 6, background: 'var(--input-bg)' }}>
                    <p style={{ fontSize: 13, marginTop: 0 }}>
                      Settlement sudah ada ({previewResult.existingDraftSettlement.settlementNo}). Apakah anda ingin menambahkan ke
                      settlement yang sudah ada atau buat settlement baru?
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary" disabled={creatingSettlement} onClick={addSelectionToExisting}>
                        Yes
                      </button>
                      <button className="btn" disabled={creatingSettlement} onClick={createNewSettlement}>
                        No
                      </button>
                    </div>
                  </div>
                ) : (
                  selectedExpenseIds.size > 0 && (
                    <button
                      className="btn btn-primary"
                      disabled={creatingSettlement}
                      style={{ marginTop: 12 }}
                      onClick={handleGenerateSettlement}
                    >
                      {creatingSettlement ? 'Generating...' : `Generate Settlement (${selectedExpenseIds.size})`}
                    </button>
                  )
                )}
              </>
            )}
          </div>
        )}
    </div>
  );
}
