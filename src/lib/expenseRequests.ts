export type ExpenseRequestStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'BUDGET_INPUT' | 'CORSEC_VERIFICATION' | 'PROCEED' | 'REJECTED' | 'CANCELLED';

export interface ExpenseRequestStep {
  stepOrder: number;
  status: string;
  position: { name: string; code?: string };
  resolvedApprover?: { id: string; name: string };
}

export interface ExpenseRequest {
  id: string;
  requestNo: string;
  requestedBy: { id: string; name: string };
  // Set when keyed in on the requestor's behalf; that inputter can still edit/submit the DRAFT.
  createdBy?: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  activityType: { id: string; name: string };
  clientName: string | null; // legacy free text; new requests use agencies/advertisers/brands
  agencies: { agency: { id: string; name: string } }[];
  advertisers: { advertiser: { id: string; name: string } }[];
  brands: { brand: { id: string; name: string; advertiserId: string } }[];
  requestBudget: string | null;
  greetingText: string;
  sendDate: string;
  recipientAddress: string;
  logo: string | null;
  status: ExpenseRequestStatus;
  rejectReason: string | null;
  budgetAmount: string | null;
  budgetNotes: string | null;
  budgetBy: { name: string } | null;
  verifiedBy: { name: string } | null;
  expense?: { id: string; expenseNo: string; status: string } | null;
  createdAt: string;
  approvalRequest: { currentStep: number; status: string; steps: ExpenseRequestStep[] } | null;
}

export const EXPENSE_REQUEST_STATUS_LABEL: Record<ExpenseRequestStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  BUDGET_INPUT: 'Waiting Budget',
  CORSEC_VERIFICATION: 'Corsec Verification',
  PROCEED: 'Proceed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const expenseRequestTone = (status: ExpenseRequestStatus) =>
  status === 'PROCEED' ? 'success' : status === 'REJECTED' || status === 'CANCELLED' ? 'danger' : status === 'DRAFT' ? 'info' : 'warning';

// Position code of the final Corsec verification stage (see BE seed).
export const POSITION_CORSEC = 'CORSEC';

// Position code of the budget-input stage (Sales Customer Service).
export const POSITION_SALES_CS = 'SLS-CS';

// Status to show for a chain step. The Sales Customer Service step is the budget stage, so it
// only reads APPROVED once a budget was submitted (rows approved under the old flow have the
// step APPROVED while still waiting for the budget).
export function stepDisplayStatus(r: ExpenseRequest, s: ExpenseRequestStep): string {
  if (s.position.code === POSITION_SALES_CS && r.status === 'BUDGET_INPUT') return 'PENDING';
  return s.status;
}

// The approval step that is actionable right now (approval is strictly sequential).
export function currentApprovalStep(r: ExpenseRequest): ExpenseRequestStep | undefined {
  const ar = r.approvalRequest;
  if (r.status !== 'PENDING_APPROVAL' || !ar || ar.status !== 'PENDING') return undefined;
  return ar.steps.find((s) => s.stepOrder === ar.currentStep);
}

// Client side of a request: its Advertisers, or the legacy free-text name on old rows.
export function clientLabel(r: {
  clientName: string | null;
  advertisers?: { advertiser: { name: string } }[];
  agencies?: { agency: { name: string } }[];
}): string {
  const names = r.advertisers?.map((a) => a.advertiser.name) ?? [];
  if (names.length) return names.join(', ');
  const agencyNames = r.agencies?.map((a) => a.agency.name) ?? [];
  return agencyNames.length ? agencyNames.join(', ') : (r.clientName ?? '-');
}
