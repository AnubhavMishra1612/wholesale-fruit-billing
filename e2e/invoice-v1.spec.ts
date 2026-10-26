import { test, expect } from "@playwright/test";

/**
 * Invoice-Only V1 End-to-End Test Suite
 *
 * Scope:
 * 1. Register or authenticate a dedicated staging test user.
 * 2. Create a kilogram unit and a test fruit.
 * 3. Set today's daily fruit rate to ₹140/kg.
 * 4. Create a test customer.
 * 5. Set a customer-specific rate of ₹130/kg, effective today.
 * 6. Create an invoice for 14.650 kg.
 * 7. Verify that the negotiated rate overrides the daily rate.
 * 8. Verify the subtotal is ₹1,904.50 before any tax or discount.
 * 9. Verify the initial invoice has zero paid amount and no payment transaction is created.
 * 10. Verify invoice history and PDF response, including HTTP status 200, PDF content type, and %PDF signature.
 *
 * Data Lifecycle & Safety:
 * - All entities use run-specific unique identifiers (timestamp suffix) to prevent collisions.
 * - Test operates strictly within its own tenant boundaries (multi-tenant isolation).
 * - No existing records are deleted or modified.
 * - Payment and ledger endpoints remain completely untouched.
 */

// Reset storage state to start unauthenticated and test registration/login cleanly
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Invoice-Only V1 E2E Lifecycle", () => {
  const runId = Date.now().toString().slice(-6);
  const testUser = {
    name: `Staging V1 Tester ${runId}`,
    email: `staging.tester.${runId}@wholesale-fruit-billing.internal`,
    password: `Staging#V1#Pass${runId}!`,
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  test("executes complete invoice-only milestone workflow", async ({ page, request }) => {
    test.setTimeout(60000);

    // ------------------------------------------------------------------------
    // Step 1: Register and authenticate a dedicated staging test user
    // ------------------------------------------------------------------------
    const registerRes = await request.post("/api/register", {
      data: {
        name: testUser.name,
        email: testUser.email,
        password: testUser.password,
      },
    });
    expect([200, 201, 409]).toContain(registerRes.status());

    // Log in via UI
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);

    await page.locator('input[type="email"], input[name="email"]').fill(testUser.email);
    await page.locator('input[type="password"], input[name="password"]').fill(testUser.password);
    await page.getByRole("button", { name: /sign in|log in|submit/i }).click();

    // Verify navigation past login to dashboard
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15_000 });
    await expect(page).toHaveURL(/\/dashboard/);

    // ------------------------------------------------------------------------
    // Step 2: Create a kilogram unit and a test fruit
    // ------------------------------------------------------------------------
    const unitCode = `kg_${runId}`;
    const unitRes = await page.request.post("/api/fruits/units", {
      data: {
        name: `Kilogram ${runId}`,
        code: unitCode,
        isDefault: false,
        isArchived: false,
      },
    });
    expect(unitRes.status()).toBe(201);
    const unit = await unitRes.json();
    expect(unit.id).toBeDefined();
    expect(unit.code).toBe(unitCode);

    const fruitRes = await page.request.post("/api/fruits", {
      data: {
        name: `Shimla Apple ${runId}`,
        variety: "Royal Delicious",
        category: "Apples",
        hsnCode: "0808",
        defaultUnitId: unit.id,
        isActive: true,
        isArchived: false,
      },
    });
    expect(fruitRes.status()).toBe(201);
    const fruit = await fruitRes.json();
    expect(fruit.id).toBeDefined();
    expect(fruit.name).toBe(`Shimla Apple ${runId}`);

    // ------------------------------------------------------------------------
    // Step 3: Set today's daily fruit rate to ₹140/kg
    // ------------------------------------------------------------------------
    const dailyPriceRes = await page.request.post("/api/prices/daily", {
      data: {
        fruitId: fruit.id,
        unitId: unit.id,
        effectiveDate: todayStr,
        price: 140.0,
        notes: `Daily mandi board rate for run ${runId}`,
      },
    });
    expect(dailyPriceRes.status()).toBe(200);
    const dailyPrice = await dailyPriceRes.json();
    expect(Number(dailyPrice.price)).toBe(140.0);

    // ------------------------------------------------------------------------
    // Step 4: Create a test customer
    // ------------------------------------------------------------------------
    const clientRes = await page.request.post("/api/clients", {
      data: {
        name: `Staging Customer ${runId}`,
        email: `customer.${runId}@wholesale-fruit-billing.internal`,
        phone: "9876543210",
        address: "Shop 42, Wholesale Mandi Yard",
        notes: "Invoice-only V1 verification client",
      },
    });
    expect(clientRes.status()).toBe(201);
    const client = await clientRes.json();
    expect(client.id).toBeDefined();
    expect(client.name).toBe(`Staging Customer ${runId}`);

    // ------------------------------------------------------------------------
    // Step 5: Set a customer-specific negotiated rate of ₹130/kg, effective today
    // ------------------------------------------------------------------------
    const customerPriceRes = await page.request.post(`/api/clients/${client.id}/prices`, {
      data: {
        fruitId: fruit.id,
        unitId: unit.id,
        price: 130.0,
        effectiveFrom: todayStr,
        effectiveTo: null,
        notes: `Negotiated contract rate for run ${runId}`,
      },
    });
    expect(customerPriceRes.status()).toBe(201);
    const customerPrice = await customerPriceRes.json();
    expect(Number(customerPrice.price)).toBe(130.0);

    // ------------------------------------------------------------------------
    // Step 6 & 7: Verify negotiated rate overrides daily rate & create invoice
    // ------------------------------------------------------------------------
    // Verify priority resolution: Contract (₹130) > Daily Board (₹140)
    const resolveRes = await page.request.get(
      `/api/prices/resolve?fruitId=${fruit.id}&unitId=${unit.id}&clientId=${client.id}&date=${todayStr}`
    );
    expect(resolveRes.status()).toBe(200);
    const resolution = await resolveRes.json();
    expect(resolution.price).toBe(130.0);
    expect(resolution.source).toBe("CUSTOMER_CONTRACT");

    // Create the invoice for 14.650 kg with the resolved negotiated rate
    const invoiceQuantity = 14.65;
    const invoiceUnitPrice = 130.0;
    const expectedSubtotal = 1904.5; // 14.650 * 130 = 1904.50

    const invoiceCreateRes = await page.request.post("/api/invoices", {
      data: {
        clientId: client.id,
        status: "PENDING",
        issueDate: todayStr,
        dueDate: todayStr,
        taxRate: 0,
        taxLabel: "GST",
        notes: `Milestone 3 Invoice-Only V1 test invoice ${runId}`,
        items: [
          {
            description: `${fruit.name} - ${fruit.variety} (${unit.code})`,
            quantity: invoiceQuantity,
            price: invoiceUnitPrice,
            fruitId: fruit.id,
            fruitName: fruit.name,
            fruitVariety: fruit.variety,
            unitId: unit.id,
            unitName: unit.code,
            unitPriceSnapshot: invoiceUnitPrice,
          },
        ],
      },
    });
    expect(invoiceCreateRes.status()).toBe(201);
    const invoice = await invoiceCreateRes.json();
    expect(invoice.id).toBeDefined();
    expect(invoice.invoiceNumber).toBeDefined();

    // ------------------------------------------------------------------------
    // Step 8 & 9: Verify subtotal, debt invariant, and zero payment transactions
    // ------------------------------------------------------------------------
    // Subtotal must be ₹1,904.50 before any tax or discount
    expect(Number(invoice.subtotal)).toBe(expectedSubtotal);
    expect(Number(invoice.totalAmount)).toBe(expectedSubtotal);

    // Invariant: Initial invoice has zero paid amount and no payment transaction
    expect(Number(invoice.paidAmount)).toBe(0);
    expect(Number(invoice.balanceAmount)).toBe(expectedSubtotal);
    expect(invoice.paidAt).toBeNull();

    // Line item verification: 3-decimal quantity preserved
    expect(invoice.items).toHaveLength(1);
    expect(Number(invoice.items[0].quantity)).toBe(14.65);
    expect(Number(invoice.items[0].price)).toBe(130.0);
    expect(Number(invoice.items[0].total)).toBe(expectedSubtotal);

    // Re-query invoice directly via GET /api/invoices/:id to verify persisted invariants
    const invoiceGetRes = await page.request.get(`/api/invoices/${invoice.id}`);
    expect(invoiceGetRes.status()).toBe(200);
    const persistedInvoice = await invoiceGetRes.json();
    expect(persistedInvoice.status).toBe("PENDING");
    expect(Number(persistedInvoice.paidAmount)).toBe(0);
    expect(Number(persistedInvoice.balanceAmount)).toBe(expectedSubtotal);
    expect(persistedInvoice.allocations ?? []).toHaveLength(0);

    // ------------------------------------------------------------------------
    // Step 10: Verify PDF response (%PDF signature) and invoice history UI
    // ------------------------------------------------------------------------
    // 10a: Authenticated PDF download stream verification
    const pdfRes = await page.request.get(`/api/invoices/${invoice.id}/pdf`);
    expect(pdfRes.status()).toBe(200);
    const contentType = pdfRes.headers()["content-type"];
    expect(contentType).toContain("application/pdf");

    const pdfBuffer = await pdfRes.body();
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    // Standard PDF header signature check (%PDF-)
    const pdfHeader = pdfBuffer.slice(0, 5).toString("utf-8");
    expect(pdfHeader).toBe("%PDF-");

    // 10b: Public invoice view verification
    await page.goto(`/view/${invoice.id}`);
    await expect(page.getByText(invoice.invoiceNumber)).toBeVisible();
    await expect(page.getByText(client.name)).toBeVisible();
    await expect(page.getByText("Total Due").locator("..").getByText(/1,904\.50/)).toBeVisible();

    // 10c: Admin Invoice detail view verification
    await page.goto(`/invoices/${invoice.id}`);
    await expect(page.getByRole("heading", { name: invoice.invoiceNumber })).toBeVisible();
    await expect(page.getByText(client.name, { exact: true })).toBeVisible();
    await expect(page.getByText(/14\.65/)).toBeVisible();

    // 10d: Invoice history listing verification
    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/invoices/);
    await expect(page.getByText(invoice.invoiceNumber)).toBeVisible();
    await expect(page.getByText(client.name)).toBeVisible();
  });
});
