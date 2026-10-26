import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  validationErrorResponse,
  jsonError,
  requireUser,
  unauthorized,
} from "@/lib/api-helpers";
import { recordAuditLog } from "@/lib/audit";

const updateCustomerPriceSchema = z.object({
  price: z.coerce.number().min(0).multipleOf(0.01).optional(),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .optional()
    .nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/**
 * PATCH /api/clients/[id]/prices/[priceId]
 * Update a customer's negotiated price, change expiration date, or add notes.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; priceId: string }> }
) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { id: clientId, priceId } = await params;
    const body = await request.json();
    const validated = updateCustomerPriceSchema.parse(body);

    const existing = await prisma.customerFruitPrice.findFirst({
      where: {
        id: priceId,
        clientId,
        userId: user.id,
      },
    });

    if (!existing) {
      return jsonError("Negotiated rate contract not found", 404);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.customerFruitPrice.update({
        where: { id: priceId },
        data: {
          price: validated.price !== undefined ? validated.price : undefined,
          effectiveTo:
            validated.effectiveTo !== undefined
              ? validated.effectiveTo
                ? new Date(`${validated.effectiveTo}T00:00:00.000Z`)
                : null
              : undefined,
          notes: validated.notes !== undefined ? validated.notes : undefined,
        },
      });

      await recordAuditLog(
        {
          userId: user.id,
          entityType: "CUSTOMER_PRICE",
          entityId: priceId,
          action: "UPDATED",
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

    console.error("[PATCH /api/clients/[id]/prices/[priceId]] Error:", error);
    return jsonError("Failed to update negotiated rate", 500);
  }
}

/**
 * DELETE /api/clients/[id]/prices/[priceId]
 * Remove or expire a negotiated rate contract.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; priceId: string }> }
) {
  try {
    const user = await requireUser();
    if (!user) return unauthorized();

    const { id: clientId, priceId } = await params;

    const existing = await prisma.customerFruitPrice.findFirst({
      where: {
        id: priceId,
        clientId,
        userId: user.id,
      },
    });

    if (!existing) {
      return jsonError("Negotiated rate contract not found", 404);
    }

    await prisma.$transaction(async (tx) => {
      await tx.customerFruitPrice.delete({
        where: { id: priceId },
      });

      await recordAuditLog(
        {
          userId: user.id,
          entityType: "CUSTOMER_PRICE",
          entityId: priceId,
          action: "DELETED",
          actorId: user.id,
          changes: { before: existing },
          notes: `Deleted negotiated price for client ${clientId}`,
        },
        tx
      );
    });

    return NextResponse.json({ message: "Negotiated rate removed successfully" }, { status: 200 });
  } catch (error) {
    console.error("[DELETE /api/clients/[id]/prices/[priceId]] Error:", error);
    return jsonError("Failed to remove negotiated rate", 500);
  }
}
