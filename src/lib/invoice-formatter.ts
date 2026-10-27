/**
 * Canonical Invoice Formatting & View Model Module
 *
 * Provides single-source-of-truth formatting utilities and data transforms
 * across the entire application: PDF rendering, public HTML preview (/view/:id),
 * admin detail page (/invoices/:id), and direct PDF printing.
 */

export interface CanonicalLineItem {
  id: string;
  idx: number;
  description: string;
  fruitName?: string | null;
  fruitVariety?: string | null;
  quantity: number;
  formattedQuantity: string;
  unitCode?: string | null;
  unitName?: string | null;
  price: number;
  formattedPrice: string;
  priceWithUnit: string;
  total: number;
  formattedTotal: string;
  hsnCode?: string | null;
}

export interface CanonicalParty {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  gstin?: string | null;
}

export interface CanonicalStatusInfo {
  status: "PAID" | "PENDING" | "OVERDUE" | "DRAFT" | "VOID";
  label: string;
  isPaid: boolean;
  isPending: boolean;
  isOverdue: boolean;
  isDraft: boolean;
  isVoid: boolean;
  daysOverdue: number;
  bannerTitle: string;
  bannerSubtitle?: string | null;
  theme: {
    text: string;
    bg: string;
    border: string;
    badgeBg: string;
    badgeText: string;
  };
}

export interface CanonicalInvoiceViewModel {
  id: string;
  invoiceNumber: string;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  formattedIssueDate: string;
  formattedDueDate: string;
  statusInfo: CanonicalStatusInfo;
  seller: CanonicalParty;
  customer: CanonicalParty;
  items: CanonicalLineItem[];
  subtotal: number;
  formattedSubtotal: string;
  discountType?: "PERCENT" | "FIXED" | null;
  discountValue?: number | null;
  discountAmount: number;
  formattedDiscount: string;
  hasDiscount: boolean;
  netAmount: number;
  formattedNetAmount: string;
  taxRate: number;
  taxLabel: string;
  taxAmount: number;
  formattedTaxAmount: string;
  totalAmount: number;
  formattedTotalAmount: string;
  paidAmount: number;
  formattedPaidAmount: string;
  balanceAmount: number;
  formattedBalanceAmount: string;
  notes?: string | null;
  logoBase64?: string | null;
  logoContentType?: string | null;
  logoUrl?: string | null;
  brandColor: string;
}

/**
 * Standard monetary formatting using Indian Rupee rules (en-IN)
 * Guarantees proper ₹ symbol, 2 decimal places, and correct grouping.
 */
export function formatInvoiceMoney(
  amount: number | string | { toNumber?: () => number } | null | undefined,
  currency = "INR"
): string {
  if (amount == null) return "₹0.00";
  const num =
    typeof amount === "object" && typeof amount.toNumber === "function"
      ? amount.toNumber()
      : Number(amount);

  if (!Number.isFinite(num)) return "₹0.00";

  const curr = (currency || "INR").toUpperCase();
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: curr,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    const sym = curr === "INR" ? "₹" : `${curr} `;
    return `${sym}${num.toFixed(2)}`;
  }
}

/**
 * Standard date formatting: e.g. "27 Oct 2026"
 * Ensures timeZone consistency across SSR and client rendering.
 */
export function formatInvoiceDate(date: string | Date | number | null | undefined): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";

  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Calcutta",
    }).format(d);
  } catch {
    return d.toDateString();
  }
}

/**
 * Quantity formatting: integers without trailing zeros ("3"),
 * fractional weights preserved up to 3 decimal places ("14.65", "1.500" -> "1.5").
 */
export function formatInvoiceQuantity(
  quantity: number | string | { toNumber?: () => number } | null | undefined
): string {
  if (quantity == null) return "0";
  const num =
    typeof quantity === "object" && typeof quantity.toNumber === "function"
      ? quantity.toNumber()
      : Number(quantity);

  if (!Number.isFinite(num)) return "0";
  if (Number.isInteger(num)) return String(num);

  // Up to 3 decimal places without redundant trailing zeros
  return num.toFixed(3).replace(/\.?0+$/, "");
}

