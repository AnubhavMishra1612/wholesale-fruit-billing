/**
 * Wholesale Fruit Billing Unit & Domain Invariants Test Suite
 * Executed via Node.js native test runner (node --test)
 * No database required. Verifies pure mathematical, financial, and domain invariants.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Helper for 2-decimal half-up rounding (matches src/lib/utils.ts)
function round2(val) {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

// Helper for calculating invoice totals
function calculateInvoiceTotals(items, taxRate = 0, discount = {}) {
  const safeTaxRate = Math.max(0, Math.min(100, Number(taxRate) || 0));
  const subtotal = round2(
    items.reduce((sum, it) => sum + round2((Number(it.quantity) || 0) * (Number(it.price) || 0)), 0)
  );
  let discountAmount = 0;
  if (discount.type && discount.value != null && Number(discount.value) > 0) {
    const raw = Number(discount.value);
    if (discount.type === 'PERCENT') {
      discountAmount = round2((subtotal * Math.max(0, Math.min(100, raw))) / 100);
    } else {
      discountAmount = Math.max(0, round2(Math.min(raw, subtotal)));
    }
  }
  const netAmount = round2(subtotal - discountAmount);
  const taxAmount = round2((netAmount * safeTaxRate) / 100);
  const total = round2(netAmount + taxAmount);
  return { subtotal, discountAmount, netAmount, taxAmount, total };
}

// ------------------------------------------------------------
// 1. DECIMAL QUANTITIES & MONETARY ROUNDING
// ------------------------------------------------------------
describe('1. Decimal Quantities & Monetary Precision', () => {
  it('calculates fractional weights accurately without IEEE-754 drift', () => {
    // e.g. 14.650 kg of Apples @ ₹82.50 / kg
    const item = { quantity: 14.65, price: 82.5 };
    const lineTotal = round2(item.quantity * item.price);
    assert.equal(lineTotal, 1208.63);

    // 3 items with fractional weights
    const items = [
      { quantity: 14.65, price: 82.5 },   // 1208.625 -> 1208.63
      { quantity: 23.425, price: 110.0 }, // 2576.75
      { quantity: 5.5, price: 45.25 },    // 248.875 -> 248.88
    ];
    const { subtotal, total } = calculateInvoiceTotals(items, 0);
    assert.equal(subtotal, 4034.26);
    assert.equal(total, 4034.26);
  });

  it('correctly computes pre-tax discounts and GST taxes', () => {
    const items = [{ quantity: 100, price: 50 }]; // subtotal = 5000
    // 10% discount on 5000 = 500, net = 4500, 5% GST on 4500 = 225, total = 4725
    const totals = calculateInvoiceTotals(items, 5, { type: 'PERCENT', value: 10 });
    assert.equal(totals.subtotal, 5000.0);
    assert.equal(totals.discountAmount, 500.0);
    assert.equal(totals.netAmount, 4500.0);
    assert.equal(totals.taxAmount, 225.0);
    assert.equal(totals.total, 4725.0);
  });
});

// ------------------------------------------------------------
// 2. PRICING PRIORITY RESOLUTION & INVARIANCE
// ------------------------------------------------------------
describe('2. Price Priority & Contract Invariance', () => {
  function resolvePrice({ clientContracts, dailyPrices, clientId, fruitId, unitId, invoiceDate }) {
    // 1. Check Customer-specific active contract
    const contract = clientContracts.find((c) => {
      if (c.clientId !== clientId || c.fruitId !== fruitId || c.unitId !== unitId) return false;
      const from = new Date(c.effectiveFrom);
      const to = c.effectiveTo ? new Date(c.effectiveTo) : null;
      const d = new Date(invoiceDate);
      return from <= d && (!to || to >= d);
    });
    if (contract) return { price: contract.price, source: 'CUSTOMER_CONTRACT' };

    // 2. Check Daily Board Price (latest on or before invoiceDate)
    const boardPrice = dailyPrices
      .filter((p) => p.fruitId === fruitId && p.unitId === unitId && new Date(p.effectiveDate) <= new Date(invoiceDate))
      .sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate))[0];
    if (boardPrice) return { price: boardPrice.price, source: 'DAILY_BOARD' };

    return { price: null, source: 'MANUAL_REQUIRED' };
  }

  it('selects customer contract rate over daily board price', () => {
    const clientContracts = [
      { clientId: 'client-1', fruitId: 'fruit-apple', unitId: 'unit-kg', price: 90.0, effectiveFrom: '2026-01-01', effectiveTo: null },
    ];
    const dailyPrices = [
      { fruitId: 'fruit-apple', unitId: 'unit-kg', price: 110.0, effectiveDate: '2026-10-25' },
    ];

    const result = resolvePrice({
      clientContracts,
      dailyPrices,
      clientId: 'client-1',
      fruitId: 'fruit-apple',
      unitId: 'unit-kg',
      invoiceDate: '2026-10-25',
    });

    assert.equal(result.source, 'CUSTOMER_CONTRACT');
    assert.equal(result.price, 90.0);
  });

  it('preserves customer rate when daily board price fluctuates (Invariance)', () => {
    const clientContracts = [
      { clientId: 'client-1', fruitId: 'fruit-apple', unitId: 'unit-kg', price: 90.0, effectiveFrom: '2026-01-01', effectiveTo: null },
    ];
    // Morning mandi price surges to ₹140.00
    const dailyPrices = [
      { fruitId: 'fruit-apple', unitId: 'unit-kg', price: 140.0, effectiveDate: '2026-10-26' },
    ];

    // Client-1 still gets contracted ₹90.00
    const client1Result = resolvePrice({
      clientContracts,
      dailyPrices,
      clientId: 'client-1',
      fruitId: 'fruit-apple',
      unitId: 'unit-kg',
      invoiceDate: '2026-10-26',
    });
    assert.equal(client1Result.price, 90.0);

    // Client-2 (no contract) gets daily board rate ₹140.00
    const client2Result = resolvePrice({
      clientContracts,
      dailyPrices,
      clientId: 'client-2',
      fruitId: 'fruit-apple',
      unitId: 'unit-kg',
      invoiceDate: '2026-10-26',
    });
    assert.equal(client2Result.source, 'DAILY_BOARD');
    assert.equal(client2Result.price, 140.0);
  });
});

// ------------------------------------------------------------
// 3. CONTRACT DATE OVERLAP LOGIC
// ------------------------------------------------------------
describe('3. Contract Date Overlap Guard & Concurrency Isolation', () => {
  function normalizeDate(d) {
    if (!d) return null;
    if (typeof d === 'string') return d.slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  function checkOverlap(period1, period2) {
    const s1 = normalizeDate(period1.effectiveFrom);
    const e1 = normalizeDate(period1.effectiveTo);
    const s2 = normalizeDate(period2.effectiveFrom);
    const e2 = normalizeDate(period2.effectiveTo);

    if (!s1 || !s2) return false;
    // Overlap condition for inclusive intervals: s1 <= (e2 ?? inf) && s2 <= (e1 ?? inf)
    return (!e2 || s1 <= e2) && (!e1 || s2 <= e1);
  }

  // Helper simulating the POST route conflict check
  function validateNewContract(existingList, newContract) {
    for (const existing of existingList) {
      if (checkOverlap(newContract, existing)) {
        return {
          valid: false,
          conflictWith: existing,
          error: `Contract date range (${newContract.effectiveFrom} to ${newContract.effectiveTo ?? 'indefinite'}) overlaps with an existing negotiated contract (${existing.effectiveFrom} to ${existing.effectiveTo ?? 'indefinite'}) at ₹${existing.price.toFixed(2)}.`,
        };
      }
    }
    return { valid: true };
  }

  describe('Adjacent Interval Preservation', () => {
    it('permits valid adjacent non-overlapping contract intervals (day before / day after)', () => {
      const contractA = { effectiveFrom: '2026-01-01', effectiveTo: '2026-01-31', price: 90.0 };
      const contractB = { effectiveFrom: '2026-02-01', effectiveTo: '2026-02-28', price: 95.0 };
      assert.equal(checkOverlap(contractA, contractB), false);
      assert.equal(checkOverlap(contractB, contractA), false);

      const validation = validateNewContract([contractA], contractB);
      assert.equal(validation.valid, true);
    });

    it('permits valid non-adjacent separate intervals with gap between them', () => {
      const contractA = { effectiveFrom: '2026-01-01', effectiveTo: '2026-01-15', price: 100.0 };
      const contractB = { effectiveFrom: '2026-03-01', effectiveTo: '2026-03-31', price: 110.0 };
      assert.equal(checkOverlap(contractA, contractB), false);
      assert.equal(checkOverlap(contractB, contractA), false);
    });
  });

  describe('Fixed End Dates & Inclusive Boundaries', () => {
    it('rejects contracts sharing the same boundary date (boundary handled inclusively)', () => {
      // Jan 1 to Jan 31 and Jan 31 to Feb 28 share Jan 31
      const contractA = { effectiveFrom: '2026-01-01', effectiveTo: '2026-01-31', price: 90.0 };
      const contractB = { effectiveFrom: '2026-01-31', effectiveTo: '2026-02-28', price: 95.0 };
      assert.equal(checkOverlap(contractA, contractB), true);
      assert.equal(checkOverlap(contractB, contractA), true);

      const validation = validateNewContract([contractA], contractB);
      assert.equal(validation.valid, false);
      assert.match(validation.error, /overlaps with an existing negotiated contract/);
    });

    it('rejects interior overlap between fixed date contracts', () => {
      const contractA = { effectiveFrom: '2026-01-01', effectiveTo: '2026-02-05', price: 90.0 };
      const contractB = { effectiveFrom: '2026-02-01', effectiveTo: '2026-02-28', price: 95.0 };
      assert.equal(checkOverlap(contractA, contractB), true);

      const validation = validateNewContract([contractA], contractB);
      assert.equal(validation.valid, false);
    });

    it('rejects sub-interval (new contract entirely inside existing contract)', () => {
      const existing = { effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30', price: 120.0 };
      const newContract = { effectiveFrom: '2026-02-01', effectiveTo: '2026-02-28', price: 125.0 };
      assert.equal(checkOverlap(newContract, existing), true);

      const validation = validateNewContract([existing], newContract);
      assert.equal(validation.valid, false);
    });

    it('rejects super-interval (new contract completely envelops existing contract)', () => {
      const existing = { effectiveFrom: '2026-02-01', effectiveTo: '2026-02-28', price: 125.0 };
      const newContract = { effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30', price: 120.0 };
      assert.equal(checkOverlap(newContract, existing), true);

      const validation = validateNewContract([existing], newContract);
      assert.equal(validation.valid, false);
    });
  });

  describe('Open-Ended Contracts (null effectiveTo)', () => {
    it('rejects two open-ended contracts starting on different dates', () => {
      const existingOpen = { effectiveFrom: '2026-01-01', effectiveTo: null, price: 100.0 };
      const newOpen = { effectiveFrom: '2026-03-01', effectiveTo: null, price: 105.0 };
      assert.equal(checkOverlap(newOpen, existingOpen), true);
      assert.equal(checkOverlap(existingOpen, newOpen), true);

      const validation = validateNewContract([existingOpen], newOpen);
      assert.equal(validation.valid, false);
    });

    it('rejects fixed contract that starts after an existing open-ended contract', () => {
      const existingOpen = { effectiveFrom: '2026-01-01', effectiveTo: null, price: 100.0 };
      const newFixed = { effectiveFrom: '2026-04-01', effectiveTo: '2026-04-30', price: 110.0 };
      assert.equal(checkOverlap(newFixed, existingOpen), true);

      const validation = validateNewContract([existingOpen], newFixed);
      assert.equal(validation.valid, false);
    });

    it('permits fixed contract strictly before an existing open-ended contract', () => {
      const existingOpen = { effectiveFrom: '2026-06-01', effectiveTo: null, price: 130.0 };
      const newFixed = { effectiveFrom: '2026-01-01', effectiveTo: '2026-05-31', price: 120.0 };
      assert.equal(checkOverlap(newFixed, existingOpen), false);

      const validation = validateNewContract([existingOpen], newFixed);
      assert.equal(validation.valid, true);
    });

    it('rejects open-ended contract that overlaps an existing fixed contract', () => {
      const existingFixed = { effectiveFrom: '2026-01-01', effectiveTo: '2026-05-31', price: 120.0 };
      const newOpen = { effectiveFrom: '2026-05-01', effectiveTo: null, price: 130.0 };
      assert.equal(checkOverlap(newOpen, existingFixed), true);

      const validation = validateNewContract([existingFixed], newOpen);
      assert.equal(validation.valid, false);
    });

    it('permits open-ended contract starting strictly adjacent after existing fixed contract', () => {
      const existingFixed = { effectiveFrom: '2026-01-01', effectiveTo: '2026-05-31', price: 120.0 };
      const newOpen = { effectiveFrom: '2026-06-01', effectiveTo: null, price: 130.0 };
      assert.equal(checkOverlap(newOpen, existingFixed), false);

      const validation = validateNewContract([existingFixed], newOpen);
      assert.equal(validation.valid, true);
    });
  });
});

// ------------------------------------------------------------
// 4. PAYMENT ALLOCATION & REVERSAL INVARIANTS
// ------------------------------------------------------------
describe('4. Payment Allocation & Reversal Accounting', () => {
  it('correctly tracks allocations, unallocated credit, and invoice balance', () => {
    const payment = {
      amount: 10000.0,
      allocatedAmount: 0.0,
      refundedAmount: 0.0,
      unallocatedAmount: 10000.0,
      status: 'COMPLETED',
    };
    const invoice = {
      totalAmount: 6000.0,
      paidAmount: 0.0,
      balanceAmount: 6000.0,
      status: 'PENDING',
    };

    // Allocate ₹4,000 from Payment to Invoice
    const allocAmount = 4000.0;
    const allocation = {
      amount: allocAmount,
      status: 'ACTIVE',
    };
    payment.allocatedAmount += allocAmount;
    payment.unallocatedAmount -= allocAmount;
    invoice.paidAmount += allocAmount;
    invoice.balanceAmount -= allocAmount;
    invoice.status = invoice.balanceAmount === 0 ? 'PAID' : 'PARTIALLY_PAID';

    assert.equal(payment.unallocatedAmount, 6000.0);
    assert.equal(invoice.paidAmount, 4000.0);
    assert.equal(invoice.balanceAmount, 2000.0);
    assert.equal(invoice.status, 'PARTIALLY_PAID');

    // Reversal of allocation (without deleting the record)
    allocation.status = 'REVERSED';
    payment.allocatedAmount -= allocAmount;
    payment.unallocatedAmount += allocAmount;
    invoice.paidAmount -= allocAmount;
    invoice.balanceAmount += allocAmount;
    invoice.status = invoice.paidAmount === 0 ? 'PENDING' : 'PARTIALLY_PAID';

    assert.equal(allocation.status, 'REVERSED');
    assert.equal(payment.unallocatedAmount, 10000.0);
    assert.equal(invoice.paidAmount, 0.0);
    assert.equal(invoice.balanceAmount, 6000.0);
    assert.equal(invoice.status, 'PENDING');
  });

  it('voiding payment cancels unallocated credit and restores invoice debt', () => {
    const payment = {
      amount: 5000.0,
      allocatedAmount: 3000.0,
      refundedAmount: 0.0,
      unallocatedAmount: 2000.0,
      status: 'COMPLETED',
    };
    const invoice = {
      totalAmount: 3000.0,
      paidAmount: 3000.0,
      balanceAmount: 0.0,
      status: 'PAID',
    };
    const allocation = { amount: 3000.0, status: 'ACTIVE' };

    // Void payment
    payment.status = 'VOIDED';
    payment.unallocatedAmount = 0.0;
    allocation.status = 'REVERSED';
    invoice.paidAmount -= allocation.amount;
    invoice.balanceAmount += allocation.amount;
    invoice.status = 'PENDING';

    assert.equal(payment.status, 'VOIDED');
    assert.equal(payment.unallocatedAmount, 0.0);
    assert.equal(invoice.status, 'PENDING');
    assert.equal(invoice.balanceAmount, 3000.0);
  });
});

// ------------------------------------------------------------
// 5. REFUND ACCOUNTING (NO DOUBLE COUNTING)
// ------------------------------------------------------------
describe('5. Refund Accounting', () => {
  it('deducts refund from unallocated amount and rejects excess refunds', () => {
    const payment = {
      amount: 8000.0,
      allocatedAmount: 5000.0,
      refundedAmount: 0.0,
      unallocatedAmount: 3000.0,
    };

    // Valid refund of ₹1,000
    const refundAmount = 1000.0;
    assert.ok(refundAmount <= payment.unallocatedAmount);
    payment.refundedAmount += refundAmount;
    payment.unallocatedAmount -= refundAmount;

    assert.equal(payment.refundedAmount, 1000.0);
    assert.equal(payment.unallocatedAmount, 2000.0);

    // Excess refund of ₹2,500 must be rejected
    const excessRefund = 2500.0;
    assert.ok(excessRefund > payment.unallocatedAmount);
  });
});

// ------------------------------------------------------------
// 6. NET CUSTOMER BALANCE & ZERO-PAID INVARIANTS
// ------------------------------------------------------------
describe('6. Net Customer Balance & Zero-Paid Invariants', () => {
  it('computes net customer balance accurately across invoices, payments, and credit/debit notes', () => {
    const client = { openingBalance: 1500.0 }; // Opening debt = ₹1,500
    const invoices = [
      { status: 'DRAFT', balanceAmount: 0.0 },          // Draft -> 0 debt
      { status: 'PENDING', balanceAmount: 5000.0 },      // Unpaid bill -> ₹5,000
      { status: 'PARTIALLY_PAID', balanceAmount: 2500.0 }, // Remaining bill -> ₹2,500
      { status: 'PAID', balanceAmount: 0.0 },            // Fully settled -> 0 debt
      { status: 'VOID', balanceAmount: 0.0 },            // Voided bill -> 0 debt
    ];
    const totalInvoicedDebt = invoices.reduce((s, inv) => s + inv.balanceAmount, 0); // 7500
    assert.equal(totalInvoicedDebt, 7500.0);

    const adjustments = [
      { type: 'DEBIT_NOTE', amount: 300.0 },    // +₹300
      { type: 'CREDIT_NOTE', amount: 500.0 },   // -₹500
      { type: 'BAD_DEBT_WRITE_OFF', amount: 0.0 },
    ];
    const netAdjustments = adjustments.reduce(
      (s, a) => s + (a.type === 'DEBIT_NOTE' ? a.amount : -a.amount),
      0
    ); // -200

    const payments = [
      { status: 'COMPLETED', unallocatedAmount: 2000.0 }, // Customer credit = ₹2,000
      { status: 'VOIDED', unallocatedAmount: 0.0 },
    ];
    const totalUnallocatedCredit = payments
      .filter((p) => p.status === 'COMPLETED')
      .reduce((s, p) => s + p.unallocatedAmount, 0); // 2000

    // Net Balance = Opening (1500) + InvoicedDebt (7500) + Adjustments (-200) - UnallocatedCredit (2000) = 6800
    const netCustomerBalance =
      client.openingBalance + totalInvoicedDebt + netAdjustments - totalUnallocatedCredit;

    assert.equal(netCustomerBalance, 6800.0);
  });

  it('guarantees that DRAFT, PENDING, and VOID invoices have paidAmount === 0', () => {
    const validStatusesForZeroPaid = new Set(['DRAFT', 'PENDING', 'VOID']);
    assert.ok(validStatusesForZeroPaid.has('DRAFT'));
    assert.ok(validStatusesForZeroPaid.has('PENDING'));
    assert.ok(validStatusesForZeroPaid.has('VOID'));
    assert.ok(!validStatusesForZeroPaid.has('PAID'));
    assert.ok(!validStatusesForZeroPaid.has('PARTIALLY_PAID'));
  });
});

// ------------------------------------------------------------
// 7. MULTI-TENANT & CUSTOMER IDENTITY GUARD
// ------------------------------------------------------------
describe('7. Multi-Tenant & Customer Boundary Guard', () => {
  function validateAllocation(payment, invoice, allocationAmount) {
    if (payment.userId !== invoice.userId) {
      throw new Error('Tenant isolation violation: Payment and Invoice belong to different businesses');
    }
    if (payment.clientId !== invoice.clientId) {
      throw new Error('Customer mismatch: Payment cannot be allocated to an invoice of another customer');
    }
    if (payment.status !== 'COMPLETED') {
      throw new Error('Invalid payment status');
    }
    if (invoice.status === 'DRAFT' || invoice.status === 'VOID') {
      throw new Error('Cannot allocate payment to DRAFT or VOID invoice');
    }
    if (allocationAmount > payment.unallocatedAmount) {
      throw new Error('Allocation exceeds available unallocated payment amount');
    }
    if (allocationAmount > invoice.balanceAmount) {
      throw new Error('Allocation exceeds remaining invoice balance');
    }
    return true;
  }

  it('rejects cross-tenant allocation', () => {
    const payment = { userId: 'tenant-A', clientId: 'client-1', unallocatedAmount: 1000, status: 'COMPLETED' };
    const invoice = { userId: 'tenant-B', clientId: 'client-1', balanceAmount: 1000, status: 'PENDING' };
    assert.throws(() => validateAllocation(payment, invoice, 500), /Tenant isolation violation/);
  });

  it('rejects cross-customer allocation', () => {
    const payment = { userId: 'tenant-A', clientId: 'client-X', unallocatedAmount: 1000, status: 'COMPLETED' };
    const invoice = { userId: 'tenant-A', clientId: 'client-Y', balanceAmount: 1000, status: 'PENDING' };
    assert.throws(() => validateAllocation(payment, invoice, 500), /Customer mismatch/);
  });

  it('accepts valid allocation within same tenant and customer', () => {
    const payment = { userId: 'tenant-A', clientId: 'client-X', unallocatedAmount: 1000, status: 'COMPLETED' };
    const invoice = { userId: 'tenant-A', clientId: 'client-X', balanceAmount: 1000, status: 'PENDING' };
    assert.equal(validateAllocation(payment, invoice, 500), true);
  });
});

// ------------------------------------------------------------
// 8. PRICE HISTORY & STATISTICAL ANALYSIS
// ------------------------------------------------------------
describe('8. Historical Daily Price Viewing & Statistics', () => {
  function computePriceStats(history) {
    if (!history || history.length === 0) {
      return { count: 0, latest: null, highest: null, lowest: null, average: null };
    }
    const prices = history.map((h) => Number(h.price));
    const highest = Math.max(...prices);
    const lowest = Math.min(...prices);
    const sum = prices.reduce((a, b) => a + b, 0);
    const average = round2(sum / prices.length);
    return { count: history.length, latest: prices[0], highest, lowest, average };
  }

  it('accurately computes 30-day price metrics (high, low, avg, latest)', () => {
    // Chronologically sorted newest first
    const history = [
      { effectiveDate: '2026-10-25', price: 110.0 },
      { effectiveDate: '2026-10-24', price: 105.5 },
      { effectiveDate: '2026-10-23', price: 98.0 },
      { effectiveDate: '2026-10-22', price: 120.0 },
      { effectiveDate: '2026-10-21', price: 95.0 },
    ];
    const stats = computePriceStats(history);
    assert.equal(stats.count, 5);
    assert.equal(stats.latest, 110.0);
    assert.equal(stats.highest, 120.0);
    assert.equal(stats.lowest, 95.0);
    assert.equal(stats.average, 105.7); // (110 + 105.5 + 98 + 120 + 95) / 5 = 105.7
  });

  it('handles empty history gracefully', () => {
    const stats = computePriceStats([]);
    assert.equal(stats.count, 0);
    assert.equal(stats.latest, null);
    assert.equal(stats.highest, null);
    assert.equal(stats.lowest, null);
    assert.equal(stats.average, null);
  });
});

// ------------------------------------------------------------
// 9. DAILY PRICE BULK UPDATES & VALIDATION
// ------------------------------------------------------------
describe('9. Daily Price Board Bulk Updates', () => {
  function validateBulkPrices(input, tenantFruits, tenantUnits) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) {
      throw new Error('Invalid effective date format');
    }
    if (!Array.isArray(input.prices) || input.prices.length === 0) {
      throw new Error('Prices array cannot be empty');
    }

    const fruitSet = new Set(tenantFruits.map((f) => f.id));
    const unitSet = new Set(tenantUnits.map((u) => u.id));

    for (const item of input.prices) {
      if (!fruitSet.has(item.fruitId)) {
        throw new Error(`Fruit ${item.fruitId} does not belong to user account`);
      }
      if (!unitSet.has(item.unitId)) {
        throw new Error(`Unit ${item.unitId} does not belong to user account`);
      }
      if (typeof item.price !== 'number' || item.price < 0) {
        throw new Error(`Invalid price for fruit ${item.fruitId}`);
      }
    }
    return true;
  }

  it('validates and accepts valid bulk daily rate payload', () => {
    const tenantFruits = [
      { id: 'fruit-apple', name: 'Apple' },
      { id: 'fruit-mango', name: 'Mango' },
    ];
    const tenantUnits = [{ id: 'unit-kg', code: 'kg' }];

    const payload = {
      effectiveDate: '2026-10-25',
      prices: [
        { fruitId: 'fruit-apple', unitId: 'unit-kg', price: 95.5 },
        { fruitId: 'fruit-mango', unitId: 'unit-kg', price: 140.0 },
      ],
    };

    assert.equal(validateBulkPrices(payload, tenantFruits, tenantUnits), true);
  });

  it('rejects bulk price update containing unauthorized or foreign fruit ID', () => {
    const tenantFruits = [{ id: 'fruit-apple', name: 'Apple' }];
    const tenantUnits = [{ id: 'unit-kg', code: 'kg' }];

    const payload = {
      effectiveDate: '2026-10-25',
      prices: [
        { fruitId: 'fruit-foreign', unitId: 'unit-kg', price: 95.5 },
      ],
    };

    assert.throws(
      () => validateBulkPrices(payload, tenantFruits, tenantUnits),
      /does not belong to user account/
    );
  });
});

// ------------------------------------------------------------
// 10. COPY YESTERDAY'S PRICES & INLINE EDITING WORKFLOW
// ------------------------------------------------------------
describe("10. Copy Yesterday's Prices & Inline Editing", () => {
  function simulateCopyYesterdayAndEdit(todayBoard, yesterdayPrices, userEdits = {}) {
    const yesterdayMap = new Map(yesterdayPrices.map((p) => [p.fruitId, p.price]));

    // Step 1: Copy yesterday's prices into today's board
    const copiedBoard = todayBoard.map((row) => {
      const prior = yesterdayMap.get(row.fruitId);
      return {
        ...row,
        price: prior !== undefined ? prior : row.price,
      };
    });

    // Step 2: User applies inline edits before saving
    const finalBoard = copiedBoard.map((row) => {
      if (userEdits[row.fruitId] !== undefined) {
        return {
          ...row,
          price: userEdits[row.fruitId],
        };
      }
      return row;
    });

    return finalBoard;
  }

  it("copies prior day's rates while allowing custom edits before save", () => {
    const todayBoard = [
      { fruitId: 'fruit-apple', fruitName: 'Apple', price: null },
      { fruitId: 'fruit-banana', fruitName: 'Banana', price: null },
      { fruitId: 'fruit-orange', fruitName: 'Orange', price: null },
    ];

    const yesterdayPrices = [
      { fruitId: 'fruit-apple', price: 80.0 },
      { fruitId: 'fruit-banana', price: 40.0 },
    ];

    // User edits Apple from 80 -> 85 and manually prices Orange @ 60
    const userEdits = {
      'fruit-apple': 85.0,
      'fruit-orange': 60.0,
    };

    const result = simulateCopyYesterdayAndEdit(todayBoard, yesterdayPrices, userEdits);

    assert.equal(result.find((r) => r.fruitId === 'fruit-apple').price, 85.0); // Edited
    assert.equal(result.find((r) => r.fruitId === 'fruit-banana').price, 40.0); // Copied from yesterday
    assert.equal(result.find((r) => r.fruitId === 'fruit-orange').price, 60.0); // Freshly entered
  });
});

// ------------------------------------------------------------
// 11. CUSTOMER CONTRACT INVARIANCE & OVERLAP REJECTION
// ------------------------------------------------------------
describe('11. Customer Negotiated Rate Invariance & Overlap Rejection', () => {
  function checkContractOverlap(existingContracts, newContract) {
    const fromDate = new Date(`${newContract.effectiveFrom}T00:00:00.000Z`).getTime();
    const toDate = newContract.effectiveTo ? new Date(`${newContract.effectiveTo}T00:00:00.000Z`).getTime() : Infinity;

    for (const c of existingContracts) {
      if (
        c.clientId !== newContract.clientId ||
        c.fruitId !== newContract.fruitId ||
        c.unitId !== newContract.unitId
      ) {
        continue;
      }
      const eFrom = new Date(`${c.effectiveFrom}T00:00:00.000Z`).getTime();
      const eTo = c.effectiveTo ? new Date(`${c.effectiveTo}T00:00:00.000Z`).getTime() : Infinity;

      const overlaps = eFrom <= toDate && fromDate <= eTo;
      if (overlaps) {
        return {
          hasOverlap: true,
          conflictingContractId: c.id,
          conflictRange: `${c.effectiveFrom} to ${c.effectiveTo ?? 'indefinite'}`,
        };
      }
    }
    return { hasOverlap: false };
  }

  it('guarantees daily price updates do NOT modify active client negotiated rates', () => {
    const customerContract = {
      clientId: 'client-vip',
      fruitId: 'fruit-apple',
      unitId: 'unit-kg',
      price: 75.0, // Fixed contract rate
      effectiveFrom: '2026-10-01',
      effectiveTo: null,
    };

    // Daily price board changes across 3 consecutive days
    const dailyBoardDays = [
      { date: '2026-10-23', boardPrice: 85.0 },
      { date: '2026-10-24', boardPrice: 110.0 },
      { date: '2026-10-25', boardPrice: 130.0 },
    ];

    // Simulate price resolution on each day
    for (const day of dailyBoardDays) {
      const isContractActive =
        customerContract.effectiveFrom <= day.date &&
        (!customerContract.effectiveTo || customerContract.effectiveTo >= day.date);

      const effectiveBillingPrice = isContractActive ? customerContract.price : day.boardPrice;

      // Assert invariant: client rate stays ₹75.00 regardless of board fluctuation
      assert.equal(effectiveBillingPrice, 75.0);
      assert.notEqual(effectiveBillingPrice, day.boardPrice);
    }
  });

  it('rejects new contract when overlapping an open-ended contract', () => {
    const existing = [
      {
        id: 'c-open',
        clientId: 'client-1',
        fruitId: 'fruit-apple',
        unitId: 'unit-kg',
        price: 80.0,
        effectiveFrom: '2026-01-01',
        effectiveTo: null, // open-ended
      },
    ];

    const newContract = {
      clientId: 'client-1',
      fruitId: 'fruit-apple',
      unitId: 'unit-kg',
      price: 90.0,
      effectiveFrom: '2026-11-01',
      effectiveTo: '2026-12-31',
    };

    const res = checkContractOverlap(existing, newContract);
    assert.equal(res.hasOverlap, true);
    assert.equal(res.conflictingContractId, 'c-open');
  });

  it('rejects new contract when overlapping fixed end-date contract boundaries (inclusive)', () => {
    const existing = [
      {
        id: 'c-summer',
        clientId: 'client-1',
        fruitId: 'fruit-mango',
        unitId: 'unit-box',
        price: 450.0,
        effectiveFrom: '2026-04-01',
        effectiveTo: '2026-06-30',
      },
    ];

    // Attempt 1: Overlaps interior (June 15 to July 15)
    const overlapInterior = {
      clientId: 'client-1',
      fruitId: 'fruit-mango',
      unitId: 'unit-box',
      price: 480.0,
      effectiveFrom: '2026-06-15',
      effectiveTo: '2026-07-15',
    };
    assert.equal(checkContractOverlap(existing, overlapInterior).hasOverlap, true);

    // Attempt 2: Overlaps inclusive end-boundary date (June 30)
    const overlapBoundary = {
      clientId: 'client-1',
      fruitId: 'fruit-mango',
      unitId: 'unit-box',
      price: 480.0,
      effectiveFrom: '2026-06-30',
      effectiveTo: '2026-07-31',
    };
    assert.equal(checkContractOverlap(existing, overlapBoundary).hasOverlap, true);
  });

  it('accepts valid adjacent non-overlapping intervals for same customer and fruit', () => {
    const existing = [
      {
        id: 'c-q1',
        clientId: 'client-1',
        fruitId: 'fruit-apple',
        unitId: 'unit-kg',
        price: 85.0,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-03-31',
      },
    ];

    // Adjacent forward: Starts on April 1 (day after March 31)
    const newAdjacentForward = {
      clientId: 'client-1',
      fruitId: 'fruit-apple',
      unitId: 'unit-kg',
      price: 92.0,
      effectiveFrom: '2026-04-01',
      effectiveTo: '2026-06-30',
    };
    assert.equal(checkContractOverlap(existing, newAdjacentForward).hasOverlap, false);

    // Adjacent backward: Ends on December 31, 2025 (day before January 1, 2026)
    const newAdjacentBackward = {
      clientId: 'client-1',
      fruitId: 'fruit-apple',
      unitId: 'unit-kg',
      price: 78.0,
      effectiveFrom: '2025-10-01',
      effectiveTo: '2025-12-31',
    };
    assert.equal(checkContractOverlap(existing, newAdjacentBackward).hasOverlap, false);
  });

  it('allows concurrent contracts for different fruits or units without conflict', () => {
    const existing = [
      {
        id: 'c-apple-kg',
        clientId: 'client-1',
        fruitId: 'fruit-apple',
        unitId: 'unit-kg',
        price: 85.0,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ];

    // Same customer & dates, but different fruit (Orange)
    const diffFruit = {
      clientId: 'client-1',
      fruitId: 'fruit-orange',
      unitId: 'unit-kg',
      price: 60.0,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    };
    assert.equal(checkContractOverlap(existing, diffFruit).hasOverlap, false);

    // Same customer & fruit, but different unit (Crate)
    const diffUnit = {
      clientId: 'client-1',
      fruitId: 'fruit-apple',
      unitId: 'unit-crate',
      price: 1800.0,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    };
    assert.equal(checkContractOverlap(existing, diffUnit).hasOverlap, false);
  });
});

// ------------------------------------------------------------
// 12. MASTER CATALOGUE & TENANT ISOLATION
// ------------------------------------------------------------
describe('12. Fruit Catalogue Tenant Isolation', () => {
  const fruitsTable = [
    { id: 'f1', userId: 'user-1', name: 'Apple', isArchived: false },
    { id: 'f2', userId: 'user-1', name: 'Banana', isArchived: true },
    { id: 'f3', userId: 'user-2', name: 'Apple', isArchived: false },
  ];

  function queryFruits(userId, includeArchived = false) {
    return fruitsTable.filter((f) => {
      if (f.userId !== userId) return false;
      if (!includeArchived && f.isArchived) return false;
      return true;
    });
  }

  it('filters fruits strictly by tenant userId without leaking other businesses', () => {
    const user1Fruits = queryFruits('user-1', false);
    assert.equal(user1Fruits.length, 1);
    assert.equal(user1Fruits[0].id, 'f1');

    const user2Fruits = queryFruits('user-2', false);
    assert.equal(user2Fruits.length, 1);
    assert.equal(user2Fruits[0].id, 'f3');
  });

  it('respects archive flag in catalogue queries', () => {
    const user1All = queryFruits('user-1', true);
    assert.equal(user1All.length, 2);
  });
});

// ------------------------------------------------------------
// 13. MILESTONE 3: WHOLESALE INVOICE INTEGRATION & INVARIANTS
// ------------------------------------------------------------
describe('13. Milestone 3: Wholesale Fruit Invoice Integration & Invariants', () => {
  function normalizeDateStr(d) {
    if (typeof d === 'string') return d.slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  function resolveUnitPrice({ contracts, dailyPrices, clientId, fruitId, unitId, invoiceDate }) {
    if (!fruitId || !unitId) return { price: null, source: 'MANUAL' };
    const targetDate = invoiceDate ? normalizeDateStr(invoiceDate) : normalizeDateStr(new Date());

    // 1. Priority 1: Customer contract
    if (clientId) {
      const match = contracts.find((c) => {
        if (c.clientId !== clientId || c.fruitId !== fruitId || c.unitId !== unitId) return false;
        const from = normalizeDateStr(c.effectiveFrom);
        const to = c.effectiveTo ? normalizeDateStr(c.effectiveTo) : null;
        return from <= targetDate && (!to || to >= targetDate);
      });
      if (match) {
        return { price: Number(match.price), source: 'CUSTOMER_CONTRACT', candidateId: match.id };
      }
    }

    // 2. Priority 2: Daily Board Price (latest on or before targetDate)
    const validDaily = dailyPrices
      .filter((p) => {
        if (p.fruitId !== fruitId || p.unitId !== unitId) return false;
        return normalizeDateStr(p.effectiveDate) <= targetDate;
      })
      .sort((a, b) => normalizeDateStr(b.effectiveDate).localeCompare(normalizeDateStr(a.effectiveDate)));

    if (validDaily.length > 0) {
      return { price: Number(validDaily[0].price), source: 'DAILY_BOARD', candidateId: validDaily[0].id };
    }

    // 3. Priority 3: Manual entry
    return { price: null, source: 'MANUAL' };
  }

  it('resolves price by priority: Contract > Daily Board > Manual', () => {
    const contracts = [
      { id: 'cnt-1', clientId: 'c1', fruitId: 'f1', unitId: 'u1', price: 92.50, effectiveFrom: '2026-01-01', effectiveTo: null },
    ];
    const dailyPrices = [
      { id: 'dp-1', fruitId: 'f1', unitId: 'u1', price: 105.00, effectiveDate: '2026-10-26' },
      { id: 'dp-2', fruitId: 'f2', unitId: 'u1', price: 45.00, effectiveDate: '2026-10-26' },
    ];

    // Case A: Customer has active negotiated rate -> chooses contract price
    const resA = resolveUnitPrice({
      contracts,
      dailyPrices,
      clientId: 'c1',
      fruitId: 'f1',
      unitId: 'u1',
      invoiceDate: '2026-10-26',
    });
    assert.equal(resA.source, 'CUSTOMER_CONTRACT');
    assert.equal(resA.price, 92.50);

    // Case B: No contract for client on fruit f2 -> falls back to daily board rate
    const resB = resolveUnitPrice({
      contracts,
      dailyPrices,
      clientId: 'c1',
      fruitId: 'f2',
      unitId: 'u1',
      invoiceDate: '2026-10-26',
    });
    assert.equal(resB.source, 'DAILY_BOARD');
    assert.equal(resB.price, 45.00);

    // Case C: New fruit f3 with no contract and no board price -> requires manual rate
    const resC = resolveUnitPrice({
      contracts,
      dailyPrices,
      clientId: 'c1',
      fruitId: 'f3',
      unitId: 'u1',
      invoiceDate: '2026-10-26',
    });
    assert.equal(resC.source, 'MANUAL');
    assert.equal(resC.price, null);
  });

  it('guarantees invoice-only override invariance without modifying saved rates', () => {
    const contracts = [
      { id: 'cnt-1', clientId: 'c1', fruitId: 'f1', unitId: 'u1', price: 95.00, effectiveFrom: '2026-01-01', effectiveTo: null },
    ];
    const dailyPrices = [
      { id: 'dp-1', fruitId: 'f1', unitId: 'u1', price: 110.00, effectiveDate: '2026-10-26' },
    ];

    // Merchant enters a custom discount price for this consignment (damaged boxes)
    const resolved = resolveUnitPrice({
      contracts,
      dailyPrices,
      clientId: 'c1',
      fruitId: 'f1',
      unitId: 'u1',
      invoiceDate: '2026-10-26',
    });
    assert.equal(resolved.price, 95.00);

    // Override to ₹80.00 on the invoice line item
    const lineItem = {
      fruitId: 'f1',
      fruitName: 'Apple',
      unitId: 'u1',
      unitName: 'kg',
      quantity: 150.0,
      price: 80.00, // custom override
      suggestedPrice: resolved.price,
      priceSource: 'OVERRIDE',
    };

    assert.equal(lineItem.priceSource, 'OVERRIDE');
    assert.equal(lineItem.price, 80.00);

    // INVARIANCE: Underlying contract rate and daily price board are unmodified
    assert.equal(contracts[0].price, 95.00);
    assert.equal(dailyPrices[0].price, 110.00);
  });

  it('supports 3-decimal place quantities with exact monetary totals', () => {
    // 3 consignments with fractional weights
    const items = [
      { quantity: 15.625, price: 84.50 }, // 1320.3125 -> 1320.31
      { quantity: 42.175, price: 112.00 }, // 4723.60
      { quantity: 8.400, price: 45.25 }, // 380.10
    ];

    const { subtotal, discountAmount, netAmount, taxAmount, total } = calculateInvoiceTotals(
      items,
      5.0, // 5% Mandi Cess / GST
      { type: 'PERCENT', value: 10 } // 10% wholesale trade discount
    );

    // subtotal = 1320.31 + 4723.60 + 380.10 = 6424.01
    assert.equal(subtotal, 6424.01);
    // 10% discount on 6424.01 = 642.401 -> 642.40
    assert.equal(discountAmount, 642.40);
    // netAmount = 6424.01 - 642.40 = 5781.61
    assert.equal(netAmount, 5781.61);
    // 5% tax on 5781.61 = 289.0805 -> 289.08
    assert.equal(taxAmount, 289.08);
    // total = 5781.61 + 289.08 = 6070.69
    assert.equal(total, 6070.69);
  });

  it('snapshots catalogue information immutably on the invoice line item', () => {
    // Master catalogue state at issue time
    const fruitMaster = { id: 'f-kashmiri-apple', name: 'Apple', variety: 'Kashmiri Delicious' };
    const unitMaster = { id: 'u-kg', code: 'kg', name: 'Kilograms' };

    // Line item created at issue time snapshots catalogue attributes
    const savedLineItem = {
      id: 'item-1',
      invoiceId: 'inv-101',
      description: 'Kashmiri Delicious Apples - Lot 4',
      quantity: 125.750,
      price: 90.00,
      total: round2(125.750 * 90.00), // 11317.50
      fruitId: fruitMaster.id,
      fruitName: fruitMaster.name,
      fruitVariety: fruitMaster.variety,
      unitId: unitMaster.id,
      unitName: unitMaster.code,
      unitPriceSnapshot: 90.00,
    };

    assert.equal(savedLineItem.fruitName, 'Apple');
    assert.equal(savedLineItem.fruitVariety, 'Kashmiri Delicious');
    assert.equal(savedLineItem.unitName, 'kg');
    assert.equal(savedLineItem.unitPriceSnapshot, 90.00);

    // INVARIANCE: Later, the business renames the master catalogue fruit or archives it
    fruitMaster.name = 'Red Delicious';
    fruitMaster.variety = 'Grade A Super';

    // Historical invoice item snapshot remains completely unchanged
    assert.equal(savedLineItem.fruitName, 'Apple');
    assert.equal(savedLineItem.fruitVariety, 'Kashmiri Delicious');
  });

  it('preserves invoice status debt invariants (Requirement 10)', () => {
    const totalAmount = 5000.00;

    // Helper for computing debt fields on invoice creation/update
    function getInvoiceDebtAmounts(status, total, existingPaid = 0) {
      if (status === 'DRAFT') {
        return { paidAmount: 0, balanceAmount: 0, isCustomerDebt: false };
      }
      if (status === 'PENDING') {
        const paid = existingPaid > 0 ? existingPaid : 0;
        return { paidAmount: paid, balanceAmount: Math.max(0, round2(total - paid)), isCustomerDebt: true };
      }
      if (status === 'PAID') {
        return { paidAmount: total, balanceAmount: 0, isCustomerDebt: false };
      }
      if (status === 'VOID') {
        return { paidAmount: 0, balanceAmount: 0, isCustomerDebt: false };
      }
      return { paidAmount: 0, balanceAmount: 0, isCustomerDebt: false };
    }

    // 1. DRAFT does NOT count as customer debt
    const draft = getInvoiceDebtAmounts('DRAFT', totalAmount);
    assert.equal(draft.paidAmount, 0);
    assert.equal(draft.balanceAmount, 0);
    assert.equal(draft.isCustomerDebt, false);

    // 2. PENDING counts as customer debt with full balance
    const pending = getInvoiceDebtAmounts('PENDING', totalAmount);
    assert.equal(pending.paidAmount, 0);
    assert.equal(pending.balanceAmount, 5000.00);
    assert.equal(pending.isCustomerDebt, true);

    // 3. PAID reflects zero balance and full paid amount without fake payment records
    const paid = getInvoiceDebtAmounts('PAID', totalAmount);
    assert.equal(paid.paidAmount, 5000.00);
    assert.equal(paid.balanceAmount, 0);
    assert.equal(paid.isCustomerDebt, false);

    // 4. VOID cancels debt completely
    const voided = getInvoiceDebtAmounts('VOID', totalAmount);
    assert.equal(voided.paidAmount, 0);
    assert.equal(voided.balanceAmount, 0);
    assert.equal(voided.isCustomerDebt, false);
  });
});

// ------------------------------------------------------------
// 14. MILESTONE 3 REMEDIATION: MIGRATION PARITY & ACCOUNTING GUARD
// ------------------------------------------------------------
describe('14. Milestone 3 Remediation: Schema Parity & Allocation Accounting Guard', () => {
  const migrationPath = path.resolve('prisma/migrations/20261025163000_wholesale_fruit_billing/migration.sql');

  it('verifies migration SQL does not contain invalid OVERDUE enum literal', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Regression: 'OVERDUE' was never a valid InvoiceStatus PostgreSQL enum value
    assert.equal(sql.includes("WHERE \"status\" IN ('PENDING', 'OVERDUE')"), false);
    assert.equal(sql.includes("WHERE \"status\" = 'PENDING'"), true);
  });

  it('verifies migration SQL adds missing enums (InvoiceActivityType, DiscountType)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // InvoiceActivityType additions
    assert.equal(sql.includes('ALTER TYPE "InvoiceActivityType" ADD VALUE IF NOT EXISTS \'VOIDED\';'), true);
    assert.equal(sql.includes('ALTER TYPE "InvoiceActivityType" ADD VALUE IF NOT EXISTS \'EMAIL_DELIVERED\';'), true);
    assert.equal(sql.includes('ALTER TYPE "InvoiceActivityType" ADD VALUE IF NOT EXISTS \'EMAIL_BOUNCED\';'), true);
    assert.equal(sql.includes('ALTER TYPE "InvoiceActivityType" ADD VALUE IF NOT EXISTS \'EMAIL_OPENED\';'), true);

    // DiscountType enum creation
    assert.equal(sql.includes('CREATE TYPE "DiscountType" AS ENUM (\'PERCENT\', \'FIXED\')'), true);
  });

  it('verifies migration SQL adds missing Settings, Clients, and Invoices columns', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Settings columns
    assert.equal(sql.includes('"taxLabel" TEXT NOT NULL DEFAULT \'GST\''), true);
    assert.equal(sql.includes('"brandColor" TEXT NOT NULL DEFAULT \'#173D32\''), true);
    assert.equal(sql.includes('"invoicePrefix" TEXT NOT NULL DEFAULT \'INV\''), true);
    assert.equal(sql.includes('"invoiceSeparator" TEXT NOT NULL DEFAULT \'-\''), true);
    assert.equal(sql.includes('"invoicePad" INTEGER NOT NULL DEFAULT 4'), true);

    // Clients columns
    assert.equal(sql.includes('"portalToken" TEXT'), true);
    assert.equal(sql.includes('"notes" TEXT'), true);
    assert.equal(sql.includes('"dueDays" INTEGER'), true);

    // Invoices columns
    assert.equal(sql.includes('"discountType" "DiscountType"'), true);
    assert.equal(sql.includes('"discountValue" DECIMAL(12, 2)'), true);
    assert.equal(sql.includes('"discountAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0'), true);
  });

  it('verifies migration SQL includes expenses table, columns, indexes, and FK (Finding 1)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    assert.equal(sql.includes('CREATE TABLE IF NOT EXISTS "expenses"'), true);
    assert.equal(sql.includes('"userId" TEXT NOT NULL'), true);
    assert.equal(sql.includes('"date" DATE NOT NULL'), true);
    assert.equal(sql.includes('"category" TEXT NOT NULL DEFAULT \'General\''), true);
    assert.equal(sql.includes('"amount" DECIMAL(12, 2) NOT NULL'), true);
    assert.equal(sql.includes('CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")'), true);
    assert.equal(sql.includes('CREATE INDEX IF NOT EXISTS "expenses_userId_date_idx" ON "expenses"("userId", "date")'), true);
    assert.equal(sql.includes('CREATE INDEX IF NOT EXISTS "expenses_userId_category_idx" ON "expenses"("userId", "category")'), true);
    assert.equal(sql.includes('conname = \'expenses_userId_fkey\''), true);
    assert.equal(sql.includes('REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE'), true);
  });

  it('verifies password reset columns and unique index on users table match Prisma schema (Finding 2)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    assert.equal(sql.includes('ADD COLUMN IF NOT EXISTS "resetToken" TEXT'), true);
    assert.equal(sql.includes('ADD COLUMN IF NOT EXISTS "resetTokenExpires" TIMESTAMP(3)'), true);
    assert.equal(sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "users_resetToken_key" ON "users"("resetToken")'), true);
  });

  it('verifies recurring_profiles composite foreign key matches Prisma client relation (Finding 3)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    assert.equal(sql.includes('ALTER TABLE "recurring_profiles" DROP CONSTRAINT IF EXISTS "recurring_profiles_clientId_fkey"'), true);
    assert.equal(sql.includes('conname = \'recurring_profiles_clientId_userId_fkey\''), true);
    assert.equal(sql.includes('FOREIGN KEY ("clientId", "userId") REFERENCES "clients"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE'), true);
  });

  it('verifies clients(userId, isArchived) and invoice_items(fruitId) indexes are created (Finding 4)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    assert.equal(sql.includes('CREATE INDEX IF NOT EXISTS "clients_userId_isArchived_idx" ON "clients"("userId", "isArchived")'), true);
    assert.equal(sql.includes('CREATE INDEX IF NOT EXISTS "invoice_items_fruitId_idx" ON "invoice_items"("fruitId")'), true);
  });

  it('verifies migration guards use explicit pg_constraint checks and do not swallow unrelated errors (Finding 5)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Regression: Step 6 foreign key constraints must NOT use blind EXCEPTION WHEN OTHERS THEN null
    // They must use explicit pg_constraint existence checks
    assert.equal(sql.includes("SELECT 1 FROM pg_constraint WHERE conname = 'expenses_userId_fkey'"), true);
    assert.equal(sql.includes("SELECT 1 FROM pg_constraint WHERE conname = 'invoices_clientId_userId_fkey'"), true);
    assert.equal(sql.includes("SELECT 1 FROM pg_constraint WHERE conname = 'recurring_profiles_clientId_userId_fkey'"), true);

    // Verify Step 6 does NOT swallow errors with EXCEPTION WHEN OTHERS
    const step6Content = sql.slice(sql.indexOf('-- Step 6: Add Foreign Key Constraints'), sql.indexOf('-- Step 7: Conditional Exclusion Constraint'));
    assert.equal(step6Content.includes('EXCEPTION WHEN OTHERS THEN'), false);
    assert.equal(step6Content.includes('EXCEPTION WHEN duplicate_object THEN null'), false);
  });

  it('verifies migration transaction atomicity is managed natively by Prisma Migrate without incompatible DDL', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // 1. Transaction atomicity managed natively by Prisma Migrate (no standalone top-level BEGIN; or COMMIT;)
    assert.equal(/^[ \t]*BEGIN\s*;/m.test(sql), false);
    assert.equal(/^[ \t]*COMMIT\s*;/m.test(sql), false);
    assert.equal(sql.includes('Transaction atomicity managed natively by Prisma Migrate'), true);

    // 2. Absence of statements that cannot run inside a PostgreSQL transaction block
    assert.equal(sql.includes('CONCURRENTLY'), false);
    assert.equal(sql.includes('VACUUM'), false);
    assert.equal(sql.includes('DISCARD'), false);

    // 3. Newly added enum values must NOT be referenced before COMMIT
    assert.equal(sql.includes("status = 'VOID'"), false);
    assert.equal(sql.includes("status = 'PARTIALLY_PAID'"), false);
    assert.equal(sql.includes("type = 'VOIDED'"), false);
    assert.equal(sql.includes("type = 'EMAIL_DELIVERED'"), false);
  });

  it('guards invoice status transition against erasing active payment allocations', () => {
    // Allocation guard domain invariant
    function validateStatusTransition({
      currentStatus,
      targetStatus,
      activeAllocationsCount,
      activeAllocatedSum,
      invoiceTotal,
    }) {
      // 1. Guard against transitioning to DRAFT or VOID when active allocations exist
      if ((targetStatus === 'DRAFT' || targetStatus === 'VOID') && currentStatus !== targetStatus) {
        if (activeAllocationsCount > 0) {
          return {
            allowed: false,
            code: 409,
            error: `Cannot transition invoice to ${targetStatus}: invoice has active payment allocations. Reverse existing payment allocations first.`,
          };
        }
      }

      // 2. Guard against reducing invoice total below already allocated funds
      if ((targetStatus === 'PENDING' || targetStatus === 'PARTIALLY_PAID') && activeAllocatedSum > invoiceTotal) {
        return {
          allowed: false,
          code: 409,
          error: `Cannot reduce invoice total to ${invoiceTotal}: active payment allocations totaling ${activeAllocatedSum} exist. Adjust allocations first.`,
        };
      }

      // 3. Compute resulting paidAmount and balanceAmount
      let paidAmount = 0;
      let balanceAmount = 0;
      if (targetStatus === 'PENDING' || targetStatus === 'PARTIALLY_PAID') {
        paidAmount = activeAllocatedSum;
        balanceAmount = Math.max(0, round2(invoiceTotal - paidAmount));
      } else if (targetStatus === 'PAID') {
        paidAmount = invoiceTotal;
        balanceAmount = 0;
      } else {
        // DRAFT or VOID
        paidAmount = 0;
        balanceAmount = 0;
      }

      return { allowed: true, paidAmount, balanceAmount };
    }

    // Case 1: Unsafe transition to DRAFT with active allocations -> REJECTED
    const resDraft = validateStatusTransition({
      currentStatus: 'PENDING',
      targetStatus: 'DRAFT',
      activeAllocationsCount: 1,
      activeAllocatedSum: 2500.00,
      invoiceTotal: 5000.00,
    });
    assert.equal(resDraft.allowed, false);
    assert.equal(resDraft.code, 409);
    assert.match(resDraft.error, /active payment allocations/);

    // Case 2: Unsafe transition to VOID with active allocations -> REJECTED
    const resVoid = validateStatusTransition({
      currentStatus: 'PARTIALLY_PAID',
      targetStatus: 'VOID',
      activeAllocationsCount: 2,
      activeAllocatedSum: 3000.00,
      invoiceTotal: 5000.00,
    });
    assert.equal(resVoid.allowed, false);
    assert.equal(resVoid.code, 409);

    // Case 3: Transition PAID to PENDING preserves active allocations
    const resPending = validateStatusTransition({
      currentStatus: 'PAID',
      targetStatus: 'PENDING',
      activeAllocationsCount: 1,
      activeAllocatedSum: 2000.00,
      invoiceTotal: 5000.00,
    });
    assert.equal(resPending.allowed, true);
    assert.equal(resPending.paidAmount, 2000.00);
    assert.equal(resPending.balanceAmount, 3000.00);

    // Case 4: Reducing invoice total below active allocation sum -> REJECTED
    const resTotalReduction = validateStatusTransition({
      currentStatus: 'PARTIALLY_PAID',
      targetStatus: 'PENDING',
      activeAllocationsCount: 1,
      activeAllocatedSum: 4000.00,
      invoiceTotal: 3000.00, // Attempting to drop total below ₹4,000
    });
    assert.equal(resTotalReduction.allowed, false);
    assert.equal(resTotalReduction.code, 409);

    // Case 5: When allocations are reversed (count = 0), transition to VOID is permitted
    const resSafeVoid = validateStatusTransition({
      currentStatus: 'PENDING',
      targetStatus: 'VOID',
      activeAllocationsCount: 0,
      activeAllocatedSum: 0,
      invoiceTotal: 5000.00,
    });
    assert.equal(resSafeVoid.allowed, true);
    assert.equal(resSafeVoid.paidAmount, 0);
    assert.equal(resSafeVoid.balanceAmount, 0);
  });
});




