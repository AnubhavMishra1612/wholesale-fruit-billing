import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, requireUser, unauthorized } from "@/lib/api-helpers";

/**
 * GET /api/prices/history?fruitId=...&unitId=...&limit=30
 * Returns chronological daily price history for a specific fruit (and optional unit)
 * with statistics (latest, 30-day min/max/average).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(request.url);
    const fruitId = searchParams.get("fruitId");
    const unitId = searchParams.get("unitId");
    const limit = Math.min(180, Math.max(1, parseInt(searchParams.get("limit") || "30", 10)));

    if (!fruitId) {
      return jsonError("fruitId query parameter is required", 400);
    }

    // Verify fruit ownership
    const fruit = await prisma.fruit.findFirst({
      where: { id: fruitId, userId: user.id },
      include: { defaultUnit: true },
    });

    if (!fruit) {
      return jsonError("Fruit not found in your catalogue", 404);
    }

    const whereClause: any = {
      userId: user.id,
      fruitId,
    };
    if (unitId) {
      whereClause.unitId = unitId;
    }

    const history = await prisma.dailyFruitPrice.findMany({
      where: whereClause,
      include: {
        unit: { select: { id: true, name: true, code: true } },
      },
      orderBy: { effectiveDate: "desc" },
      take: limit,
    });

    const numericPrices = history.map((h) => Number(h.price));
    const highest = numericPrices.length > 0 ? Math.max(...numericPrices) : null;
    const lowest = numericPrices.length > 0 ? Math.min(...numericPrices) : null;
    const average =
      numericPrices.length > 0
        ? Math.round((numericPrices.reduce((a, b) => a + b, 0) / numericPrices.length) * 100) / 100
        : null;

    return NextResponse.json(
      {
        fruit: {
          id: fruit.id,
          name: fruit.name,
          variety: fruit.variety,
          category: fruit.category,
          defaultUnit: fruit.defaultUnit,
        },
        stats: {
          count: history.length,
          latest: numericPrices[0] ?? null,
          highest,
          lowest,
          average,
        },
        history: history.map((h) => ({
          id: h.id,
          effectiveDate: h.effectiveDate.toISOString().split("T")[0],
          price: Number(h.price),
          notes: h.notes,
          unit: h.unit,
          createdAt: h.createdAt,
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[GET /api/prices/history] Error fetching price history:", error);
    return jsonError("Failed to fetch price history", 500);
  }
}
