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

interface ActivityTypeOption {
  id: string;
  name: string;
}

interface UnitOption {
  id: string;
  code: string;
  name: string;
  revenueSharePercent: string | null;
}

interface CreditCardOption {
  id: string;
  bank: string;
  last4: string;
  user: { id: string; name: string } | null;
}

// One row of the Settlement Allocation section below the Expense list - fixed
// one row per Unit (RCTI/MNCTV/GTV), Unit/Product are readonly. Total is
// computed client-side just for display; the server always recomputes it from
// the picked Expenses' total * percentage (never trusts this back).
// autoDescription tracks the last machine-generated description so edits to
// Department/dates/card below can keep refreshing it, right up until the user
// types their own - description !== autoDescription then means "hands off".
interface AllocationRow {
  key: string;
  unitId: string;
  unitCode: string;
  percentage: string;
  description: string;
  autoDescription: string;
  qty: string;
  curr: string;
}

// RE101 product code per Unit (BRD mapping) - shown readonly next to the Unit.
const PRODUCT_BY_UNIT_CODE: Record<string, string> = {
  RCTI: 'RE101-04.001',
  MNCTV: 'RE101-05.002',
  GTV: 'RE101-05.003',
};

function AllocFieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <label style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</label>
      {children}
    </div>
  );
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
    qty: string;
    curr: string;
    unit: { id: string; code: string };
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
  const [activityTypeOptions, setActivityTypeOptions] = useState<ActivityTypeOption[]>([]);
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([]);
  const [creditCardOptions, setCreditCardOptions] = useState<CreditCardOption[]>([]);

  const [genActivityTypeIds, setGenActivityTypeIds] = useState<string[]>([]);
  const [genDepartmentId, setGenDepartmentId] = useState('');
  const [genFromDate, setGenFromDate] = useState(defaultFromDate);
  const [genToDate, setGenToDate] = useState(defaultToDate);
  const [genPaymentMethodGroup, setGenPaymentMethodGroup] = useState<'CORPORATE_CARD' | 'NON_CORPORATE_CARD' | ''>('');
  const [genCreditCardId, setGenCreditCardId] = useState('');
  const [searching, setSearching] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);
  const [creatingSettlement, setCreatingSettlement] = useState(false);
  const [allocationRows, setAllocationRows] = useState<AllocationRow[]>([]);

  // Parcel/Bingkisan Expenses aren't owned by one Department (sent org-wide),
  // so picking only that Activity Type widens the Department combobox to all
  // Departments even for a non-ADMINISTRATOR user who'd otherwise only see
  // their own (/departments/me).
  const isParcelOnly =
    genActivityTypeIds.length === 1 && activityTypeOptions.find((a) => a.id === genActivityTypeIds[0])?.name === 'Parcel/Bingkisan';

  useEffect(() => {
    const path = canManage || isParcelOnly ? '/departments?active=true' : '/departments/me';
    api.get<DepartmentOption[]>(path).then(setDepartmentOptions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, isParcelOnly]);

  useEffect(() => {
    api.get<ActivityTypeOption[]>('/activity-types?active=true').then(setActivityTypeOptions).catch(() => undefined);
  }, []);

  const toggleActivityType = (id: string) =>
    setGenActivityTypeIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));

  useEffect(() => {
    api.get<UnitOption[]>('/units?active=true').then(setUnitOptions).catch(() => undefined);
  }, []);

  // Corporate Card options for the picked Department - a Department can hold more
  // than one card, so this narrows generate()/createFromSelection() to one of them.
  useEffect(() => {
    setGenCreditCardId('');
    if (!genDepartmentId || genPaymentMethodGroup !== 'CORPORATE_CARD') {
      setCreditCardOptions([]);
      return;
    }
    api
      .get<CreditCardOption[]>(`/credit-cards?departmentId=${genDepartmentId}&active=true`)
      .then(setCreditCardOptions)
      .catch(() => setCreditCardOptions([]));
  }, [genDepartmentId, genPaymentMethodGroup]);

  // Sum of the Expenses the user has checked in the preview table - what each
  // allocation row's Original/Unit/Total Price is a percentage of. Recomputed
  // server-side too (SettlementsService.buildAllocationRow) - this is only for
  // this page's live preview.
  const selectedExpensesTotal = (previewResult?.expenses ?? [])
    .filter((e) => selectedExpenseIds.has(e.id))
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const updateAllocationRow = (key: string, patch: Partial<AllocationRow>) =>
    setAllocationRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // One fixed row per Unit - Unit/Product are readonly, so there's nothing to
  // pick: the 3 rows always exist once an Expense is checked.
  const PRESET_UNIT_CODES = ['RCTI', 'MNCTV', 'GTV'];

  // Default description template, dates as DD-MMM-YYYY:
  //   Corporate Card:     "[CREDIT CARD] [****-{last4}] [{DEPT NAME}] [{DATE_FROM} - {DATE_TO}] ({UNIT_NAME} {persentase}%)"
  //   Non Corporate Card: "[NON CREDIT CARD] [{DEPT NAME}] [{DATE_FROM} - {DATE_TO}] ({UNIT_NAME} {persentase}%)"
  const buildAllocationDescription = (unitCode: string, percentage: string) => {
    const deptName = (departmentOptions.find((d) => d.id === genDepartmentId)?.name ?? existing?.department.name ?? '').toUpperCase();
    const isCard = genPaymentMethodGroup === 'CORPORATE_CARD';
    const last4 = creditCardOptions.find((c) => c.id === genCreditCardId)?.last4 ?? 'NULL';
    // YYYY-MM-DD (date input value) -> DD-MMM-YYYY, by string split so no timezone shift.
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const ddMmmYyyy = (d: string) => {
      const [y, m, day] = d.slice(0, 10).split('-');
      return y && m && day ? `${day}-${MONTHS[Number(m) - 1] ?? m}-${y}` : '';
    };
    const unitName = unitOptions.find((u) => u.code === unitCode)?.name ?? unitCode;
    const pct = Number(percentage) || 0;
    const head = isCard ? `[CREDIT CARD] [****-${last4}]` : '[NON CREDIT CARD]';
    return `${head} [${deptName}] [${ddMmmYyyy(genFromDate)} - ${ddMmmYyyy(genToDate)}] (${unitName} ${pct}%)`;
  };

  // "Settlement Allocation langsung muncul": one row per Unit, auto-built the
  // moment the first Expense gets checked (not a manual "Generate" step).
  const generateAllocationRows = () => {
    setAllocationRows(
      PRESET_UNIT_CODES.map((code) => {
        const unit = unitOptions.find((u) => u.code === code);
        const percentage = unit?.revenueSharePercent ?? '';
        const description = buildAllocationDescription(code, percentage);
        return {
          key: Math.random().toString(36).slice(2),
          unitId: unit?.id ?? '',
          unitCode: code,
          percentage,
          description,
          autoDescription: description,
          qty: '1',
          curr: 'IDR',
        };
      }),
    );
  };

  useEffect(() => {
    if (isEdit) return;
    if (selectedExpenseIds.size === 0) return;
    if (allocationRows.length > 0) return;
    if (unitOptions.length === 0) return;
    generateAllocationRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExpenseIds, unitOptions, isEdit]);

  // Keeps each row's description in sync with its template inputs - but only
  // while the row still holds its last machine-generated text; once the user
  // types their own description, it's left alone.
  useEffect(() => {
    setAllocationRows((prev) =>
      prev.map((r) => {
        if (r.description !== r.autoDescription) return r;
        const nextDescription = buildAllocationDescription(r.unitCode, r.percentage);
        return { ...r, description: nextDescription, autoDescription: nextDescription };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genPaymentMethodGroup, genCreditCardId, genDepartmentId, genFromDate, genToDate, departmentOptions, creditCardOptions]);

  // Percentage edits feed straight back into the description template too
  // (the "(UNIT %)" tail), as long as the description is still auto-generated.
  const updateAllocationPercentage = (key: string, percentage: string) =>
    setAllocationRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (r.description !== r.autoDescription) return { ...r, percentage };
        const nextDescription = buildAllocationDescription(r.unitCode, percentage);
        return { ...r, percentage, description: nextDescription, autoDescription: nextDescription };
      }),
    );

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
        if (s.status !== 'DRAFT_SETTLEMENT' && s.status !== 'REVISION') {
          setGenerateError('Only a draft or revision-pending settlement can be edited.');
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
            unitCode: a.unit.code,
            percentage: String(Number(a.percentage)),
            description: a.description ?? '',
            // Sentinel that can never equal the saved description, so the
            // auto-refresh effect never silently overwrites an existing row.
            autoDescription: '\0',
            qty: String(Number(a.qty)),
            curr: a.curr,
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
    creditCardId?: string,
    activityTypeIds?: string[],
  ) => {
    setSearching(true);
    setGenerateError('');
    setShowDuplicateConfirm(false);
    try {
      const result = await api.post<PreviewResult>('/settlements/generate', {
        departmentId,
        fromDate,
        toDate,
        paymentMethodGroup,
        creditCardId: paymentMethodGroup === 'CORPORATE_CARD' ? creditCardId || undefined : undefined,
        activityTypeIds: activityTypeIds && activityTypeIds.length > 0 ? activityTypeIds : undefined,
      });
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
    await runSearch(existing, genDepartmentId, genFromDate, genToDate, genPaymentMethodGroup, genCreditCardId, genActivityTypeIds);
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
        account: PRODUCT_BY_UNIT_CODE[r.unitCode],
        qty: r.qty ? Number(r.qty) : undefined,
        curr: r.curr || undefined,
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
        creditCardId: genPaymentMethodGroup === 'CORPORATE_CARD' ? genCreditCardId || undefined : undefined,
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px 16px' }}>
          <div className="form-row">
            <label>Activity Type (optional — blank = any activity type)</label>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px 16px',
                maxHeight: 80,
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 8,
              }}
            >
              {activityTypeOptions.map((a) => (
                <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    disabled={isEdit}
                    checked={genActivityTypeIds.includes(a.id)}
                    onChange={() => toggleActivityType(a.id)}
                  />
                  {a.name}
                </label>
              ))}
            </div>
          </div>
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
          {genPaymentMethodGroup === 'CORPORATE_CARD' && (
            <div className="form-row">
              <label>Corporate Card</label>
              <select value={genCreditCardId} disabled={isEdit || !genDepartmentId} onChange={(e) => setGenCreditCardId(e.target.value)}>
                <option value="">{genDepartmentId ? 'All Corporate Cards' : 'Select a Department first'}</option>
                {creditCardOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.bank} •••• {c.last4} ({c.user?.name ?? '-'})
                  </option>
                ))}
              </select>
            </div>
          )}
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
                  <strong style={{ fontSize: 12 }}>Settlement Allocation</strong>
                  {allocationRows.map((row) => {
                    const amount = allocationAmount(row);
                    return (
                      <div
                        key={row.key}
                        style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginTop: 8 }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
                          <AllocFieldLabel label="Product">
                            <input type="text" disabled value={PRODUCT_BY_UNIT_CODE[row.unitCode] ?? '-'} style={{ width: '100%' }} />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Unit">
                            <input type="text" disabled value={row.unitCode} style={{ width: '100%' }} />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Persentase (%)">
                            <NumberInput
                              allowDecimals
                              style={{ width: '100%' }}
                              value={row.percentage}
                              onChange={(v) => updateAllocationPercentage(row.key, v)}
                            />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Currency">
                            <input
                              type="text"
                              style={{ width: '100%' }}
                              value={row.curr}
                              onChange={(e) => updateAllocationRow(row.key, { curr: e.target.value })}
                            />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Quantity">
                            <NumberInput
                              allowDecimals
                              style={{ width: '100%' }}
                              value={row.qty}
                              onChange={(v) => updateAllocationRow(row.key, { qty: v })}
                            />
                          </AllocFieldLabel>
                          <AllocFieldLabel label="Total">
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
                      </div>
                    );
                  })}
                </div>
                )}

                {isEdit ? (
                  <button
                    className="btn btn-primary"
                    disabled={
                      creatingSettlement ||
                      selectedExpenseIds.size === 0 ||
                      (existing?.status !== 'DRAFT_SETTLEMENT' && existing?.status !== 'REVISION')
                    }
                    style={{ marginTop: 12 }}
                    onClick={saveChanges}
                  >
                    {creatingSettlement
                      ? 'Saving...'
                      : existing?.status === 'REVISION'
                      ? `Resubmit (${selectedExpenseIds.size})`
                      : `Save Changes (${selectedExpenseIds.size})`}
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
