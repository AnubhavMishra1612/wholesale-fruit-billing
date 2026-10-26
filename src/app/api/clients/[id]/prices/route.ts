import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { customerFruitPriceSchema } from "@/lib/validations";
import {
  getPrismaErrorCode,
  validationErrorResponse,
  jsonError,
  requireUser,
  unauthorized,
} from "@/lib/api-helpers";
import { recordAuditLog } from "@/lib/audit";
import { checkContractOverlap, normalizeDateString } from "@/lib/contract-overlap";

/**
 * GET /api/clients/[id]/prices
 * List all negotiated contract rates for a specific customer.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { id: clientId } = await params;

    // Verify client belongs to current user
    const client = await prisma.client.findFirst({
      where: { id: clientId, userId: user.id },
      select: { id: true, name: true },
    });
    if (!client) return jsonError("Client not found", 404);

    const prices = await prisma.customerFruitPrice.findMany({
      where: {
        userId: user.id,
        clientId,
      },
      include: {
        fruit: { select: { id: true, name: true, variety: true, category: true } },
        unit: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json(
      {
        clientId,
        clientName: client.name,
        count: prices.length,
        prices: prices.map((p) => ({
          id: p.id,
          fruitId: p.fruitId,
          fruitName: p.fruit.name,
          fruitVariety: p.fruit.variety,
          category: p.fruit.category,
          unitId: p.unitId,
          unitName: p.unit.name,
          unitCode: p.unit.code,
          price: Number(p.price),
          effectiveFrom: p.effectiveFrom.toISOString().split("T")[0],
          effectiveTo: p.effectiveTo ? p.effectiveTo.toISOString().split("T")[0] : null,
          notes: p.notes,
          isActive: !p.effectiveTo || new Date(p.effectiveTo) >= new Date(),
          createdAt: p.createdAt,
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[GET /api/clients/[id]/prices] Error fetching customer rates:", error);
    return jsonError("Failed to fetch customer negotiated rates", 500);
  }
}

/**
 * POST /api/clients/[id]/prices
 * Create or version a negotiated price contract for a customer.
 * Safely caps previous open-ended contracts to prevent overlapping rate ambiguity.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { id: clientId } = await params;
    const body = await request.json();

    // Ensure clientId matches URL parameter
    const payload = { ...body, clientId };
    const validated = customerFruitPriceSchema.parse(payload);

    // Verify tenant ownership of client, fruit, and unit
    const [client, fruit, unit] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, userId: user.id } }),
      prisma.fruit.findFirst({ where: { id: validated.fruitId, userId: user.id } }),
      prisma.fruitUnit.findFirst({ where: { id: validated.unitId, userId: user.id } }),
    ]);

    if (!client) return jsonError("Client not found", 404);
    if (!fruit) return jsonError("Fruit not found in catalogue", 404);
    if (!unit) return jsonError("Fruit unit not found", 404);

    const fromDate = new Date(`${validated.effectiveFrom}T00:00:00.000Z`);
    const toDate = validated.effectiveTo ? new Date(`${validated.effectiveTo}T00:00:00.000Z`) : null;

    if (toDate && toDate < fromDate) {
      return jsonError("Effective to date cannot be earlier than effective from date", 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      // Concurrency lock per (tenant, customer, fruit, unit)
      const lockKey = `${user.id}:${clientId}:${validated.fruitId}:${validated.unitId}`;
      try {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      } catch {
        // Fallback if raw query unavailable
      }

      // Query all existing contracts for this customer, fruit, and unit
      const existingContracts = await tx.customerFruitPrice.findMany({
        where: {
          userId: user.id,
          clientId,
          fruitId: validated.fruitId,
          unitId: validated.unitId,
        },
      });

      // Strict overlap check (inclusive boundaries, open-ended support)
      const newContract = {
        effectiveFrom: validated.effectiveFrom,
        effectiveTo: validated.effectiveTo ?? null,
      };

      for (const c of existingContracts) {
        const overlaps = checkContractOverlap(newContract, {
          effectiveFrom: c.effectiveFrom,
          effectiveTo: c.effectiveTo,
        });

        if (overlaps) {
          const eFromStr = normalizeDateString(c.effectiveFrom);
          const eToStr = normalizeDateString(c.effectiveTo) ?? "indefinite";
          return {
            conflict: true as const,
            message: `Contract date range (${validated.effectiveFrom} to ${validated.effectiveTo ?? "indefinite"}) overlaps with an existing negotiated contract (${eFromStr} to ${eToStr}) at ₹${Number(c.price).toFixed(2)}. Existing contracts must not be silently overwritten; please adjust the dates or update the existing contract.`,
          };
        }
      }

      const record = await tx.customerFruitPrice.create({
        data: {
          userId: user.id,
          clientId,
          fruitId: validated.fruitId,
          unitId: validated.unitId,
          price: validated.price,
          effectiveFrom: fromDate,
          effectiveTo: toDate,
          notes: validated.notes ?? null,
        },
        include: {
          fruit: { select: { name: true, variety: true } },
          unit: { select: { code: true } },
        },
      });

      await recordAuditLog(
        {
          userId: user.id,
          entityType: "CUSTOMER_PRICE",
          entityId: record.id,
          action: "CREATED",
          actorId: user.id,
          changes: { after: record },
          notes: `Negotiated price set for ${client.name}: ${fruit.name} @ ₹${validated.price}/${unit.code} (${validated.effectiveFrom} to ${validated.effectiveTo ?? "indefinite"})`,
        },
        tx
      );

      return { conflict: false as const, record };
    });

    if (result.conflict) {
      return jsonError(result.message, 409);
    }

    return NextResponse.json(result.record, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return validationErrorResponse(error);
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON payload", 400);
    }
    if (getPrismaErrorCode(error) === "P2002") {
      return jsonError(
        "A negotiated price with this effective start date already exists for this fruit and unit",
        409
      );
    }

    console.error("[POST /api/clients/[id]/prices] Error creating negotiated rate:", error);
    return jsonError("Failed to save negotiated price", 500);
  }
}
