// Mirrors the backend's EXPENSE_EDITABLE_STATUSES (scope.util.ts): an Expense can only be edited while it is with its
// requestor / Sales Admin (DRAFT, PENDING_SALES_ADMIN), sent back by an approver (REVISION), or fully approved and
// waiting for bank matching (READY_TO_MATCHING). Once submitted into the approval chain, and from matching on, it is read-only.
export const EXPENSE_EDITABLE_STATUSES = ['DRAFT', 'PENDING_SALES_ADMIN', 'REVISION', 'READY_TO_MATCHING'];

export const isExpenseEditable = (status: string) => EXPENSE_EDITABLE_STATUSES.includes(status);
