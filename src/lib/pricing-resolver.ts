/**
 * Pure pricing priority resolver for Wholesale Fruit Billing.
 *
 * Priority Hierarchy:
 * 1. Customer-specific active negotiated rate (CustomerFruitPrice)
 * 2. Daily Price Board rate (DailyFruitPrice latest on or before invoiceDate)
 * 3. Manual entry required
 *
 * Guarantees:
 * - Invoice overrides do not modify customer contracts or daily prices.
 * - Resolves rates strictly within the authenticated tenant scope.
 */

export type PriceSource =
  | "CUSTOMER_CONTRACT"
  | "DAILY_BOARD"
  | "MANUAL"
  | "OVERRIDE";

export interface ContractPriceCandidate {
  id?: string;
  clientId: string;
  fruitId: string;
  unitId: string;
  price: number | { toNumber(): number } | string;
  effectiveFrom: string | Date;
  effectiveTo?: string | Date | null;
}

export interface DailyPriceCandidate {
  id?: string;
  fruitId: string;
  unitId: string;
  price: number | { toNumber(): number } | string;
  effectiveDate: string | Date;
}

export interface ResolvePriceInput {
  contracts: ContractPriceCandidate[];
  dailyPrices: DailyPriceCandidate[];
  clientId?: string | null;
  fruitId?: string | null;
  unitId?: string | null;
  invoiceDate?: string | Date | null;
}

export interface ResolvePriceResult {
  price: number | null;
  source: PriceSource;
  candidateId?: string;
}

function toPriceNum(val: number | { toNumber(): number } | string): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return Number(val);
  if (typeof val === "object" && val !== null && "toNumber" in val) {
    return val.toNumber();
  }
  return Number(val) || 0;
}

function normalizeDate(d: string | Date): string {
  if (typeof d === "string") {
    return d.slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Pure price resolver function.
 */
export function resolveUnitPrice({
  contracts,
  dailyPrices,
  clientId,
  fruitId,
  unitId,
  invoiceDate,
}: ResolvePriceInput): ResolvePriceResult {
  if (!fruitId || !unitId) {
    return { price: null, source: "MANUAL" };
  }

  const targetDateStr = invoiceDate
    ? normalizeDate(invoiceDate)
    : new Date().toISOString().slice(0, 10);

  // 1. Priority 1: Check Customer-specific active contract
  if (clientId) {
    const matchingContract = contracts.find((c) => {
      if (c.clientId !== clientId || c.fruitId !== fruitId || c.unitId !== unitId) {
        return false;
      }
      const fromStr = normalizeDate(c.effectiveFrom);
      const toStr = c.effectiveTo ? normalizeDate(c.effectiveTo) : null;
      return fromStr <= targetDateStr && (!toStr || toStr >= targetDateStr);
    });

    if (matchingContract) {
      return {
        price: toPriceNum(matchingContract.price),
        source: "CUSTOMER_CONTRACT",
        candidateId: matchingContract.id,
      };
    }
  }

  // 2. Priority 2: Check Daily Board Price (latest on or before invoiceDate)
  const validDaily = dailyPrices
    .filter((p) => {
      if (p.fruitId !== fruitId || p.unitId !== unitId) return false;
      const dateStr = normalizeDate(p.effectiveDate);
      return dateStr <= targetDateStr;
    })
    .sort((a, b) => {
      const aDate = normalizeDate(a.effectiveDate);
      const bDate = normalizeDate(b.effectiveDate);
      return bDate.localeCompare(aDate);
    });

  if (validDaily.length > 0) {
    return {
      price: toPriceNum(validDaily[0].price),
      source: "DAILY_BOARD",
      candidateId: validDaily[0].id,
    };
  }

  // 3. Priority 3: Manual entry required
  return {
    price: null,
    source: "MANUAL",
  };
}