/**
 * Clean item description assembling fruit produce name, variety, and consignment note.
 */
export function formatInvoiceItemDescription(item: {
  fruitName?: string | null;
  fruitVariety?: string | null;
  description: string;
}): string {
  const desc = (item.description || "").trim();
  const name = (item.fruitName || "").trim();
  const variety = (item.fruitVariety || "").trim();

  if (!name) return desc;

  const header = variety ? `${name} (${variety})` : name;
  if (!desc || desc === name || desc === header) {
    return header;
  }
  return `${header} — ${desc}`;
}

/**
 * Resolve status styling and user-friendly labels according to business invariants.
 */
export function resolveInvoiceStatus(
  status: string,
  dueDate: Date | string,
  now = new Date()
): CanonicalStatusInfo {
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const normalizedStatus = (status || "DRAFT").toUpperCase();
  const isPaid = normalizedStatus === "PAID";
  const isVoid = normalizedStatus === "VOID";
  const isDraft = normalizedStatus === "DRAFT";
  const isPending = normalizedStatus === "PENDING" || normalizedStatus === "PARTIALLY_PAID";

  const daysOverdue = isPending && !Number.isNaN(due.getTime())
    ? Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const isOverdue = daysOverdue > 0;

  if (isVoid) {
    return {
      status: "VOID",
      label: "Void",
      isPaid: false,
      isPending: false,
      isOverdue: false,
      isDraft: false,
      isVoid: true,
      daysOverdue: 0,
      bannerTitle: "Void — This invoice has been cancelled and is not payable.",
      bannerSubtitle: null,
      theme: {
        text: "#475569",
        bg: "#f1f5f9",
        border: "#94a3b8",
        badgeBg: "#e2e8f0",
        badgeText: "#475569",
      },
    };
  }

  if (isPaid) {
    return {
      status: "PAID",
      label: "Paid",
      isPaid: true,
      isPending: false,
      isOverdue: false,
      isDraft: false,
      isVoid: false,
      daysOverdue: 0,
      bannerTitle: "Payment Received",
      bannerSubtitle: "Thank you for your business!",
      theme: {
        text: "#15803d",
        bg: "#dcfce7",
        border: "#86efac",
        badgeBg: "#dcfce7",
        badgeText: "#15803d",
      },
    };
  }

  if (isOverdue) {
    return {
      status: "OVERDUE",
      label: "Overdue",
      isPaid: false,
      isPending: true,
      isOverdue: true,
      isDraft: false,
      isVoid: false,
      daysOverdue,
      bannerTitle: `Payment Overdue — ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} past due`,
      bannerSubtitle: `Due date was ${formatInvoiceDate(due)}`,
      theme: {
        text: "#b91c1c",
        bg: "#fee2e2",
        border: "#fca5a5",
        badgeBg: "#fee2e2",
        badgeText: "#b91c1c",
      },
    };
  }

  if (isDraft) {
    return {
      status: "DRAFT",
      label: "Draft",
      isPaid: false,
      isPending: false,
      isOverdue: false,
      isDraft: true,
      isVoid: false,
      daysOverdue: 0,
      bannerTitle: "Draft Invoice",
      bannerSubtitle: "This invoice has not been issued to the client.",
      theme: {
        text: "#64748b",
        bg: "#f8fafc",
        border: "#cbd5e1",
        badgeBg: "#f1f5f9",
        badgeText: "#64748b",
      },
    };
  }

  // Regular pending
  return {
    status: "PENDING",
    label: "Awaiting Payment",
    isPaid: false,
    isPending: true,
    isOverdue: false,
    isDraft: false,
    isVoid: false,
    daysOverdue: 0,
    bannerTitle: "Payment Pending",
    bannerSubtitle: `Payment due by ${formatInvoiceDate(due)}`,
    theme: {
      text: "#b45309",
      bg: "#fef3c7",
      border: "#fcd34d",
      badgeBg: "#fef3c7",
      badgeText: "#b45309",
    },
  };
}

/**
 * Builds the canonical view model from raw invoice record + settings.
 */
