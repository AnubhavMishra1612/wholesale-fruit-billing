-- ============================================================
-- Wholesale Fruit Billing Adaptation Migration
-- Migration: 20261025163000_wholesale_fruit_billing
-- Preserves existing invoices, clients, settings, users, and activities.
-- Transaction atomicity managed natively by Prisma Migrate.
-- ============================================================


-- Step 1: Extension (Optional / Safe)
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'btree_gist extension could not be loaded; application advisory locks will be used as fallback.';
END $$;

-- Step 2: Update existing Enum InvoiceStatus
-- POSTGRESQL TRANSACTION-SAFETY AUDIT & EXECUTION RULES:
-- 1. PostgreSQL 12+: ALTER TYPE ... ADD VALUE is fully transaction-safe inside
--    a migration block PROVIDED that the newly added values are NOT referenced
--    in subsequent DML/DDL within the same transaction block (PostgreSQL error 55P04:
--    "unsafe use of new value ... of enum type").
-- 2. Audit Verification: The newly added values ('VOID', 'PARTIALLY_PAID') are NOT
--    referenced anywhere in this migration script.
-- 3. Blind text casting (e.g., status::text = '...') was explicitly rejected because:
--    (a) The values queried in Step 8 ('PAID', 'PENDING', 'DRAFT', 'OVERDUE') are pre-existing
--        members from migration 20260728103958_init and do not trigger 55P04.
--    (b) Text casting bypasses enum type-safety and index scans without addressing root PG rules.
-- 4. Remaining Risk: PostgreSQL 11 and older does NOT allow ALTER TYPE ... ADD VALUE inside
--    any transaction block (error 25001). This project targets modern PostgreSQL (12+).
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'VOID';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID';

ALTER TYPE "InvoiceActivityType" ADD VALUE IF NOT EXISTS 'VOIDED';
ALTER TYPE "InvoiceActivityType" ADD VALUE IF NOT EXISTS 'EMAIL_DELIVERED';
ALTER TYPE "InvoiceActivityType" ADD VALUE IF NOT EXISTS 'EMAIL_BOUNCED';
ALTER TYPE "InvoiceActivityType" ADD VALUE IF NOT EXISTS 'EMAIL_OPENED';

-- Step 3: Create New Enums
DO $$ BEGIN
    CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentStatus" AS ENUM ('COMPLETED', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "AllocationStatus" AS ENUM ('ACTIVE', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "RefundStatus" AS ENUM ('COMPLETED', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "AdjustmentType" AS ENUM ('CREDIT_NOTE', 'DEBIT_NOTE', 'BAD_DEBT_WRITE_OFF');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Step 4: Alter Existing Tables (In-Place Modifications)

-- 4.0. Users (Password Reset Support)
ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "resetToken" TEXT,
    ADD COLUMN IF NOT EXISTS "resetTokenExpires" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "users_resetToken_key" ON "users"("resetToken");

-- 4.1. Settings
ALTER TABLE "settings"
    ADD COLUMN IF NOT EXISTS "mandiLicenseNo" TEXT,
    ADD COLUMN IF NOT EXISTS "gstin" TEXT,
    ADD COLUMN IF NOT EXISTS "receiptPrefix" TEXT NOT NULL DEFAULT 'RCP',
    ADD COLUMN IF NOT EXISTS "taxLabel" TEXT NOT NULL DEFAULT 'GST',
    ADD COLUMN IF NOT EXISTS "logoData" TEXT,
    ADD COLUMN IF NOT EXISTS "logoContentType" TEXT,
    ADD COLUMN IF NOT EXISTS "brandColor" TEXT NOT NULL DEFAULT '#173D32',
    ADD COLUMN IF NOT EXISTS "defaultNotes" TEXT,
    ADD COLUMN IF NOT EXISTS "defaultDueDays" INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    ADD COLUMN IF NOT EXISTS "invoiceSeparator" TEXT NOT NULL DEFAULT '-',
    ADD COLUMN IF NOT EXISTS "invoicePad" INTEGER NOT NULL DEFAULT 4;

