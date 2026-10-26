import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { bulkDailyPricesSchema } from "@/lib/validations";
import {
  validationErrorResponse,
  jsonError,
  requireUser,
  unauthorized,
} from "@/lib/api-helpers";
import { recordAuditLog } from "@/lib/audit";

/**
 * POST /api/prices/daily/bulk
 * Atomically update or insert daily market prices for multiple fruits on effectiveDate.
 * Enforces contract invariance: default prices NEVER touch negotiated customer contracts.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const body = await request.json();
    const validated = bulkDailyPricesSchema.parse(body);

    const targetDate = new Date(`${validated.effectiveDate}T00:00:00.000Z`);

    // Verify all fruit and unit IDs belong to the calling user
    const fruitIds = Array.from(new Set(validated.prices.map((p) => p.fruitId)));
    const unitIds = Array.from(new Set(validated.prices.map((p) => p.unitId)));

    const [tenantFruits, tenantUnits] = await Promise.all([
      prisma.fruit.findMany({
        where: { id: { in: fruitIds }, userId: user.id },
        select: { id: true, name: true },
      }),
      prisma.fruitUnit.findMany({
        where: { id: { in: unitIds }, userId: user.id },
        select: { id: true, code: true },
      }),
    ]);

    if (tenantFruits.length !== fruitIds.length) {
      return jsonError("One or more selected fruits do not belong to your account", 403);
    }
    if (tenantUnits.length !== unitIds.length) {
      return jsonError("One or more selected units do not belong to your account", 403);
    }

    // Execute bulk upserts inside a single transaction
    const saved = await prisma.$transaction(async (tx) => {
      const results = [];

      for (const item of validated.prices) {
        const record = await tx.dailyFruitPrice.upsert({
          where: {
            daily_fruit_price_per_user: {
              userId: user.id,
              fruitId: item.fruitId,
              unitId: item.unitId,
              effectiveDate: targetDate,
            },
          },
          create: {
            userId: user.id,
            fruitId: item.fruitId,
            unitId: item.unitId,
            effectiveDate: targetDate,
            price: item.price,
            notes: item.notes ?? null,
          },
          update: {
            price: item.price,
            notes: item.notes !== undefined ? item.notes : undefined,
          },
        });
        results.push(record);
      }

      await recordAuditLog(
        {
          userId: user.id,
          entityType: "DAILY_PRICE",
          entityId: validated.effectiveDate,
          action: "BULK_UPDATED",
          actorId: user.id,
          changes: {
            effectiveDate: validated.effectiveDate,
            count: results.length,
            prices: validated.prices.map((p) => ({
              fruitId: p.fruitId,
              price: p.price,
            })),
          },
          notes: `Bulk updated ${results.length} fruit prices for date ${validated.effectiveDate}`,
        },
        tx
      );

      return results;
    });

    return NextResponse.json(
      {
        message: `Successfully saved ${saved.length} daily fruit prices`,
        effectiveDate: validated.effectiveDate,
        count: saved.length,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return validationErrorResponse(error);
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON payload", 400);
    }

    console.error("[POST /api/prices/daily/bulk] Error bulk saving daily prices:", error);
    return jsonError("Failed to bulk save daily prices", 500);
  }
}
