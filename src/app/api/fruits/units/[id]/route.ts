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

/**
 * PATCH /api/fruits/units/[id]
 * Update a fruit unit's name, code, default status, or archive state.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const body = await request.json();
    const partialSchema = fruitUnitSchema.partial();
    const validated = partialSchema.parse(body);

    const existing = await prisma.fruitUnit.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return jsonError("Unit not found", 404);
    }

    const updated = await prisma.$transaction(async (tx) => {
      // If marking as default, unset other units
      if (validated.isDefault) {
        await tx.fruitUnit.updateMany({
          where: { userId: user.id, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      const res = await tx.fruitUnit.update({
        where: { id },
        data: {
          name: validated.name !== undefined ? validated.name : undefined,
          code: validated.code !== undefined ? validated.code.toLowerCase() : undefined,
          isDefault: validated.isDefault !== undefined ? validated.isDefault : undefined,
          isArchived: validated.isArchived !== undefined ? validated.isArchived : undefined,
        },
      });

      await recordAuditLog(
        {
          userId: user.id,
          entityType: "FRUIT_UNIT",
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
      return jsonError("Another unit already uses this code", 409);
    }

    console.error("[PATCH /api/fruits/units/[id]] Error updating unit:", error);
    return jsonError("Failed to update fruit unit", 500);
  }
}

/**
 * DELETE /api/fruits/units/[id]
 * Safely archive a fruit unit (preserves historical ledger & invoice foreign keys).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const existing = await prisma.fruitUnit.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return jsonError("Unit not found", 404);
    }

    // Archiving is the safe delete pattern for wholesale produce units
    const archived = await prisma.$transaction(async (tx) => {
      const res = await tx.fruitUnit.update({
        where: { id },
        data: { isArchived: true, isDefault: false },
      });

      await recordAuditLog(
        {
          userId: user.id,
          entityType: "FRUIT_UNIT",
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
    console.error("[DELETE /api/fruits/units/[id]] Error archiving unit:", error);
    return jsonError("Failed to archive fruit unit", 500);
  }
}
