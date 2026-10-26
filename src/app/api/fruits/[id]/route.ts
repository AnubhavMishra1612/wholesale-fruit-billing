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

/**
 * GET /api/fruits/[id]
 * Retrieve single fruit details with default unit and recent daily prices.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const fruit = await prisma.fruit.findFirst({
      where: { id, userId: user.id },
      include: {
        defaultUnit: true,
        dailyPrices: {
          take: 10,
          orderBy: { effectiveDate: "desc" },
          include: { unit: true },
        },
      },
    });

    if (!fruit) {
      return jsonError("Fruit not found", 404);
    }

    return NextResponse.json(fruit, { status: 200 });
  } catch (error) {
    console.error("[GET /api/fruits/[id]] Error fetching fruit:", error);
    return jsonError("Failed to fetch fruit details", 500);
  }
}

/**
 * PATCH /api/fruits/[id]
 * Update fruit attributes, toggle active status, or archive.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const existing = await prisma.fruit.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return jsonError("Fruit not found", 404);
    }

    const body = await request.json();
    const partialSchema = fruitSchema.partial();
    const validated = partialSchema.parse(body);

    if (validated.defaultUnitId) {
      const unit = await prisma.fruitUnit.findFirst({
        where: { id: validated.defaultUnitId, userId: user.id },
      });
      if (!unit) {
        return jsonError("Selected unit does not belong to this account", 400);
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.fruit.update({
        where: { id },
        data: {
          name: validated.name !== undefined ? validated.name : undefined,
          variety: validated.variety !== undefined ? validated.variety : undefined,
          category: validated.category !== undefined ? validated.category : undefined,
          hsnCode: validated.hsnCode !== undefined ? validated.hsnCode : undefined,
          defaultUnitId: validated.defaultUnitId !== undefined ? validated.defaultUnitId : undefined,
          isActive: validated.isActive !== undefined ? validated.isActive : undefined,
          isArchived: validated.isArchived !== undefined ? validated.isArchived : undefined,
        },
        include: {
          defaultUnit: true,
        },
      });

      await recordAuditLog(
        {
          userId: user.id,
          entityType: "FRUIT",
          entityId: id,
          action: validated.isArchived ? "ARCHIVED" : "UPDATED",
          actorId: user.id,
          changes: { before: existing, after: res },
        },
        tx
      );

      return res;
    });

    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    if (error instanceof ZodError) {
      return validationErrorResponse(error);
    }
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON payload", 400);
    }
    if (getPrismaErrorCode(error) === "P2002") {
      return jsonError("A fruit with this name and variety already exists", 409);
    }

    console.error("[PATCH /api/fruits/[id]] Error updating fruit:", error);
    return jsonError("Failed to update fruit details", 500);
  }
}

/**
 * DELETE /api/fruits/[id]
 * Safely archive a fruit (preserves historical invoices & ledger line items).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const existing = await prisma.fruit.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return jsonError("Fruit not found", 404);
    }

    const archived = await prisma.$transaction(async (tx) => {
      const res = await tx.fruit.update({
        where: { id },
        data: { isArchived: true, isActive: false },
      });

      await recordAuditLog(
        {
          userId: user.id,
          entityType: "FRUIT",
          entityId: id,
          action: "ARCHIVED",
          actorId: user.id,
          changes: { before: existing, after: res },
        },
        tx
      );

      return res;
    });

    return NextResponse.json(archived, { status: 200 });
  } catch (error) {
    console.error("[DELETE /api/fruits/[id]] Error archiving fruit:", error);
    return jsonError("Failed to archive fruit", 500);
  }
}
