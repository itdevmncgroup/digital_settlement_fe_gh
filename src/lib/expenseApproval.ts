import { positionMatches } from '@/lib/position';

export const FLOWER_ACTIVITY_TYPE = 'Flower Bouquet';
export const POSITION_SALES_ADMIN = 'SLSADM';

export const MATCH_FIRST_MESSAGE = 'Match this Flower Bouquet expense to a bank statement transaction before approving it.';

// A Flower Bouquet Expense sitting at the Sales Admin tier (the chain's SLSADM step, or
// PENDING_SALES_ADMIN before the chain exists) may not be approved by the Sales Admin until it is
// matched. `stepPositionCode` is the current approval step's Position, when there is one.
export function mustMatchBeforeApprove(
  expense: { activityType?: { name: string } | null; isMatched?: boolean; status?: string } | null | undefined,
  stepPositionCode?: string | null,
): boolean {
  if (!expense || expense.activityType?.name !== FLOWER_ACTIVITY_TYPE || expense.isMatched) return false;
  return expense.status === 'PENDING_SALES_ADMIN' || positionMatches(stepPositionCode, POSITION_SALES_ADMIN);
}
