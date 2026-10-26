import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, unauthorized, jsonError } from "@/lib/api-helpers";
import { resolveUnitPrice, type PriceSource } from "@/lib/pricing-resolver";

/**
 * GET /api/prices/resolve
 * Resolves the unit price for a fruit line item following wholesale priority:
 * 1. Applicable customer-specific negotiated rate (CustomerFruitPrice)
 * 2. Applicable daily board rate on or before the invoice date (DailyFruitPrice)
 * 3. Manual entry required
 *
 * Query Params:
 * - clientId: string (optional)
 * - fruitId: string (required)
 * - unitId: string (required)
 * - date: YYYY-MM-DD (optional, defaults to today)
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(request.url);
    const fruitId = searchParams.get("fruitId")?.trim();
    const unitId = searchParams.get("unitId")?.trim();
    const clientId = searchParams.get("clientId")?.trim() || undefined;
    const dateStr = searchParams.get("date")?.trim() || new Date().toISOString().slice(0, 10);

    if (!fruitId || !unitId) {
      return jsonError("Both fruitId and unitId are required to resolve price", 400);
    }

    // Verify fruit and unit belong to the tenant
    const [fruit, unit] = await Promise.all([
      prisma.fruit.findFirst({
        where: { id: fruitId, userId: user.id },
        select: { id: true, name: true, variety: true },
      }),
      prisma.fruitUnit.findFirst({
        where: { id: unitId, userId: user.id },
        select: { id: true, name: true, code: true },
      }),
    ]);

    if (!fruit) return jsonError("Fruit not found in tenant catalogue", 404);
    if (!unit) return jsonError("Unit not found in tenant catalogue", 404);

    // Fetch applicable contracts for this client (if client specified)
    const contracts = clientId
      ? await prisma.customerFruitPrice.findMany({
          where: {
            userId: user.id,
            clientId,
            fruitId,
            unitId,
          },
          select: {
            id: true,
            clientId: true,
            fruitId: true,
            unitId: true,
            price: true,
            effectiveFrom: true,
            effectiveTo: true,
          },
        })
      : [];

    // Fetch daily prices for this fruit and unit on or before target date
    const targetDate = new Date(`${dateStr}T23:59:59.999Z`);
    const dailyPrices = await prisma.dailyFruitPrice.findMany({
      where: {
        userId: user.id,
        fruitId,
        unitId,
        effectiveDate: { lte: targetDate },
      },
      select: {
        id: true,
        fruitId: true,
        unitId: true,
        price: true,
        effectiveDate: true,
      },
      orderBy: { effectiveDate: "desc" },
      take: 5,
    });

    const resolution = resolveUnitPrice({
      contracts: contracts.map((c) => ({
        id: c.id,
        clientId: c.clientId,
        fruitId: c.fruitId,
        unitId: c.unitId,
        price: Number(c.price),
        effectiveFrom: c.effectiveFrom,
        effectiveTo: c.effectiveTo,
      })),
      dailyPrices: dailyPrices.map((d) => ({
        id: d.id,
        fruitId: d.fruitId,
        unitId: d.unitId,
        price: Number(d.price),
        effectiveDate: d.effectiveDate,
      })),
      clientId,
      fruitId,
      unitId,
      invoiceDate: dateStr,
    });

    return NextResponse.json({
      price: resolution.price,
      source: resolution.source as PriceSource,
      candidateId: resolution.candidateId,
      fruitId: fruit.id,
      fruitName: fruit.name,
      fruitVariety: fruit.variety,
      unitId: unit.id,
      unitName: unit.code || unit.name,
      targetDate: dateStr,
    });
  } catch (error) {
    console.error("[GET /api/prices/resolve] Failed:", error);
    return jsonError("Failed to resolve unit price", 500);
  }
}
