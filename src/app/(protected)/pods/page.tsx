'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';

interface Option {
  id: string;
  name: string;
}

interface SalesOption extends Option {
  employeeId: string;
  roles: string[];
}

interface AdvertiserOption extends Option {
  agencyId: string;
}

interface PodAssignment {
  id: string;
  agency: Option;
  brand: Option & { advertiser: Option };
}

interface PodApprover {
  id: string;
  position: Option;
  user: { id: string; name: string; employeeId: string };
}

interface PodMemberRow {
  id: string;
  sales: { id: string; name: string; employeeId: string };
}

interface PodListItem {
  id: string;
  name: string;
  isActive: boolean;
  members: PodMemberRow[];
  assignments: PodAssignment[];
  approvers: PodApprover[];
}

interface StagedPair {
  agencyId: string;
  agencyName: string;
  brandId: string;
  brandName: string;
}

const nameCollator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });

// POD membership isn't just for role SALES - Supervisor and Sales Admin also cover a POD.
// Role names are free text (custom roles), so match loosely instead of an exact enum check.
function isMemberEligibleRole(role: string) {
  const r = role.toUpperCase();
  return r === 'SALES' || r === 'SUPERVISOR' || /SALES.?ADMIN/.test(r);
}

const MAX_VISIBLE = 5;

// Comma-joined list capped at MAX_VISIBLE items, with a "Selengkapnya" /
// "Sembunyikan" toggle to show/hide the rest.
function TruncatedList({ items }: { items: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return <span style={{ color: 'var(--muted)' }}>-</span>;
  const visible = expanded ? items : items.slice(0, MAX_VISIBLE);
  return (
    <span>
      {visible.join(', ')}
      {items.length > MAX_VISIBLE && (
        <>
          {' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setExpanded((v) => !v);
            }}
            style={{ fontSize: 12, whiteSpace: 'nowrap' }}
          >
            {expanded ? 'Sembunyikan' : 'Selengkapnya'}
          </a>
        </>
      )}
    </span>
  );
}

