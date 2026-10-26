import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const DEFAULT_FRUIT_UNITS = [
  { name: "Kilogram", code: "kg", isDefault: true },
  { name: "Crate", code: "crt", isDefault: false },
  { name: "Box", code: "box", isDefault: false },
  { name: "Bag", code: "bag", isDefault: false },
  { name: "Dozen", code: "doz", isDefault: false },
  { name: "Gram", code: "g", isDefault: false },
  { name: "Piece", code: "pc", isDefault: false },
  { name: "Quintal", code: "qtl", isDefault: false },
] as const;

export const DEFAULT_FRUIT_CATEGORIES = [
  "Apples & Pears",
  "Citrus",
  "Stone Fruits",
  "Berries",
  "Melons",
  "Tropical & Exotic",
  "Bananas",
  "Grapes",
  "Mangoes",
  "Dry Fruits & Dates",
  "General Produce",
] as const;

/**
 * Ensure the user has the baseline wholesale fruit units configured.
 * If zero units exist for this tenant, seeds the defaults idempotently.
 */
export async function ensureDefaultUnits(
  userId: string,
  tx?: Prisma.TransactionClient
) {
  const db = tx ?? prisma;
  const count = await db.fruitUnit.count({
    where: { userId },
  });

  if (count === 0) {
    for (const unit of DEFAULT_FRUIT_UNITS) {
      await db.fruitUnit.create({
        data: {
          userId,
          name: unit.name,
          code: unit.code,
          isDefault: unit.isDefault,
        },
      });
    }
  }
}
