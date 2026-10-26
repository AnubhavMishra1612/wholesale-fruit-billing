/**
 * Utility functions for negotiated contract date range verification and overlap prevention.
 */

/**
 * Helper to normalize Date object or date string to YYYY-MM-DD.
 */
export function normalizeDateString(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export interface ContractPeriod {
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
}

/**
 * Checks whether two contract intervals overlap inclusively.
 * Both boundaries (effectiveFrom and effectiveTo) are treated inclusively.
 * null or undefined effectiveTo represents an open-ended (indefinite) contract.
 *
 * Interval [s1, e1] overlaps with [s2, e2] iff:
 * (s1 <= (e2 ?? +inf)) AND (s2 <= (e1 ?? +inf))
 */
export function checkContractOverlap(
  period1: ContractPeriod,
  period2: ContractPeriod
): boolean {
  const s1 = normalizeDateString(period1.effectiveFrom);
  const e1 = normalizeDateString(period1.effectiveTo);
  const s2 = normalizeDateString(period2.effectiveFrom);
  const e2 = normalizeDateString(period2.effectiveTo);

  if (!s1 || !s2) return false;

  return (!e2 || s1 <= e2) && (!e1 || s2 <= e1);
}
