import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { dailyFruitPriceSchema } from "@/lib/validations";
import {
  getPrismaErrorCode,
  validationErrorResponse,
  jsonError,
  requireUser,
  unauthorized,
} from "@/lib/api-helpers";
import { recordAuditLog } from "@/lib/audit";
import { ensureDefaultUnits } from "@/lib/fruit-defaults";

/**
 * GET /api/prices/daily?date=YYYY-MM-DD
 * Returns the price board for the specified date (defaults to today's date).
 * Lists all active fruits and attaches any price already recorded for that date.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get("date") || new Date().toISOString().split("T")[0];

    // Validate date format YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return jsonError("Invalid date format. Expected YYYY-MM-DD", 400);
    }

    await ensureDefaultUnits(user.id);
    const targetDate = new Date(`${dateStr}T00:00:00.000Z`);

    // Fetch active fruits for the user with default unit
    const fruits = await prisma.fruit.findMany({
      where: {
        userId: user.id,
        isActive: true,
        isArchived: false,
      },
      include: {
        defaultUnit: true,
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    // Fetch prices recorded for this specific date
    const dailyPrices = await prisma.dailyFruitPrice.findMany({
      where: {
        userId: user.id,
        effectiveDate: targetDate,
      },
      include: {
        unit: true,
      },
    });

    // Map by fruitId
    const priceMap = new Map<string, (typeof dailyPrices)[0]>();
    for (const dp of dailyPrices) {
      priceMap.set(dp.fruitId, dp);
    }

    // Build the rate board response
    const board = fruits.map((fruit) => {
      const existingPrice = priceMap.get(fruit.id);
      return {
        fruitId: fruit.id,
        fruitName: fruit.name,
        fruitVariety: fruit.variety,
        category: fruit.category || "General Produce",
        hsnCode: fruit.hsnCode,
        unitId: existingPrice?.unitId || fruit.defaultUnitId,
        unitName: existingPrice?.unit?.name || fruit.defaultUnit?.name || "Kilogram",
        unitCode: existingPrice?.unit?.code || fruit.defaultUnit?.code || "kg",
        price: existingPrice ? Number(existingPrice.price) : null,
        notes: existingPrice?.notes || null,
        priceId: existingPrice?.id || null,
        effectiveDate: dateStr,
        updatedAt: existingPrice?.updatedAt || null,
      };
    });

    return NextResponse.json(
      {
        date: dateStr,
        totalFruits: fruits.length,
        pricedCount: dailyPrices.length,
        board,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[GET /api/prices/daily] Error fetching daily price board:", error);
    return jsonError("Failed to fetch daily price board", 500);
  }
}

/**
 * POST /api/prices/daily
 * Upsert a single daily price record for fruit + unit + effectiveDate.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const body = await request.json();
    const validated = dailyFruitPriceSchema.parse(body);

    const targetDate = new Date(`${validated.effectiveDate}T00:00:00.000Z`);

    // Verify fruit and unit ownership
    const fruit = await prisma.fruit.findFirst({
      where: { id: validated.fruitId, userId: user.id },
    });
    if (!fruit) return jsonError("Fruit not found in your catalogue", 404);

    const unit = await prisma.fruitUnit.findFirst({
      where: { id: validated.unitId, userId: user.id },
    });
    if (!unit) return jsonError("Fruit unit not found in your account", 404);

    const priceRecord = await prisma.$transaction(async (tx) => {
      const existing = await tx.dailyFruitPrice.findUnique({
        where: {
          daily_fruit_price_per_user: {
            userId: user.id,
            fruitId: validated.fruitId,
            unitId: validated.unitId,
            effectiveDate: targetDate,
          },
        },
      });

      const upserted = await tx.dailyFruitPrice.upsert({
        where: {
          daily_fruit_price_per_user: {
            userId: user.id,
            fruitId: validated.fruitId,
            unitId: validated.unitId,
            effectiveDate: targetDate,
          },
        },
        create: {
          userId: user.id,
          fruitId: validated.fruitId,
          unitId: validated.unitId,
          effectiveDate: targetDate,
          price: validated.price,
          notes: validated.notes ?? null,
        },
        update: {
          price: validated.price,
          notes: validated.notes !== undefined ? validated.notes : undefined,
        },
      });

      await recordAuditLog(
        {
          userId: user.id,
          entityType: "DAILY_PRICE",
          entityId: upserted.id,
          action: existing ? "UPDATED" : "CREATED",
          actorId: user.id,
          changes: { before: existing, after: upserted },
          notes: `Price set to ₹${validated.price} for ${validated.effectiveDate}`,
        },
        tx
      );

      return upserted;
    });

    return NextResponse.json(priceRecord, { status: 200 });
  } catch (error) {
    if (error instanceof ZodError) {
      return validationErrorResponse(error);
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON payload", 400);
    }

    console.error("[POST /api/prices/daily] Error saving daily price:", error);
    return jsonError("Failed to save daily price", 500);
  }
}