-- 4.2. Clients
ALTER TABLE "clients"
    ADD COLUMN IF NOT EXISTS "notes" TEXT,
    ADD COLUMN IF NOT EXISTS "dueDays" INTEGER,
    ADD COLUMN IF NOT EXISTS "portalToken" TEXT,
    ADD COLUMN IF NOT EXISTS "openingBalance" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- Backfill portalToken for any client row missing a token
UPDATE "clients" SET "portalToken" = md5(random()::text || id::text) WHERE "portalToken" IS NULL;
ALTER TABLE "clients" ALTER COLUMN "portalToken" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "clients_portalToken_key" ON "clients"("portalToken");
CREATE INDEX IF NOT EXISTS "clients_userId_isArchived_idx" ON "clients"("userId", "isArchived");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_id_userId_key') THEN
        ALTER TABLE "clients" ADD CONSTRAINT "clients_id_userId_key" UNIQUE ("id", "userId");
    END IF;
END $$;

-- 4.3. Invoices
ALTER TABLE "invoices"
    ADD COLUMN IF NOT EXISTS "paidAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "balanceAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "discountType" "DiscountType",
    ADD COLUMN IF NOT EXISTS "discountValue" DECIMAL(12, 2),
    ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "taxLabel" TEXT NOT NULL DEFAULT 'GST';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_id_userId_clientId_key') THEN
        ALTER TABLE "invoices" ADD CONSTRAINT "invoices_id_userId_clientId_key" UNIQUE ("id", "userId", "clientId");
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_id_userId_key') THEN
        ALTER TABLE "invoices" ADD CONSTRAINT "invoices_id_userId_key" UNIQUE ("id", "userId");
    END IF;
END $$;

-- 4.4. Invoice Items
ALTER TABLE "invoice_items"
    ALTER COLUMN "quantity" TYPE DECIMAL(10, 3) USING "quantity"::numeric(10, 3),
    ALTER COLUMN "quantity" SET DEFAULT 1.000,
    ADD COLUMN IF NOT EXISTS "fruitId" TEXT,
    ADD COLUMN IF NOT EXISTS "fruitName" TEXT,
    ADD COLUMN IF NOT EXISTS "fruitVariety" TEXT,
    ADD COLUMN IF NOT EXISTS "unitId" TEXT,
    ADD COLUMN IF NOT EXISTS "unitName" TEXT,
    ADD COLUMN IF NOT EXISTS "unitPriceSnapshot" DECIMAL(12, 2);

CREATE INDEX IF NOT EXISTS "invoice_items_fruitId_idx" ON "invoice_items"("fruitId");

-- 4.5. Recurring Items
ALTER TABLE "recurring_items"
    ALTER COLUMN "quantity" TYPE DECIMAL(10, 3) USING "quantity"::numeric(10, 3),
    ALTER COLUMN "quantity" SET DEFAULT 1.000,
    ADD COLUMN IF NOT EXISTS "fruitId" TEXT,
    ADD COLUMN IF NOT EXISTS "unitId" TEXT,
    ADD COLUMN IF NOT EXISTS "unitName" TEXT;

-- Step 5: Create New Tables

-- 5.1. Daily Sequences
CREATE TABLE IF NOT EXISTS "daily_sequences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_sequences_userId_dateKey_prefix_key" ON "daily_sequences"("userId", "dateKey", "prefix");
CREATE INDEX IF NOT EXISTS "daily_sequences_userId_dateKey_idx" ON "daily_sequences"("userId", "dateKey");

-- 5.2. Fruit Units
CREATE TABLE IF NOT EXISTS "fruit_units" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fruit_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fruit_units_id_userId_key" ON "fruit_units"("id", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "fruit_units_userId_code_key" ON "fruit_units"("userId", "code");
CREATE INDEX IF NOT EXISTS "fruit_units_userId_isArchived_idx" ON "fruit_units"("userId", "isArchived");

