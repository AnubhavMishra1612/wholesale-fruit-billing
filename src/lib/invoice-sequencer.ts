import { Prisma } from "@prisma/client";

export interface InvoiceNumberOptions {
  prefix?: string;
  separator?: string;
  pad?: number;
}

/**
 * Returns today's date formatted as YYYYMMDD in Asia/Calcutta (IST).
 */
export function getIstDateKey(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Calcutta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

/**
 * Concurrency-safe, tenant-scoped invoice number allocator backed by the DailySequence table.
 *
 * Guarantees:
 * 1. Monotonic sequential numbering per tenant, prefix, and date (IST).
 * 2. Concurrency safety: atomic row-level updates inside the transaction prevent race conditions.
 * 3. Seed safety: if invoices already exist today for this tenant prior to DailySequence adoption,
 *    initializes lastSeq from the highest existing invoice number today.
 */
export async function allocateNextInvoiceNumber(
  tx: Prisma.TransactionClient,
  userId: string,
  options: InvoiceNumberOptions = {}
): Promise<string> {
  const prefix =
    (options.prefix || "INV")
      .replace(/[^\w-]+/g, "")
      .toUpperCase()
      .slice(0, 12) || "INV";
  const separator = options.separator || "-";
  const pad = Math.max(1, Math.min(10, Number(options.pad) || 4));
  const dateKey = getIstDateKey();

  // Check if a sequence record already exists for this tenant, dateKey, and prefix
  const existingSeq = await tx.dailySequence.findUnique({
    where: {
      daily_sequence_per_tenant: {
        userId,
        dateKey,
        prefix,
      },
    },
    select: { lastSeq: true },
  });

  let seqNum: number;
  if (!existingSeq) {
    // First sequence allocation today for this tenant:
    // Check if any existing invoices already used this prefix and dateKey today.
    const prefixPattern = `${prefix}${separator}${dateKey}${separator}`;
    const latestToday = await tx.invoice.findFirst({
      where: {
        userId,
        invoiceNumber: { startsWith: prefixPattern },
      },
      orderBy: { invoiceNumber: "desc" },
      select: { invoiceNumber: true },
    });

    let maxExisting = 0;
    if (latestToday?.invoiceNumber) {
      const suffix = latestToday.invoiceNumber.slice(prefixPattern.length);
      const parsed = parseInt(suffix, 10);
      if (!isNaN(parsed) && parsed > 0) {
        maxExisting = parsed;
      }
    }

    const created = await tx.dailySequence.upsert({
      where: {
        daily_sequence_per_tenant: {
          userId,
          dateKey,
          prefix,
        },
      },
      create: {
        userId,
        dateKey,
        prefix,
        lastSeq: maxExisting + 1,
      },
      update: {
        lastSeq: { increment: 1 },
      },
      select: { lastSeq: true },
    });
    seqNum = created.lastSeq;
  } else {
    // Atomic increment using row lock in current transaction
    const updated = await tx.dailySequence.update({
      where: {
        daily_sequence_per_tenant: {
          userId,
          dateKey,
          prefix,
        },
      },
      data: {
        lastSeq: { increment: 1 },
      },
      select: { lastSeq: true },
    });
    seqNum = updated.lastSeq;
  }

  const sequenceStr = String(seqNum).padStart(pad, "0");
  return `${prefix}${separator}${dateKey}${separator}${sequenceStr}`;
}
