'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { usePagination } from '@/lib/usePagination';
import Pagination from '@/components/Pagination';
import SearchBox from '@/components/SearchBox';
import Modal from '@/components/Modal';

interface Option {
  id: string;
  name: string;
}

interface SalesOption extends Option {
  employeeId: string;
  roles: string[];
  departments: Option[];
}

interface AdvertiserOption extends Option {
  agencyId: string;
}

interface DepartmentAssignment {
  id: string;
  agency: Option;
  brand: Option & { advertiser: Option };
}

interface DepartmentApprover {
  id: string;
  position: Option;
  user: Option & { employeeId: string };
}

interface DepartmentListItem {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  assignments: DepartmentAssignment[];
  approvers: DepartmentApprover[];
}

interface StagedPair {
  agencyId: string;
  agencyName: string;
  brandId: string;
  brandName: string;
}

interface StagedApprover {
  positionId: string;
  positionName: string;
  userId: string;
  userName: string;
}

const nameCollator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });

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

// Department: an org department AND/OR a named Sales coverage group (BRD
// section 6.2, formerly the separate "POD" concept - "POD 1".."POD 10" are
// Department rows just like any org department). Coverage is one or more
// Agency -> Brand pairs; membership (which Sales belong here, many-to-many)
// is managed on the User master page, not here.
export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<DepartmentListItem[]>([]);
  const [salesOptions, setSalesOptions] = useState<SalesOption[]>([]);
  const [agencies, setAgencies] = useState<Option[]>([]);
  const [advertisers, setAdvertisers] = useState<AdvertiserOption[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  // Cascading Agency -> Advertiser -> Brand picker (staging area for the create form)
  const [pickerAgencyId, setPickerAgencyId] = useState('');
  const [pickerAdvertiserIds, setPickerAdvertiserIds] = useState<string[]>([]);
  const [pickerBrands, setPickerBrands] = useState<Option[]>([]);
  const [pickerBrandIds, setPickerBrandIds] = useState<string[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [stagedPairs, setStagedPairs] = useState<StagedPair[]>([]);

  // Approvers staging area (create form): Position -> User, sent as
  // /departments/:id/approvers calls right after the Department itself is created.
  const [positions, setPositions] = useState<Option[]>([]);
  const [approverPositionId, setApproverPositionId] = useState('');
  const [approverUserId, setApproverUserId] = useState('');
  const [stagedApprovers, setStagedApprovers] = useState<StagedApprover[]>([]);

  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const editDepartment = (id: string) => {
    setSelectedDepartmentId(id);
    setEditModalOpen(true);
  };

  const closeEditModal = () => {
    setEditModalOpen(false);
    setSelectedDepartmentId('');
  };

  const pagination = usePagination(departments);

  const load = () => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    api
      .get<DepartmentListItem[]>(`/departments${qs}`)
      .then((res) => setDepartments([...res].sort((a, b) => nameCollator.compare(a.name, b.name))))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  };

  useEffect(load, [search]);

  useEffect(() => {
    api.get<SalesOption[]>('/users').then(setSalesOptions).catch(() => undefined);
    api.get<Option[]>('/agencies?active=true').then(setAgencies).catch(() => undefined);
    api.get<AdvertiserOption[]>('/advertisers?active=true').then(setAdvertisers).catch(() => undefined);
    api.get<Option[]>('/positions?active=true').then(setPositions).catch(() => undefined);
  }, []);

  // Fetch Brands scoped to the selected Advertisers whenever that set changes.
  useEffect(() => {
    if (pickerAdvertiserIds.length === 0) {
      setPickerBrands([]);
      return;
    }
    setPickerLoading(true);
    api
      .get<Option[]>(`/brands?advertiserIds=${pickerAdvertiserIds.join(',')}&active=true`)
      .then(setPickerBrands)
      .catch(() => setPickerBrands([]))
      .finally(() => setPickerLoading(false));
  }, [pickerAdvertiserIds]);

  const resetForm = () => {
    setName('');
    setCode('');
    setPickerAgencyId('');
    setPickerAdvertiserIds([]);
    setPickerBrandIds([]);
    setPickerBrands([]);
    setStagedPairs([]);
    setApproverPositionId('');
    setApproverUserId('');
    setStagedApprovers([]);
  };

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

  // A Position can only be staged once here (the backend upserts one User per
  // Position per Department anyway - @@unique([departmentId, positionId])).
  const addStagedApprover = () => {
    const position = positions.find((p) => p.id === approverPositionId);
    const user = salesOptions.find((s) => s.id === approverUserId);
    if (!position || !user) return;
    setStagedApprovers((prev) => [
      ...prev.filter((a) => a.positionId !== position.id),
      { positionId: position.id, positionName: position.name, userId: user.id, userName: user.name },
    ]);
    setApproverPositionId('');
    setApproverUserId('');
  };

  const removeStagedApprover = (positionId: string) =>
    setStagedApprovers((prev) => prev.filter((a) => a.positionId !== positionId));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const assignments = stagedPairs.map(({ agencyId, brandId }) => ({ agencyId, brandId }));
      const department = await api.post<DepartmentListItem>('/departments', {
        name,
        code: code || undefined,
        assignments: assignments.length > 0 ? assignments : undefined,
      });
      // CreateDepartmentDto has no approvers field - the Department must exist
      // first, so staged approvers go in one by one right after.
      for (const a of stagedApprovers) {
        await api.post(`/departments/${department.id}/approvers`, { positionId: a.positionId, userId: a.userId });
      }
      resetForm();
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const selectedDepartment = departments.find((d) => d.id === selectedDepartmentId) ?? null;
  const selectedDepartmentUsedBrandIds = new Set(selectedDepartment?.assignments.map((a) => a.brand.id));
  const selectedDepartmentMembers = salesOptions.filter((s) => s.departments.some((d) => d.id === selectedDepartmentId));

  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  useEffect(() => {
    setEditName(selectedDepartment?.name ?? '');
    setEditCode(selectedDepartment?.code ?? '');
  }, [selectedDepartment?.id, selectedDepartment?.name, selectedDepartment?.code]);

  const saveDetails = async () => {
    if (!selectedDepartmentId) return;
    const nameChanged = editName.trim() && editName !== selectedDepartment?.name;
    const codeChanged = editCode !== (selectedDepartment?.code ?? '');
    if (!nameChanged && !codeChanged) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/departments/${selectedDepartmentId}`, {
        name: nameChanged ? editName : undefined,
        code: codeChanged ? editCode || undefined : undefined,
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
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
  }, [manageAgencyId, selectedDepartmentId]);

  useEffect(() => {
    if (manageAdvertiserIds.length === 0) {
      setManageBrands([]);
      return;
    }
    api
      .get<Option[]>(`/brands?advertiserIds=${manageAdvertiserIds.join(',')}&active=true`)
      .then((all) => setManageBrands(all.filter((b) => !selectedDepartmentUsedBrandIds.has(b.id))))
      .catch(() => setManageBrands([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageAdvertiserIds]);

  const addAssignmentToSelectedDepartment = async () => {
    if (!selectedDepartmentId || !manageAgencyId || !manageBrandId) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/departments/${selectedDepartmentId}/assignments`, { agencyId: manageAgencyId, brandId: manageBrandId });
      setManageAgencyId('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  };

  const removeAssignment = async (assignmentId: string) => {
    if (!selectedDepartmentId) return;
    setBusy(true);
    setError('');
    try {
      await api.del(`/departments/${selectedDepartmentId}/assignments/${assignmentId}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  };

  const [manageApproverPositionId, setManageApproverPositionId] = useState('');
  const [manageApproverUserId, setManageApproverUserId] = useState('');
  useEffect(() => {
    setManageApproverPositionId('');
    setManageApproverUserId('');
  }, [selectedDepartmentId]);

  // Upserts (backend replaces the User already holding this Position for this
  // Department, since positionId is unique per Department).
  const addApproverToSelectedDepartment = async () => {
    if (!selectedDepartmentId || !manageApproverPositionId || !manageApproverUserId) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/departments/${selectedDepartmentId}/approvers`, {
        positionId: manageApproverPositionId,
        userId: manageApproverUserId,
      });
      setManageApproverPositionId('');
      setManageApproverUserId('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  };

  const removeApprover = async (approverId: string) => {
    if (!selectedDepartmentId) return;
    setBusy(true);
    setError('');
    try {
      await api.del(`/departments/${selectedDepartmentId}/approvers/${approverId}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Department</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBox
            placeholder="Search Department name..."
            value={searchInput}
            onChange={setSearchInput}
            onSearch={() => setSearch(searchInput)}
          />
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New Department'}
          </button>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: -8 }}>
        A Department is an org department and/or a named coverage group (e.g. &quot;POD 1&quot;). Build coverage by
        picking an Agency, its Advertisers, and their Brands (optional here - more can be added later). A Brand can
        only appear once per Department; one Agency can cover many Brands. Membership (which Sales belong here) is
        set on the User master page.
      </p>

      {showForm && (
        <form className="card" onSubmit={onSubmit}>
          <div className="form-grid">
            <div className="form-row" style={{ marginTop: 0 }}>
              <label>Name</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. POD 11" />
            </div>
            <div className="form-row" style={{ marginTop: 0 }}>
              <label>Code (optional)</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SALES_MKT" />
            </div>
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
                  + Add {pickerBrandIds.length || ''} Brand{pickerBrandIds.length === 1 ? '' : 's'} to Department
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

          <div style={{ marginTop: 20 }}>
            <label>Approvers: Position → Sales (optional)</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
              <div className="form-row" style={{ flex: 1, marginTop: 0, minWidth: 200 }}>
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
              <div className="form-row" style={{ flex: 1, marginTop: 0, minWidth: 200 }}>
                <label>Sales (User)</label>
                <select value={approverUserId} onChange={(e) => setApproverUserId(e.target.value)}>
                  <option value="">Select user</option>
                  {salesOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.employeeId})
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn btn-primary" disabled={!approverPositionId || !approverUserId} onClick={addStagedApprover}>
                + Add Approver
              </button>
            </div>

            {stagedApprovers.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Position</th>
                    <th>Sales</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {stagedApprovers.map((a) => (
                    <tr key={a.positionId}>
                      <td>{a.positionName}</td>
                      <td>{a.userName}</td>
                      <td>
                        <button type="button" className="btn btn-danger" onClick={() => removeStagedApprover(a.positionId)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <button className="btn btn-primary" type="submit" disabled={saving || !name} style={{ marginTop: 16 }}>
            {saving ? 'Saving...' : 'Save Department'}
          </button>
        </form>
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Agency</th>
              <th>Advertiser</th>
              <th>Brand</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageRows.map((d) => {
              const agencyNames = Array.from(new Set(d.assignments.map((a) => a.agency.name))).sort(nameCollator.compare);
              const advertiserNames = Array.from(new Set(d.assignments.map((a) => a.brand.advertiser.name))).sort(nameCollator.compare);
              const brandNames = Array.from(new Set(d.assignments.map((a) => a.brand.name))).sort(nameCollator.compare);
              return (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.code ?? '-'}</td>
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
                    <span className={`badge ${d.isActive ? 'badge-success' : 'badge-danger'}`}>
                      {d.isActive ? 'Active' : 'Non Active'}
                    </span>
                  </td>
                  <td>
                    <button className="btn" onClick={() => editDepartment(d.id)}>
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
            {departments.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--muted)' }}>No Departments found</td>
              </tr>
            )}
          </tbody>
        </table>
        {departments.length > 0 && (
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

      {editModalOpen && selectedDepartment && (
        <Modal title={`Edit Department: ${selectedDepartment.name}`} onClose={closeEditModal} wide>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-row" style={{ flex: 1, marginTop: 0, minWidth: 200 }}>
              <label>Name</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="form-row" style={{ flex: 1, marginTop: 0, minWidth: 160 }}>
              <label>Code</label>
              <input value={editCode} onChange={(e) => setEditCode(e.target.value)} />
            </div>
            <button
              className="btn btn-primary"
              disabled={busy || (editName === selectedDepartment.name && editCode === (selectedDepartment.code ?? ''))}
              onClick={saveDetails}
            >
              Save
            </button>
          </div>

          <div style={{ marginTop: 24 }}>
            <h3>Members</h3>
            <p style={{ color: 'var(--muted)', marginTop: -8 }}>
              Which Sales belong to this Department - set from the User master page.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Sales</th>
                </tr>
              </thead>
              <tbody>
                {selectedDepartmentMembers.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.name} ({m.employeeId})
                    </td>
                  </tr>
                ))}
                {selectedDepartmentMembers.length === 0 && (
                  <tr>
                    <td style={{ color: 'var(--muted)' }}>No members yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 24 }}>
            <h3>Manage Coverage Pairs</h3>

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
              <button className="btn btn-primary" disabled={!manageAgencyId || !manageBrandId || busy} onClick={addAssignmentToSelectedDepartment}>
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
                {selectedDepartment.assignments.map((a) => (
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
                {selectedDepartment.assignments.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: 'var(--muted)' }}>No pairs yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 24 }}>
            <h3>Approvers</h3>
            <p style={{ color: 'var(--muted)', marginTop: -8 }}>
              Who holds each Position (e.g. &quot;Head&quot;) for this specific Department - feeds the Approval
              Level engine. One User per Position per Department; adding again for the same Position replaces
              the current holder.
            </p>

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', margin: '12px 0', flexWrap: 'wrap' }}>
              <div className="form-row" style={{ flex: 1, marginTop: 0, minWidth: 200 }}>
                <label>Position</label>
                <select value={manageApproverPositionId} onChange={(e) => setManageApproverPositionId(e.target.value)}>
                  <option value="">Select position</option>
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row" style={{ flex: 1, marginTop: 0, minWidth: 200 }}>
                <label>Sales (User)</label>
                <select value={manageApproverUserId} onChange={(e) => setManageApproverUserId(e.target.value)}>
                  <option value="">Select user</option>
                  {salesOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.employeeId})
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="btn btn-primary"
                disabled={!manageApproverPositionId || !manageApproverUserId || busy}
                onClick={addApproverToSelectedDepartment}
              >
                Add
              </button>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Sales</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {selectedDepartment.approvers.map((a) => (
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
                {selectedDepartment.approvers.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: 'var(--muted)' }}>No approvers yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
