-- Migration: 20261026160000_tenant_scoped_invoice_number
-- Scopes invoice number uniqueness to tenant (userId, invoiceNumber).
-- Preserves all existing invoices and records without data loss.

-- DropIndex: Remove global unique index on invoiceNumber
DROP INDEX IF EXISTS "invoices_invoiceNumber_key";

-- CreateIndex: Create composite tenant-scoped unique index
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_userId_invoiceNumber_key" ON "invoices"("userId", "invoiceNumber");
