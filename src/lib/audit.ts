import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface LogAuditParams {
  userId: string;
  entityType:
    | "FRUIT"
    | "FRUIT_UNIT"
    | "DAILY_PRICE"
    | "CUSTOMER_PRICE"
    | "PAYMENT"
    | "ALLOCATION"
    | "INVOICE"
    | "REFUND"
    | "LEDGER_ADJUSTMENT";
  entityId: string;
  action: "CREATED" | "UPDATED" | "ARCHIVED" | "DELETED" | "VOIDED" | "REVERSED" | "BULK_UPDATED";
  actorId?: string | null;
  ip?: string | null;
  changes?: Record<string, unknown> | null;
  notes?: string | null;
}

/**
 * Record an immutable audit log entry for financial or master-data modifications.
 * Supports passing an ongoing Prisma transaction client to ensure atomicity with data mutations.
 */
export async function recordAuditLog(
  params: LogAuditParams,
  tx?: Prisma.TransactionClient
) {
  const db = tx ?? prisma;
  try {
    return await db.auditLog.create({
      data: {
        userId: params.userId,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        actorId: params.actorId ?? null,
        ip: params.ip ?? null,
        changes: params.changes ? (params.changes as Prisma.InputJsonValue) : undefined,
        notes: params.notes ?? null,
      },
    });
  } catch (error) {
    // We log the error but don't fail the primary transaction unless explicitly needed
    console.error("[AuditLog Error] Failed to write audit log:", error);
    return null;
  }
}
