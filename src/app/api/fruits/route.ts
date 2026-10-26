import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { fruitSchema } from "@/lib/validations";
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
 * GET /api/fruits
 * List fruits for the authenticated tenant with search and category filtering.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim();
    const category = searchParams.get("category")?.trim();
    const isActiveParam = searchParams.get("isActive");
    const includeArchived = searchParams.get("includeArchived") === "true";

    // Auto-seed units if this is the tenant's first fruit catalogue visit
    await ensureDefaultUnits(user.id);

    const whereClause: any = {
      userId: user.id,
      ...(includeArchived ? {} : { isArchived: false }),
    };

    if (isActiveParam !== null && isActiveParam !== undefined) {
      whereClause.isActive = isActiveParam === "true";
    }

    if (category && category !== "ALL") {
      whereClause.category = category;
    }

    if (q) {
      whereClause.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { variety: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
        { hsnCode: { contains: q, mode: "insensitive" } },
      ];
    }

    const fruits = await prisma.fruit.findMany({
      where: whereClause,
      include: {
        defaultUnit: true,
        _count: {
          select: {
            dailyPrices: true,
            customerPrices: true,
            invoiceItems: true,
          },
        },
      },
      orderBy: [{ name: "asc" }, { variety: "asc" }],
    });

    return NextResponse.json(fruits, { status: 200 });
  } catch (error) {
    console.error("[GET /api/fruits] Error fetching fruit catalogue:", error);
    return jsonError("Failed to fetch fruit catalogue", 500);
  }
}

/**
 * POST /api/fruits
 * Create a new fruit in the catalogue.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const body = await request.json();
    const validated = fruitSchema.parse(body);

    // If a default unit is chosen, ensure it belongs to this tenant
    let defaultUnitId = validated.defaultUnitId ?? null;
    if (defaultUnitId) {
      const unit = await prisma.fruitUnit.findFirst({
        where: { id: defaultUnitId, userId: user.id },
      });
      if (!unit) {
        return jsonError("Selected default unit does not exist", 400);
      }
    } else {
      // Pick the tenant's default unit if not specified
      const fallbackUnit = await prisma.fruitUnit.findFirst({
        where: { userId: user.id, isDefault: true, isArchived: false },
      });
      if (fallbackUnit) {
        defaultUnitId = fallbackUnit.id;
      }
    }

    const fruit = await prisma.$transaction(async (tx) => {
      const created = await tx.fruit.create({
        data: {
          userId: user.id,
          name: validated.name,
          variety: validated.variety ?? null,
          category: validated.category ?? null,
          hsnCode: validated.hsnCode || "0808",
          defaultUnitId,
          isActive: validated.isActive ?? true,
          isArchived: validated.isArchived ?? false,
        },
        include: {
          defaultUnit: true,
        },
      });

      await recordAuditLog(
        {
          userId: user.id,
          entityType: "FRUIT",
          entityId: created.id,
          action: "CREATED",
          actorId: user.id,
          changes: { after: created },
        },
        tx
      );

      return created;
    });

    return NextResponse.json(fruit, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return validationErrorResponse(error);
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON payload", 400);
    }
    if (getPrismaErrorCode(error) === "P2002") {
      return jsonError("A fruit with this name and variety already exists in your catalogue", 409);
    }

    console.error("[POST /api/fruits] Error creating fruit:", error);
    return jsonError("Failed to create fruit entry", 500);
  }
}
