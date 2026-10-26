import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, requireUser, unauthorized } from "@/lib/api-helpers";

/**
 * GET /api/prices/daily/yesterday?date=YYYY-MM-DD
 * Fetches the most recent daily prices recorded before the requested date.
 * Powers the "Copy Yesterday's Prices" feature in the daily rate board.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get("date") || new Date().toISOString().split("T")[0];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return jsonError("Invalid date format. Expected YYYY-MM-DD", 400);
    }

    const targetDate = new Date(`${dateStr}T00:00:00.000Z`);

    // Find the latest effectiveDate strictly before targetDate
    const priorPrice = await prisma.dailyFruitPrice.findFirst({
      where: {
        userId: user.id,
        effectiveDate: { lt: targetDate },
      },
      orderBy: { effectiveDate: "desc" },
      select: { effectiveDate: true },
    });

    if (!priorPrice) {
      return NextResponse.json(
        {
          priorDate: null,
          prices: [],
          message: "No previous daily prices found to copy from.",
        },
        { status: 200 }
      );
    }

    const priorDateStr = priorPrice.effectiveDate.toISOString().split("T")[0];

    // Fetch all prices recorded on that prior date
    const prices = await prisma.dailyFruitPrice.findMany({
      where: {
        userId: user.id,
        effectiveDate: priorPrice.effectiveDate,
      },
      include: {
        fruit: { select: { id: true, name: true, variety: true, isActive: true } },
        unit: { select: { id: true, name: true, code: true } },
      },
    });

    return NextResponse.json(
      {
        priorDate: priorDateStr,
        prices: prices
          .filter((p) => p.fruit.isActive)
          .map((p) => ({
            fruitId: p.fruitId,
            fruitName: p.fruit.name,
            fruitVariety: p.fruit.variety,
            unitId: p.unitId,
            unitName: p.unit.name,
            unitCode: p.unit.code,
            price: Number(p.price),
            notes: p.notes,
          })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[GET /api/prices/daily/yesterday] Error fetching prior prices:", error);
    return jsonError("Failed to fetch prior prices", 500);
  }
}