// POD (BRD section 6.2): a named coverage group covering one or more Sales
// (many-to-many via PodMember), each covering multiple Agency -> Brand pairs.
// A Brand can only appear once per POD, but one Agency can cover many Brands
// (pick Agency -> pick its Advertisers -> pick their Brands).
export default function PodsPage() {
  const [pods, setPods] = useState<PodListItem[]>([]);
  const [salesOptions, setSalesOptions] = useState<SalesOption[]>([]);
  const [allUsers, setAllUsers] = useState<SalesOption[]>([]);
  const [agencies, setAgencies] = useState<Option[]>([]);
  const [advertisers, setAdvertisers] = useState<AdvertiserOption[]>([]);
  const [positions, setPositions] = useState<Option[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [selectedSalesIds, setSelectedSalesIds] = useState<string[]>([]);
  const [salesFilter, setSalesFilter] = useState('');

  // Cascading Agency -> Advertiser -> Brand picker (staging area for the create form)
  const [pickerAgencyId, setPickerAgencyId] = useState('');
  const [pickerAdvertiserIds, setPickerAdvertiserIds] = useState<string[]>([]);
  const [pickerBrands, setPickerBrands] = useState<Option[]>([]);
  const [pickerBrandIds, setPickerBrandIds] = useState<string[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [stagedPairs, setStagedPairs] = useState<StagedPair[]>([]);

  const [selectedPodId, setSelectedPodId] = useState('');
  const [busy, setBusy] = useState(false);
  const manageCardRef = useRef<HTMLDivElement>(null);

  const editPod = (id: string) => {
    setSelectedPodId(id);
    manageCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const pagination = usePagination(pods);

  const load = () => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    api
      .get<PodListItem[]>(`/pods${qs}`)
      .then((res) => setPods([...res].sort((a, b) => nameCollator.compare(a.name, b.name))))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  useEffect(load, [search]);

  useEffect(() => {
    api.get<SalesOption[]>('/users').then((users) => {
      setSalesOptions(users.filter((u) => u.roles.some(isMemberEligibleRole)));
      setAllUsers(users);
    }).catch(() => undefined);
    api.get<Option[]>('/agencies').then(setAgencies).catch(() => undefined);
    api.get<AdvertiserOption[]>('/advertisers').then(setAdvertisers).catch(() => undefined);
    api.get<Option[]>('/positions').then(setPositions).catch(() => undefined);
  }, []);

  // Fetch Brands scoped to the selected Advertisers whenever that set changes.
  useEffect(() => {
    if (pickerAdvertiserIds.length === 0) {
      setPickerBrands([]);
      return;
    }
    setPickerLoading(true);
    api
      .get<Option[]>(`/brands?advertiserIds=${pickerAdvertiserIds.join(',')}`)
      .then(setPickerBrands)
      .catch(() => setPickerBrands([]))
      .finally(() => setPickerLoading(false));
  }, [pickerAdvertiserIds]);

  const resetForm = () => {
    setName('');
    setSelectedSalesIds([]);
    setSalesFilter('');
    setPickerAgencyId('');
    setPickerAdvertiserIds([]);
    setPickerBrandIds([]);
    setPickerBrands([]);
    setStagedPairs([]);
  };

  const toggleSales = (id: string) =>
    setSelectedSalesIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const advertisersForPickerAgency = advertisers.filter((a) => a.agencyId === pickerAgencyId);

  const onPickAgency = (agencyId: string) => {
    setPickerAgencyId(agencyId);
    setPickerAdvertiserIds([]);
    setPickerBrandIds([]);
    setPickerBrands([]);
  };

  const toggleAdvertiser = (id: string) =>
    setPickerAdvertiserIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));

  const toggleBrand = (id: string) =>
    setPickerBrandIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));

  const addStagedPairs = () => {
    const agency = agencies.find((a) => a.id === pickerAgencyId);
    if (!agency) return;
    const alreadyStaged = new Set(stagedPairs.map((p) => p.brandId));
    const newPairs = pickerBrandIds
      .filter((brandId) => !alreadyStaged.has(brandId))
      .map((brandId) => {
        const brand = pickerBrands.find((b) => b.id === brandId)!;
        return { agencyId: agency.id, agencyName: agency.name, brandId: brand.id, brandName: brand.name };
      });
    setStagedPairs((prev) => [...prev, ...newPairs]);
    setPickerAdvertiserIds([]);
    setPickerBrandIds([]);
    setPickerBrands([]);
  };

  const removeStagedPair = (brandId: string) => setStagedPairs((prev) => prev.filter((p) => p.brandId !== brandId));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const assignments = stagedPairs.map(({ agencyId, brandId }) => ({ agencyId, brandId }));
      await api.post('/pods', {
        name,
        salesIds: selectedSalesIds.length > 0 ? selectedSalesIds : undefined,
        assignments: assignments.length > 0 ? assignments : undefined,
      });
      resetForm();
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const selectedPod = pods.find((p) => p.id === selectedPodId) ?? null;
  const selectedPodUsedBrandIds = new Set(selectedPod?.assignments.map((a) => a.brand.id));
  const selectedPodMemberIds = new Set(selectedPod?.members.map((m) => m.sales.id));

  const [editName, setEditName] = useState('');
  useEffect(() => {
    setEditName(selectedPod?.name ?? '');
  }, [selectedPod?.id, selectedPod?.name]);

  const saveName = async () => {
    if (!selectedPodId || !editName.trim() || editName === selectedPod?.name) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/pods/${selectedPodId}`, { name: editName });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save name failed');
    } finally {
      setBusy(false);
    }
  };

  const [manageAgencyId, setManageAgencyId] = useState('');
  const [manageBrandId, setManageBrandId] = useState('');
  const [manageBrands, setManageBrands] = useState<Option[]>([]);
  const manageAdvertisers = advertisers.filter((a) => a.agencyId === manageAgencyId);
  const [manageAdvertiserIds, setManageAdvertiserIds] = useState<string[]>([]);

  useEffect(() => {
    setManageAdvertiserIds([]);
    setManageBrandId('');
    setManageBrands([]);
  }, [manageAgencyId, selectedPodId]);

  useEffect(() => {
    if (manageAdvertiserIds.length === 0) {
      setManageBrands([]);
      return;
    }
    api
      .get<Option[]>(`/brands?advertiserIds=${manageAdvertiserIds.join(',')}`)
      .then((all) => setManageBrands(all.filter((b) => !selectedPodUsedBrandIds.has(b.id))))
      .catch(() => setManageBrands([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageAdvertiserIds]);

  const addAssignmentToSelectedPod = async () => {
    if (!selectedPodId || !manageAgencyId || !manageBrandId) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/pods/${selectedPodId}/assignments`, { agencyId: manageAgencyId, brandId: manageBrandId });
      setManageAgencyId('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  };

  const removeAssignment = async (assignmentId: string) => {
    if (!selectedPodId) return;
    setBusy(true);
    setError('');
    try {
      await api.del(`/pods/${selectedPodId}/assignments/${assignmentId}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  };

  // POD-scoped approvers - who holds a given Position (e.g. "Head POD") for this
  // specific POD, feeding the Approval Level engine's per-step resolution.
  const [approverPositionId, setApproverPositionId] = useState('');
  const [approverUserId, setApproverUserId] = useState('');
  const [approverUserFilter, setApproverUserFilter] = useState('');

  const addApprover = async () => {
    if (!selectedPodId || !approverPositionId || !approverUserId) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/pods/${selectedPodId}/approvers`, { positionId: approverPositionId, userId: approverUserId });
      setApproverPositionId('');
      setApproverUserId('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add approver failed');
    } finally {
      setBusy(false);
    }
  };

  const removeApprover = async (approverId: string) => {
    if (!selectedPodId) return;
    setBusy(true);
    setError('');
    try {
      await api.del(`/pods/${selectedPodId}/approvers/${approverId}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remove approver failed');
    } finally {
      setBusy(false);
    }
  };

  const approverUserOptions = allUsers.filter(
    (s) => !approverUserFilter || s.name.toLowerCase().includes(approverUserFilter.toLowerCase()) || s.employeeId.toLowerCase().includes(approverUserFilter.toLowerCase()),
  );

  // Sales membership - who covers this POD.
  const [memberSalesId, setMemberSalesId] = useState('');
  const [memberSalesFilter, setMemberSalesFilter] = useState('');

  const addMember = async () => {
    if (!selectedPodId || !memberSalesId) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/pods/${selectedPodId}/members`, { salesId: memberSalesId });
      setMemberSalesId('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add member failed');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (memberId: string) => {
    if (!selectedPodId) return;
    setBusy(true);
    setError('');
    try {
      await api.del(`/pods/${selectedPodId}/members/${memberId}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remove member failed');
    } finally {
      setBusy(false);
    }
  };

  const memberSalesOptions = salesOptions.filter(
    (s) =>
      !selectedPodMemberIds.has(s.id) &&
      (!memberSalesFilter || s.name.toLowerCase().includes(memberSalesFilter.toLowerCase()) || s.employeeId.toLowerCase().includes(memberSalesFilter.toLowerCase())),
  );

  const filteredSalesOptions = salesOptions.filter(
    (s) => !salesFilter || s.name.toLowerCase().includes(salesFilter.toLowerCase()) || s.employeeId.toLowerCase().includes(salesFilter.toLowerCase()),
  );

  return (
    <div>
      <div className="toolbar">
        <h1>POD</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search POD name..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New POD'}
          </button>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: -8 }}>
        A POD is a named coverage group. Pick the Sales who cover it and build coverage by picking an Agency, its
        Advertisers, and their Brands (both optional here - more can be added later). A Brand can only appear once
        per POD; one Agency can cover many Brands.
      </p>

      {showForm && (
        <form className="card" onSubmit={onSubmit}>
          <div className="form-row" style={{ maxWidth: 360 }}>
            <label>POD Name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. POD 11" />
          </div>

          <label>Sales ({selectedSalesIds.length} selected, optional)</label>
          <input
            placeholder="Filter sales by name or employee ID..."
            value={salesFilter}
            onChange={(e) => setSalesFilter(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
            {filteredSalesOptions.map((s) => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0', fontWeight: 'normal' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={selectedSalesIds.includes(s.id)} onChange={() => toggleSales(s.id)} />
                {s.name} ({s.employeeId})
              </label>
            ))}
            {filteredSalesOptions.length === 0 && <div style={{ color: 'var(--muted)' }}>No matching Sales</div>}
          </div>

          <div style={{ marginTop: 20 }}>
            <label>Coverage: Agency → Advertiser(s) → Brand(s) (optional)</label>
            <div className="form-grid">
              <div className="form-row" style={{ marginTop: 0 }}>
                <label>1. Agency</label>
                <select value={pickerAgencyId} onChange={(e) => onPickAgency(e.target.value)}>
                  <option value="">Select agency</option>
                  {agencies.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {pickerAgencyId && (
              <>
                <label>2. Advertisers under this Agency ({pickerAdvertiserIds.length} selected)</label>
                <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginBottom: 12 }}>
                  {advertisersForPickerAgency.map((a) => (
                    <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0', fontWeight: 'normal' }}>
                      <input type="checkbox" style={{ width: 'auto' }} checked={pickerAdvertiserIds.includes(a.id)} onChange={() => toggleAdvertiser(a.id)} />
                      {a.name}
                    </label>
                  ))}
                  {advertisersForPickerAgency.length === 0 && <div style={{ color: 'var(--muted)' }}>No advertisers under this agency</div>}
                </div>
              </>
            )}

            {pickerAdvertiserIds.length > 0 && (
              <>
                <label>3. Brands from the selected Advertisers ({pickerBrandIds.length} selected)</label>
                <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginBottom: 12 }}>
                  {pickerLoading && <div style={{ color: 'var(--muted)' }}>Loading brands...</div>}
                  {!pickerLoading &&
                    pickerBrands.map((b) => (
                      <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0', fontWeight: 'normal' }}>
                        <input type="checkbox" style={{ width: 'auto' }} checked={pickerBrandIds.includes(b.id)} onChange={() => toggleBrand(b.id)} />
                        {b.name}
                      </label>
                    ))}
                  {!pickerLoading && pickerBrands.length === 0 && <div style={{ color: 'var(--muted)' }}>No brands found</div>}
                </div>
                <button type="button" className="btn btn-primary" disabled={pickerBrandIds.length === 0} onClick={addStagedPairs}>
                  + Add {pickerBrandIds.length || ''} Brand{pickerBrandIds.length === 1 ? '' : 's'} to POD
                </button>
              </>
            )}
          </div>

          {stagedPairs.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <label>Coverage to be created ({stagedPairs.length})</label>
              <table>
                <thead>
                  <tr>
                    <th>Agency</th>
                    <th>Brand</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {stagedPairs.map((p) => (
                    <tr key={p.brandId}>
                      <td>{p.agencyName}</td>
                      <td>{p.brandName}</td>
                      <td>
                        <button type="button" className="btn btn-danger" onClick={() => removeStagedPair(p.brandId)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={saving || !name} style={{ marginTop: 16 }}>
            {saving ? 'Saving...' : 'Save POD'}
          </button>
        </form>
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Nama POD</th>
              <th>Agency</th>
              <th>Advertiser</th>
              <th>Brand</th>
              <th>Sales</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((p) => {
              const agencyNames = Array.from(new Set(p.assignments.map((a) => a.agency.name))).sort(nameCollator.compare);
              const advertiserNames = Array.from(new Set(p.assignments.map((a) => a.brand.advertiser.name))).sort(nameCollator.compare);
              const brandNames = Array.from(new Set(p.assignments.map((a) => a.brand.name))).sort(nameCollator.compare);
              const salesNames = Array.from(new Set(p.members.map((m) => m.sales.name))).sort(nameCollator.compare);
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <TruncatedList items={agencyNames} />
                  </td>
                  <td>
                    <TruncatedList items={advertiserNames} />
                  </td>
                  <td>
                    <TruncatedList items={brandNames} />
                  </td>
                  <td>
                    <TruncatedList items={salesNames} />
                  </td>
                  <td>
                    <span className={`badge ${p.isActive ? 'badge-success' : 'badge-danger'}`}>
                      {p.isActive ? 'Active' : 'Non Active'}
                    </span>
                  </td>
                  <td>
                    <button className="btn" onClick={() => editPod(p.id)}>
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
            {pods.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--muted)' }}>No PODs found</td>
              </tr>
            )}
          </tbody>
        </table>
        {pods.length > 0 && (
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

      <div className="card" ref={manageCardRef}>
        <h3>Edit POD</h3>
        <div className="form-row" style={{ maxWidth: 360 }}>
          <label>POD</label>
          <select value={selectedPodId} onChange={(e) => setSelectedPodId(e.target.value)}>
            <option value="">Select a POD</option>
            {pods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {selectedPod && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', maxWidth: 480, marginTop: 12 }}>
            <div className="form-row" style={{ flex: 1, marginTop: 0 }}>
              <label>Name</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <button className="btn btn-primary" disabled={busy || !editName.trim() || editName === selectedPod.name} onClick={saveName}>
              Save Name
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Manage Members (existing POD)</h3>
        <p style={{ color: 'var(--muted)', marginTop: -8 }}>Which Sales cover this POD.</p>

        {selectedPod && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', margin: '12px 0', flexWrap: 'wrap' }}>
              <div className="form-row" style={{ flex: 1, marginTop: 0, minWidth: 220 }}>
                <label>Sales</label>
                <input
                  placeholder="Filter by name or employee ID..."
                  value={memberSalesFilter}
                  onChange={(e) => setMemberSalesFilter(e.target.value)}
                  style={{ marginBottom: 4 }}
                />
                <select value={memberSalesId} onChange={(e) => setMemberSalesId(e.target.value)}>
                  <option value="">Select sales</option>
                  {memberSalesOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.employeeId})
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" disabled={!memberSalesId || busy} onClick={addMember}>
                Add
              </button>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Sales</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {selectedPod.members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.sales.name} ({m.sales.employeeId})
                    </td>
                    <td>
                      <button className="btn btn-danger" disabled={busy} onClick={() => removeMember(m.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {selectedPod.members.length === 0 && (
                  <tr>
                    <td colSpan={2} style={{ color: 'var(--muted)' }}>No members yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card">
        <h3>Manage Coverage Pairs (existing POD)</h3>

        {selectedPod && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', margin: '12px 0', flexWrap: 'wrap' }}>
              <div className="form-row" style={{ flex: 1, marginTop: 0, minWidth: 160 }}>
                <label>Agency</label>
                <select value={manageAgencyId} onChange={(e) => setManageAgencyId(e.target.value)}>
                  <option value="">Select agency</option>
                  {agencies.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row" style={{ flex: 1, marginTop: 0, minWidth: 200 }}>
                <label>Advertiser</label>
                <select
                  disabled={!manageAgencyId}
                  value={manageAdvertiserIds[0] ?? ''}
                  onChange={(e) => setManageAdvertiserIds(e.target.value ? [e.target.value] : [])}
                >
                  <option value="">Select advertiser</option>
                  {manageAdvertisers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row" style={{ flex: 1, marginTop: 0, minWidth: 200 }}>
                <label>Brand</label>
                <select disabled={manageAdvertiserIds.length === 0} value={manageBrandId} onChange={(e) => setManageBrandId(e.target.value)}>
                  <option value="">Select brand</option>
                  {manageBrands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" disabled={!manageAgencyId || !manageBrandId || busy} onClick={addAssignmentToSelectedPod}>
                Add
              </button>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Agency</th>
                  <th>Brand</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {selectedPod.assignments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.agency.name}</td>
                    <td>{a.brand.name}</td>
                    <td>
                      <button className="btn btn-danger" disabled={busy} onClick={() => removeAssignment(a.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {selectedPod.assignments.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: 'var(--muted)' }}>No pairs yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card">
        <h3>Manage Approvers (existing POD)</h3>
        <p style={{ color: 'var(--muted)', marginTop: -8 }}>
          Who holds a given Position (e.g. &quot;Head POD&quot;) for this specific POD — feeds the Approval Level
          engine when a Pre-Event/Expense chain is scoped to this POD.
        </p>

        {selectedPod && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', margin: '12px 0', flexWrap: 'wrap' }}>
              <div className="form-row" style={{ flex: 1, marginTop: 0, minWidth: 180 }}>
                <label>Position</label>
                <select value={approverPositionId} onChange={(e) => setApproverPositionId(e.target.value)}>
                  <option value="">Select position</option>
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row" style={{ flex: 1, marginTop: 0, minWidth: 220 }}>
                <label>User</label>
                <input
                  placeholder="Filter by name or employee ID..."
                  value={approverUserFilter}
                  onChange={(e) => setApproverUserFilter(e.target.value)}
                  style={{ marginBottom: 4 }}
                />
                <select value={approverUserId} onChange={(e) => setApproverUserId(e.target.value)}>
                  <option value="">Select user</option>
                  {approverUserOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.employeeId})
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" disabled={!approverPositionId || !approverUserId || busy} onClick={addApprover}>
                Add / Replace
              </button>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Position</th>
                  <th>User</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {selectedPod.approvers.map((a) => (
                  <tr key={a.id}>
                    <td>{a.position.name}</td>
                    <td>
                      {a.user.name} ({a.user.employeeId})
                    </td>
                    <td>
                      <button className="btn btn-danger" disabled={busy} onClick={() => removeApprover(a.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {selectedPod.approvers.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: 'var(--muted)' }}>No approvers configured for this POD yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
