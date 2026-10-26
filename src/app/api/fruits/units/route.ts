import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { fruitUnitSchema } from "@/lib/validations";
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
 * GET /api/fruits/units
 * List fruit units for the authenticated tenant.
 * Auto-initializes standard mandi units if tenant has none.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get("includeArchived") === "true";

    await ensureDefaultUnits(user.id);

    const units = await prisma.fruitUnit.findMany({
      where: {
        userId: user.id,
        ...(includeArchived ? {} : { isArchived: false }),
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      include: {
        _count: {
          select: {
            fruits: true,
            dailyPrices: true,
            customerPrices: true,
          },
        },
      },
    });

    return NextResponse.json(units, { status: 200 });
  } catch (error) {
    console.error("[GET /api/fruits/units] Error fetching units:", error);
    return jsonError("Failed to fetch fruit units", 500);
  }
}

/**
 * POST /api/fruits/units
 * Create a new custom or standard unit of measurement.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const body = await request.json();
    const validated = fruitUnitSchema.parse(body);

    const unit = await prisma.$transaction(async (tx) => {
      // If marked as default, unset any existing default unit for this user
      if (validated.isDefault) {
        await tx.fruitUnit.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.fruitUnit.create({
        data: {
          userId: user.id,
          name: validated.name,
          code: validated.code.toLowerCase(),
          isDefault: validated.isDefault,
          isArchived: validated.isArchived ?? false,
        },
      });

      await recordAuditLog(
        {
          userId: user.id,
          entityType: "FRUIT_UNIT",
          entityId: created.id,
          action: "CREATED",
          actorId: user.id,
          changes: { after: created },
        },
        tx
      );

      return created;
    });

    return NextResponse.json(unit, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return validationErrorResponse(error);
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON payload", 400);
    }
    if (getPrismaErrorCode(error) === "P2002") {
      return jsonError("A unit with this code already exists in your account", 409);
    }

    console.error("[POST /api/fruits/units] Error creating unit:", error);
    return jsonError("Failed to create fruit unit", 500);
  }
}