-- 5.3. Fruits
CREATE TABLE IF NOT EXISTS "fruits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variety" TEXT,
    "category" TEXT,
    "hsnCode" TEXT DEFAULT '0808',
    "defaultUnitId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fruits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fruits_id_userId_key" ON "fruits"("id", "userId");
CREATE INDEX IF NOT EXISTS "fruits_userId_isActive_isArchived_idx" ON "fruits"("userId", "isActive", "isArchived");
CREATE INDEX IF NOT EXISTS "fruits_userId_name_idx" ON "fruits"("userId", "name");

-- 5.4. Daily Fruit Prices
CREATE TABLE IF NOT EXISTS "daily_fruit_prices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fruitId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "price" DECIMAL(12, 2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_fruit_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_fruit_prices_userId_fruitId_unitId_effectiveDate_key" ON "daily_fruit_prices"("userId", "fruitId", "unitId", "effectiveDate");
CREATE INDEX IF NOT EXISTS "daily_fruit_prices_userId_effectiveDate_idx" ON "daily_fruit_prices"("userId", "effectiveDate");
CREATE INDEX IF NOT EXISTS "daily_fruit_prices_fruitId_effectiveDate_idx" ON "daily_fruit_prices"("fruitId", "effectiveDate");

-- 5.5. Customer Fruit Prices
CREATE TABLE IF NOT EXISTS "customer_fruit_prices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fruitId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "price" DECIMAL(12, 2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_fruit_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_fruit_prices_userId_clientId_fruitId_unitId_effectiveFrom_key" ON "customer_fruit_prices"("userId", "clientId", "fruitId", "unitId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "customer_fruit_prices_userId_clientId_effectiveFrom_idx" ON "customer_fruit_prices"("userId", "clientId", "effectiveFrom");

-- 5.6. Payments
CREATE TABLE IF NOT EXISTS "payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL,
    "allocatedAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "refundedAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "unallocatedAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "referenceNumber" TEXT,
    "notes" TEXT,
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payments_receiptNumber_key" ON "payments"("receiptNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_id_userId_clientId_key" ON "payments"("id", "userId", "clientId");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_id_userId_key" ON "payments"("id", "userId");
CREATE INDEX IF NOT EXISTS "payments_userId_clientId_idx" ON "payments"("userId", "clientId");
CREATE INDEX IF NOT EXISTS "payments_userId_paymentDate_idx" ON "payments"("userId", "paymentDate");
CREATE INDEX IF NOT EXISTS "payments_userId_status_idx" ON "payments"("userId", "status");

-- 5.7. Payment Allocations
CREATE TABLE IF NOT EXISTS "payment_allocations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "reversedBy" TEXT,
    "notes" TEXT,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payment_allocations_userId_invoiceId_status_idx" ON "payment_allocations"("userId", "invoiceId", "status");
CREATE INDEX IF NOT EXISTS "payment_allocations_paymentId_status_idx" ON "payment_allocations"("paymentId", "status");

-- 5.8. Payment Refunds
CREATE TABLE IF NOT EXISTS "payment_refunds" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "refundNumber" TEXT NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL,
    "refundDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "status" "RefundStatus" NOT NULL DEFAULT 'COMPLETED',
    "referenceNumber" TEXT,
    "reason" TEXT NOT NULL,
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_refunds_refundNumber_key" ON "payment_refunds"("refundNumber");
CREATE INDEX IF NOT EXISTS "payment_refunds_userId_clientId_idx" ON "payment_refunds"("userId", "clientId");
CREATE INDEX IF NOT EXISTS "payment_refunds_userId_refundDate_idx" ON "payment_refunds"("userId", "refundDate");

-- 5.9. Ledger Adjustments
CREATE TABLE IF NOT EXISTS "ledger_adjustments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ledger_adjustments_userId_clientId_effectiveDate_idx" ON "ledger_adjustments"("userId", "clientId", "effectiveDate");

-- 5.10. Audit Logs
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "ip" TEXT,
    "changes" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_userId_entityType_entityId_idx" ON "audit_logs"("userId", "entityType", "entityId");
CREATE INDEX IF NOT EXISTS "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- 5.11. Expenses
CREATE TABLE IF NOT EXISTS "expenses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "expenses_userId_date_idx" ON "expenses"("userId", "date");
CREATE INDEX IF NOT EXISTS "expenses_userId_category_idx" ON "expenses"("userId", "category");

-- Step 6: Add Foreign Key Constraints (Idempotent via explicit pg_constraint existence checks)

-- Daily Sequences FK
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_sequences_userId_fkey') THEN
        ALTER TABLE "daily_sequences" ADD CONSTRAINT "daily_sequences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Fruit Units FK
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fruit_units_userId_fkey') THEN
        ALTER TABLE "fruit_units" ADD CONSTRAINT "fruit_units_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Fruits FK
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fruits_userId_fkey') THEN
        ALTER TABLE "fruits" ADD CONSTRAINT "fruits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fruits_defaultUnitId_fkey') THEN
        ALTER TABLE "fruits" ADD CONSTRAINT "fruits_defaultUnitId_fkey" FOREIGN KEY ("defaultUnitId") REFERENCES "fruit_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Daily Fruit Prices FKs (Composite tenant protection)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_fruit_prices_userId_fkey') THEN
        ALTER TABLE "daily_fruit_prices" ADD CONSTRAINT "daily_fruit_prices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_fruit_prices_fruitId_userId_fkey') THEN
        ALTER TABLE "daily_fruit_prices" ADD CONSTRAINT "daily_fruit_prices_fruitId_userId_fkey" FOREIGN KEY ("fruitId", "userId") REFERENCES "fruits"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_fruit_prices_unitId_userId_fkey') THEN
        ALTER TABLE "daily_fruit_prices" ADD CONSTRAINT "daily_fruit_prices_unitId_userId_fkey" FOREIGN KEY ("unitId", "userId") REFERENCES "fruit_units"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Customer Fruit Prices FKs (Composite tenant protection)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_fruit_prices_userId_fkey') THEN
        ALTER TABLE "customer_fruit_prices" ADD CONSTRAINT "customer_fruit_prices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_fruit_prices_clientId_userId_fkey') THEN
        ALTER TABLE "customer_fruit_prices" ADD CONSTRAINT "customer_fruit_prices_clientId_userId_fkey" FOREIGN KEY ("clientId", "userId") REFERENCES "clients"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_fruit_prices_fruitId_userId_fkey') THEN
        ALTER TABLE "customer_fruit_prices" ADD CONSTRAINT "customer_fruit_prices_fruitId_userId_fkey" FOREIGN KEY ("fruitId", "userId") REFERENCES "fruits"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_fruit_prices_unitId_userId_fkey') THEN
        ALTER TABLE "customer_fruit_prices" ADD CONSTRAINT "customer_fruit_prices_unitId_userId_fkey" FOREIGN KEY ("unitId", "userId") REFERENCES "fruit_units"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Update Invoices -> Clients FK to Restrict delete (Composite tenant protection)
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_clientId_fkey";
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_clientId_userId_fkey') THEN
        ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clientId_userId_fkey" FOREIGN KEY ("clientId", "userId") REFERENCES "clients"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Update RecurringProfiles -> Clients FK to Restrict delete (Composite tenant protection)
ALTER TABLE "recurring_profiles" DROP CONSTRAINT IF EXISTS "recurring_profiles_clientId_fkey";
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_profiles_clientId_userId_fkey') THEN
        ALTER TABLE "recurring_profiles" ADD CONSTRAINT "recurring_profiles_clientId_userId_fkey" FOREIGN KEY ("clientId", "userId") REFERENCES "clients"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Invoice Items FKs
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_fruitId_fkey') THEN
        ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_fruitId_fkey" FOREIGN KEY ("fruitId") REFERENCES "fruits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_unitId_fkey') THEN
        ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "fruit_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Payments FKs
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_userId_fkey') THEN
        ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_clientId_userId_fkey') THEN
        ALTER TABLE "payments" ADD CONSTRAINT "payments_clientId_userId_fkey" FOREIGN KEY ("clientId", "userId") REFERENCES "clients"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Payment Allocations FKs (Composite tenant and customer protection)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_allocations_userId_fkey') THEN
        ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_allocations_clientId_userId_fkey') THEN
        ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_clientId_userId_fkey" FOREIGN KEY ("clientId", "userId") REFERENCES "clients"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_allocations_paymentId_userId_clientId_fkey') THEN
        ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_userId_clientId_fkey" FOREIGN KEY ("paymentId", "userId", "clientId") REFERENCES "payments"("id", "userId", "clientId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_allocations_invoiceId_userId_clientId_fkey') THEN
        ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoiceId_userId_clientId_fkey" FOREIGN KEY ("invoiceId", "userId", "clientId") REFERENCES "invoices"("id", "userId", "clientId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Payment Refunds FKs
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_refunds_userId_fkey') THEN
        ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_refunds_clientId_userId_fkey') THEN
        ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_clientId_userId_fkey" FOREIGN KEY ("clientId", "userId") REFERENCES "clients"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_refunds_paymentId_userId_clientId_fkey') THEN
        ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_paymentId_userId_clientId_fkey" FOREIGN KEY ("paymentId", "userId", "clientId") REFERENCES "payments"("id", "userId", "clientId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Ledger Adjustments FKs
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_adjustments_userId_fkey') THEN
        ALTER TABLE "ledger_adjustments" ADD CONSTRAINT "ledger_adjustments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_adjustments_clientId_userId_fkey') THEN
        ALTER TABLE "ledger_adjustments" ADD CONSTRAINT "ledger_adjustments_clientId_userId_fkey" FOREIGN KEY ("clientId", "userId") REFERENCES "clients"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Audit Logs FK
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_userId_fkey') THEN
        ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Recurring Items FKs
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_items_fruitId_fkey') THEN
        ALTER TABLE "recurring_items" ADD CONSTRAINT "recurring_items_fruitId_fkey" FOREIGN KEY ("fruitId") REFERENCES "fruits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_items_unitId_fkey') THEN
        ALTER TABLE "recurring_items" ADD CONSTRAINT "recurring_items_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "fruit_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Expenses FK
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_userId_fkey') THEN
        ALTER TABLE "expenses" ADD CONSTRAINT "expenses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Step 7: Conditional Exclusion Constraint for Customer Fruit Prices
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
        ALTER TABLE "customer_fruit_prices"
        ADD CONSTRAINT "no_overlapping_customer_prices"
        EXCLUDE USING gist (
            "userId" WITH =,
            "clientId" WITH =,
            "fruitId" WITH =,
            "unitId" WITH =,
            daterange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::date), '[]') WITH &&
        );
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Exclusion constraint skipped; advisory locks will be enforced in service layer.';
END $$;

-- Step 8: Historical Invoice Balance Backfill (Strictly Preserves Historical Data)
-- Note: Uses only pre-existing enum values ('PAID', 'PENDING', 'DRAFT')
-- from migration 20260728103958_init. Overdue invoices are stored as 'PENDING'
-- with dueDate < CURRENT_DATE. Does NOT reference newly added 'VOID' or 'PARTIALLY_PAID',
-- fully complying with PostgreSQL 12+ same-transaction enum usage restrictions.
UPDATE "invoices"
SET "paidAmount" = "totalAmount", "balanceAmount" = 0.00
WHERE "status" = 'PAID';

UPDATE "invoices"
SET "paidAmount" = 0.00, "balanceAmount" = "totalAmount"
WHERE "status" = 'PENDING';

UPDATE "invoices"
SET "paidAmount" = 0.00, "balanceAmount" = 0.00
WHERE "status" = 'DRAFT';