export function buildCanonicalInvoiceViewModel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings?: any
): CanonicalInvoiceViewModel {
  const currency = settings?.currency || invoice?.currency || "INR";
  const brandColor = settings?.brandColor || "#173D32";

  const issueDate = new Date(invoice.issueDate || invoice.createdAt);
  const dueDate = new Date(invoice.dueDate || invoice.issueDate);

  const statusInfo = resolveInvoiceStatus(invoice.status, dueDate);

  const subtotal = Number(invoice.subtotal) || 0;
  const discVal = invoice.discountAmount != null ? Number(invoice.discountAmount) : 0;
  const discountAmount = Number.isFinite(discVal) ? discVal : 0;
  const netAmount = Math.max(0, subtotal - discountAmount);
  const taxRate = Number(invoice.taxRate) || 0;
  const taxLabel = ((invoice.taxLabel as string) || "GST").trim().toUpperCase();
  const taxAmount = (netAmount * taxRate) / 100;
  const totalAmount = Number(invoice.totalAmount) || 0;
  const paidAmount = Number(invoice.paidAmount) || 0;
  const balanceAmount = Math.max(0, totalAmount - paidAmount);

  // Line items
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawItems = Array.isArray(invoice.items) ? invoice.items : [];
  const items: CanonicalLineItem[] = rawItems.map((it: any, idx: number) => {
    const qty = Number(it.quantity) || 0;
    const price = Number(it.price) || 0;
    const itemTotal = Number(it.total) || qty * price;
    const unitName = (it.unitName || it.unitCode || "").trim();

    return {
      id: it.id || `item-${idx}`,
      idx: idx + 1,
      description: formatInvoiceItemDescription(it),
      fruitName: it.fruitName || null,
      fruitVariety: it.fruitVariety || null,
      quantity: qty,
      formattedQuantity: formatInvoiceQuantity(qty),
      unitCode: it.unitCode || null,
      unitName: unitName || null,
      price,
      formattedPrice: formatInvoiceMoney(price, currency),
      priceWithUnit: unitName ? `${formatInvoiceMoney(price, currency)} / ${unitName}` : formatInvoiceMoney(price, currency),
      total: itemTotal,
      formattedTotal: formatInvoiceMoney(itemTotal, currency),
      hsnCode: it.hsnCode || null,
    };
  });

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    currency,
    issueDate,
    dueDate,
    formattedIssueDate: formatInvoiceDate(issueDate),
    formattedDueDate: formatInvoiceDate(dueDate),
    statusInfo,
    seller: {
      name: settings?.companyName || "Your Business Name",
      email: settings?.companyEmail || null,
      phone: settings?.companyPhone || null,
      address: settings?.companyAddress || null,
    },
    customer: {
      name: invoice.client?.name || "Valued Customer",
      email: invoice.client?.email || null,
      phone: invoice.client?.phone || null,
      address: invoice.client?.address || null,
      gstin: invoice.client?.gstin || null,
    },
    items,
    subtotal,
    formattedSubtotal: formatInvoiceMoney(subtotal, currency),
    discountType: invoice.discountType || null,
    discountValue: invoice.discountValue != null ? Number(invoice.discountValue) : null,
    discountAmount,
    formattedDiscount: `-${formatInvoiceMoney(discountAmount, currency)}`,
    hasDiscount: discountAmount > 0,
    netAmount,
    formattedNetAmount: formatInvoiceMoney(netAmount, currency),
    taxRate,
    taxLabel,
    taxAmount,
    formattedTaxAmount: formatInvoiceMoney(taxAmount, currency),
    totalAmount,
    formattedTotalAmount: formatInvoiceMoney(totalAmount, currency),
    paidAmount,
    formattedPaidAmount: formatInvoiceMoney(paidAmount, currency),
    balanceAmount,
    formattedBalanceAmount: formatInvoiceMoney(balanceAmount, currency),
    notes: invoice.notes?.trim() || null,
    logoBase64: settings?.logoBase64 || null,
    logoContentType: settings?.logoContentType || null,
    logoUrl: settings?.logoUrl || null,
    brandColor,
  };
}
