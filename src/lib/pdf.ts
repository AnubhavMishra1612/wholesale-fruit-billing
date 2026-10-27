/**
 * Server-side PDF rendering helpers — Authoritative Invoice PDF Generator.
 *
 * Employs a single canonical invoice view model so the PDF layout, typography,
 * currency symbols, and label alignment represent the authoritative invoice design.
 */
import { prisma } from "@/lib/prisma";
import { getBrandingForUser, darken, DEFAULT_BRAND_COLOR } from "@/lib/branding";
import type { InvoiceWithRelations } from "@/types";
import {
  buildCanonicalInvoiceViewModel,
  CanonicalInvoiceViewModel,
} from "@/lib/invoice-formatter";

export interface PdfSettings {
  companyName: string;
  companyEmail: string;
  companyAddress?: string | null;
  companyPhone?: string | null;
  currency: string;
  logoBase64?: string | null;
  logoContentType?: string | null;
  logoUrl?: string | null;
  brandColor?: string;
}

export interface InvoicePdfData {
  invoice: InvoiceWithRelations;
  settings: PdfSettings;
  filename: string;
}

/**
 * Resolve an invoice + the settings to render on its PDF.
 */
export async function loadInvoiceForPdf(
  invoiceId: string,
  userId?: string
): Promise<InvoicePdfData> {
  const invoice = userId
    ? await prisma.invoice.findFirst({
        where: { id: invoiceId, userId },
        include: { client: true, items: { orderBy: { id: "asc" } } },
      })
    : await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { client: true, items: { orderBy: { id: "asc" } } },
      });

  if (!invoice) {
    const err = new Error("Invoice not found");
    (err as { status?: number }).status = 404;
    throw err;
  }

  const settings = await prisma.settings.findUnique({
    where: { userId: invoice.userId },
  });

  const currency = settings?.currency || "INR";
  const companyName = settings?.companyName || "Your Business Name";
  const companyEmail = settings?.companyEmail || "billing@example.com";

  const branding = await getBrandingForUser(invoice.userId);

  return {
    invoice,
    settings: {
      companyName,
      companyEmail,
      companyAddress: settings?.companyAddress ?? null,
      companyPhone: settings?.companyPhone ?? null,
      currency,
      logoBase64: branding.logoData,
      logoContentType: branding.logoContentType,
      logoUrl: branding.logoDataUri || branding.logoUrl,
      brandColor: branding.brandColor,
    },
    filename: buildPdfFilename(invoice.invoiceNumber),
  };
}

export function buildPdfFilename(invoiceNumber: string): string {
  const safe = invoiceNumber.replace(/[^\w.-]+/g, "_");
  return `Invoice_${safe}.pdf`;
}

type PdfLib = {
  renderToBuffer: (el: React.ReactElement) => Promise<Buffer>;
  Document: React.ComponentType<Record<string, unknown>>;
  Page: React.ComponentType<Record<string, unknown>>;
  View: React.ComponentType<Record<string, unknown>>;
  Text: React.ComponentType<Record<string, unknown>>;
  Link: React.ComponentType<Record<string, unknown>>;
  Image: React.ComponentType<Record<string, unknown>>;
  StyleSheet: {
    create: <T extends Record<string, Record<string, unknown>>>(styles: T) => T;
  };
};

let _pdfLib: PdfLib | null = null;
let _React: typeof import("react") | null = null;

async function loadPdfDeps(): Promise<{ React: typeof import("react"); pdfLib: PdfLib }> {
  if (_pdfLib && _React) return { React: _React, pdfLib: _pdfLib };
  const reactMod = await import("react");
  const R = (reactMod.default ?? reactMod) as unknown as typeof import("react");
  const pdfMod = (await import("@react-pdf/renderer")) as unknown as Record<string, unknown>;

  const hasNamed = typeof pdfMod.renderToBuffer === "function";
  const candidate = (hasNamed ? pdfMod : (pdfMod.default ?? pdfMod)) as Record<string, unknown>;
  _React = R;
  _pdfLib = candidate as unknown as PdfLib;

  try {
    const { registerPdfFonts } = await import("@/lib/pdf-fonts");
    const Font = (candidate as unknown as { Font?: { register: (opts: unknown) => void } }).Font;
    if (Font) await registerPdfFonts(Font);
  } catch (fontErr) {
    console.warn("[pdf] Font registration failed, using default fonts:", (fontErr as Error).message);
  }
  return { React: R, pdfLib: _pdfLib };
}

/**
 * Render the canonical invoice React tree to an authoritative PDF Buffer.
 */
export async function renderInvoicePdfToBuffer(
  data: InvoicePdfData
): Promise<Buffer> {
  const { React, pdfLib } = await loadPdfDeps();
  const { Document, Page, View, Text, Link, Image, StyleSheet, renderToBuffer } = pdfLib;
  const { invoice, settings } = data;

  const vm: CanonicalInvoiceViewModel = buildCanonicalInvoiceViewModel(invoice, settings);

  const rawBrand = vm.brandColor;
  const brand = rawBrand && typeof rawBrand === "string" && /^#([0-9a-fA-F]{3}){1,2}$/.test(rawBrand)
    ? (rawBrand.length === 4
        ? `#${rawBrand[1]}${rawBrand[1]}${rawBrand[2]}${rawBrand[2]}${rawBrand[3]}${rawBrand[3]}`
        : rawBrand.toLowerCase())
    : DEFAULT_BRAND_COLOR;
  const brandDark = darken(brand, 0.22);

  const brandTint = (() => {
    const h = brand.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * 0.94);
    return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  })();

  const palette = {
    primary: brand,
    primaryDark: brandDark,
    primarySoft: brandTint,
    text: "#0f172a",
    textSub: "#334155",
    muted: "#64748b",
    border: "#e2e8f0",
    bgSoft: "#f8fafc",
    paid: "#dcfce7",
    paidText: "#15803d",
    warning: "#b45309",
    warningBg: "#fef3c7",
    warningBorder: "#fcd34d",
    overdueBg: "#fee2e2",
    overdueBorder: "#fca5a5",
    overdueText: "#b91c1c",
    draftBg: "#f1f5f9",
  };

  const styles = StyleSheet.create({
    page: {
      padding: "36 44 75 44",
      fontFamily: "NotoSans",
      color: palette.text,
      fontSize: 9.5,
      lineHeight: 1.4,
      backgroundColor: "#ffffff",
    },
    accentBar: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 5,
      backgroundColor: palette.primary,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 18,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    brandLeft: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      maxWidth: "56%",
    },
    brandMark: {
      width: 42,
      height: 42,
      borderRadius: 6,
      backgroundColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 2,
    },
    brandMarkText: {
      color: "white",
      fontSize: 18,
      fontWeight: "bold",
      lineHeight: 1.2,
    },
    brandLogo: {
      maxHeight: 52,
      maxWidth: 160,
      objectFit: "contain" as const,
    },
    companyDetails: {
      flexDirection: "column",
      justifyContent: "flex-start",
    },
    companyTitle: {
      fontSize: 15,
      fontWeight: "bold",
      color: palette.text,
      lineHeight: 1.25,
      marginBottom: 3,
    },
    companyLine: {
      fontSize: 8.5,
      lineHeight: 1.35,
      color: palette.textSub,
      marginTop: 1,
    },
    companyLink: {
      fontSize: 8.5,
      lineHeight: 1.35,
      color: palette.primary,
      textDecoration: "none",
      marginTop: 1,
    },
    headerRight: {
      flexDirection: "column",
      alignItems: "flex-end",
      justifyContent: "flex-start",
      minWidth: 160,
      maxWidth: "42%",
      textAlign: "right",
    },
    invoiceTitle: {
      fontSize: 22,
      lineHeight: 1.15,
      fontWeight: "bold",
      color: palette.primaryDark,
      textAlign: "right",
      marginBottom: 3,
    },
    invoiceNumber: {
      fontSize: 10,
      lineHeight: 1.25,
      fontWeight: "bold",
      color: palette.textSub,
      textAlign: "right",
      marginBottom: 6,
    },
    statusRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      marginBottom: 8,
    },
    statusPill: {
      paddingHorizontal: 8,
      paddingVertical: 2.5,
      borderRadius: 4,
      fontSize: 8,
      fontWeight: "bold",
      textTransform: "uppercase",
      lineHeight: 1.2,
    },
    amountDueBlock: {
      alignItems: "flex-end",
    },
    amountDueLabel: {
      fontSize: 7.5,
      lineHeight: 1.2,
      color: palette.muted,
      textTransform: "uppercase",
      fontWeight: "bold",
      textAlign: "right",
    },
    amountDue: {
      fontSize: 16,
      lineHeight: 1.25,
      fontWeight: "bold",
      color: palette.primary,
      textAlign: "right",
      marginTop: 2,
    },

    // Parties
    parties: {
      flexDirection: "row",
      gap: 12,
      marginBottom: 14,
    },
    partyCard: {
      flex: 1,
      padding: 10,
      borderRadius: 5,
      backgroundColor: palette.bgSoft,
      borderWidth: 1,
      borderColor: palette.border,
    },
    partyCardBillTo: {
      backgroundColor: palette.primarySoft,
      borderColor: palette.primary,
    },
    partyLabel: {
      fontSize: 8,
      color: palette.muted,
      textTransform: "uppercase",
      fontWeight: "bold",
      marginBottom: 4,
    },
    partyLabelBillTo: {
      color: palette.primaryDark,
    },
    partyName: {
      fontSize: 11,
      fontWeight: "bold",
      marginBottom: 2,
    },
    partyLine: {
      fontSize: 8.5,
      color: palette.textSub,
      marginBottom: 1,
    },
    partyLink: {
      fontSize: 8.5,
      color: palette.primary,
      textDecoration: "none",
      marginBottom: 1,
    },

    // Meta row: Dates + GST
    meta: {
      flexDirection: "row",
      backgroundColor: palette.bgSoft,
      borderRadius: 5,
      padding: 8,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: palette.border,
    },
    metaCell: {
      flex: 1,
      paddingHorizontal: 6,
      borderRightWidth: 1,
      borderRightColor: palette.border,
    },
    metaCellLast: {
      flex: 1,
      paddingHorizontal: 6,
    },
    metaLabel: {
      fontSize: 7.5,
      color: palette.muted,
      textTransform: "uppercase",
      fontWeight: "bold",
      marginBottom: 2,
    },
    metaValue: {
      fontSize: 9.5,
      fontWeight: "bold",
      color: palette.text,
    },

    // Table
    table: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 5,
      marginBottom: 12,
    },
    tableHeader: {
      flexDirection: "row",
      backgroundColor: palette.bgSoft,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
      paddingVertical: 6,
      paddingHorizontal: 8,
    },
    tableHeaderCell: {
      fontSize: 8,
      color: palette.muted,
      textTransform: "uppercase",
      fontWeight: "bold",
    },
    tableHeaderCellCenter: {
      fontSize: 8,
      color: palette.muted,
      textTransform: "uppercase",
      fontWeight: "bold",
      textAlign: "center",
    },
    tableHeaderCellRight: {
      fontSize: 8,
      color: palette.muted,
      textTransform: "uppercase",
      fontWeight: "bold",
      textAlign: "right",
    },
    tableRow: {
      flexDirection: "row",
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
      alignItems: "center",
    },
    tableRowLast: {
      flexDirection: "row",
      paddingVertical: 6,
      paddingHorizontal: 8,
      alignItems: "center",
    },
    colIdx: { width: "5%" },
    colDesc: { width: "45%" },
    colQty: { width: "12%" },
    colUnit: { width: "10%" },
    colPrice: { width: "14%" },
    colAmount: { width: "14%" },
    idxCell: { fontSize: 8.5, color: palette.muted },
    descCell: { fontSize: 9, color: palette.text },
    unitCell: { fontSize: 8.5, textAlign: "center", color: palette.textSub },
    numCell: { fontSize: 9, textAlign: "right", color: palette.text },
    numCellBold: { fontSize: 9, fontWeight: "bold", textAlign: "right", color: palette.text },

    // Totals
    totalsWrap: {
      flexDirection: "row",
      justifyContent: "flex-end",
      marginBottom: 12,
    },
    totalsBox: {
      width: "50%",
      padding: 10,
      backgroundColor: palette.bgSoft,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: palette.border,
    },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    totalRowLast: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingTop: 6,
      marginTop: 4,
      borderTopWidth: 1,
      borderTopColor: palette.border,
    },
    totalLabel: {
      fontSize: 9,
      color: palette.muted,
    },
    totalLabelBig: {
      fontSize: 11,
      fontWeight: "bold",
      color: palette.text,
    },
    totalValue: {
      fontSize: 9,
      fontWeight: "bold",
      color: palette.text,
    },
    totalValueBig: {
      fontSize: 14,
      fontWeight: "bold",
      color: palette.primary,
    },

    // Banner & Notes
    banner: {
      padding: 8,
      borderRadius: 5,
      marginBottom: 10,
      borderWidth: 1,
    },
    bannerText: {
      fontSize: 8.5,
      fontWeight: "bold",
    },
    bannerSub: {
      fontSize: 8,
      marginTop: 1.5,
      color: palette.textSub,
    },
    notesCard: {
      padding: 10,
      backgroundColor: palette.bgSoft,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: palette.border,
      marginBottom: 12,
    },
    notesLabel: {
      fontSize: 7.5,
      color: palette.muted,
      textTransform: "uppercase",
      fontWeight: "bold",
      marginBottom: 3,
    },
    notesText: {
      fontSize: 8.5,
      color: palette.textSub,
    },    // Footer
    footer: {
      position: "absolute",
      bottom: 22,
      left: 44,
      right: 44,
      borderTopWidth: 1,
      borderTopColor: palette.border,
      paddingTop: 8,
    },
    footerMainRow: {
      flexDirection: "row",
      justifyContent: "flex-start",
      alignItems: "center",
      marginBottom: 3,
    },
    footerThanks: {
      fontSize: 8.5,
      fontWeight: "bold",
      color: palette.textSub,
      lineHeight: 1.25,
    },
    footerPageNum: {
      position: "absolute",
      right: 0,
      top: 8,
      fontSize: 8,
      color: palette.muted,
      textAlign: "right",
      lineHeight: 1.25,
    },
    footerMetaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    footerCompany: {
      fontSize: 7.5,
      color: palette.muted,
      lineHeight: 1.25,
    },
    footerMeta: {
      fontSize: 7.5,
      color: palette.muted,
      textAlign: "right",
      lineHeight: 1.25,
    },
  });

  const companyInitial = (vm.seller.name || "S").charAt(0).toUpperCase();

  const resolvedLogo = (() => {
    const raw = (vm.logoBase64 || vm.logoUrl || "").trim();
    if (!raw) return null;
    if (raw.startsWith("data:") || raw.startsWith("http://") || raw.startsWith("https://")) {
      return raw;
    }
    try {
      const buf = Buffer.from(raw, "base64");
      if (buf.length > 8) {
        const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
        return {
          data: buf,
          format: (isJpeg ? "jpg" : "png") as "jpg" | "png",
        };
      }
    } catch (e) {
      console.warn("[pdf] Failed to parse logo base64 buffer:", e);
    }
    return null;
  })();

  const statusPillStyle = {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 4,
    fontSize: 8,
    fontWeight: "bold",
    textTransform: "uppercase",
    backgroundColor: vm.statusInfo.theme.badgeBg,
    color: vm.statusInfo.theme.badgeText,
  };

  const banner = (() => {
    if (vm.statusInfo.isPaid) {
      return (
        React.createElement(View, { style: [styles.banner, { backgroundColor: palette.paid, borderColor: "#86efac" }], key: "banner", wrap: false },
          React.createElement(Text, { style: [styles.bannerText, { color: palette.paidText }] }, "Payment Received — Full payment has been credited to your account.")
        )
      );
    }
    if (vm.statusInfo.isOverdue) {
      return (
        React.createElement(View, { style: [styles.banner, { backgroundColor: palette.overdueBg, borderColor: palette.overdueBorder }], key: "banner", wrap: false },
          React.createElement(Text, { style: [styles.bannerText, { color: palette.overdueText }] },
            vm.statusInfo.bannerTitle
          )
        )
      );
    }
    if (vm.statusInfo.isVoid) {
      return (
        React.createElement(View, { style: [styles.banner, { backgroundColor: "#f1f5f9", borderColor: "#94a3b8" }], key: "banner", wrap: false },
          React.createElement(Text, { style: [styles.bannerText, { color: "#475569" }] }, vm.statusInfo.bannerTitle)
        )
      );
    }
    if (vm.statusInfo.isPending) {
      return (
        React.createElement(View, { style: [styles.banner, { backgroundColor: palette.warningBg, borderColor: palette.warningBorder }], key: "banner", wrap: false },
          React.createElement(Text, { style: [styles.bannerText, { color: palette.warning }] }, "Payment Pending"),
          React.createElement(Text, { style: styles.bannerSub }, `Due by ${vm.formattedDueDate}`)
        )
      );
    }
    return (
      React.createElement(View, { style: [styles.banner, { backgroundColor: palette.draftBg, borderColor: palette.border }], key: "banner", wrap: false },
        React.createElement(Text, { style: [styles.bannerText, { color: "#64748b" }] }, "Draft — This invoice has not been sent to the client.")
      )
    );
  })();

  const doc = React.createElement(
    Document,
    {
      title: `${vm.invoiceNumber} - ${vm.seller.name}`,
      author: vm.seller.name,
      subject: `Invoice ${vm.invoiceNumber} for ${vm.customer.name}`,
    },
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(View, { style: styles.accentBar, fixed: true }),

      // Header
      React.createElement(View, { style: styles.header },
        React.createElement(View, { style: styles.brandLeft },
          resolvedLogo
            ? React.createElement(Image, {
                key: "logo",
                style: styles.brandLogo,
                src: resolvedLogo,
              })
            : React.createElement(View, { key: "mark", style: styles.brandMark },
                React.createElement(Text, { style: styles.brandMarkText }, companyInitial)
              ),
          React.createElement(View, { style: styles.companyDetails },
            React.createElement(Text, { style: styles.companyTitle }, vm.seller.name),
            vm.seller.email ? React.createElement(Link, { src: `mailto:${vm.seller.email}`, style: styles.companyLink }, vm.seller.email) : null,
            vm.seller.phone ? React.createElement(Text, { style: styles.companyLine }, vm.seller.phone) : null,
            vm.seller.address ? React.createElement(Text, { style: styles.companyLine }, vm.seller.address) : null
          )
        ),
        React.createElement(View, { style: styles.headerRight },
          React.createElement(Text, { style: styles.invoiceTitle }, "INVOICE"),
          React.createElement(Text, { style: styles.invoiceNumber }, vm.invoiceNumber),
          React.createElement(View, { style: styles.statusRow },
            React.createElement(View, { style: statusPillStyle },
              React.createElement(Text, null, vm.statusInfo.label)
            )
          ),
          React.createElement(View, { style: styles.amountDueBlock },
            React.createElement(Text, { style: styles.amountDueLabel }, "Total Due"),
            React.createElement(Text, { style: styles.amountDue }, vm.formattedTotalAmount)
          )
        )
      ),

      // Parties
      React.createElement(View, { style: styles.parties },
        React.createElement(View, { style: styles.partyCard },
          React.createElement(Text, { style: styles.partyLabel }, "From"),
          React.createElement(Text, { style: styles.partyName }, vm.seller.name),
          vm.seller.email ? React.createElement(Link, { src: `mailto:${vm.seller.email}`, style: styles.partyLink }, vm.seller.email) : null,
          vm.seller.phone ? React.createElement(Text, { style: styles.partyLine }, vm.seller.phone) : null,
          vm.seller.address ? React.createElement(Text, { style: styles.companyLine }, vm.seller.address) : null
        ),
        React.createElement(View, { style: [styles.partyCard, styles.partyCardBillTo] },
          React.createElement(Text, { style: [styles.partyLabel, styles.partyLabelBillTo] }, "Bill To"),
          React.createElement(Text, { style: styles.partyName }, vm.customer.name),
          vm.customer.email ? React.createElement(Link, { src: `mailto:${vm.customer.email}`, style: styles.partyLink }, vm.customer.email) : null,
          vm.customer.phone ? React.createElement(Text, { style: styles.partyLine }, vm.customer.phone) : null,
          vm.customer.address ? React.createElement(Text, { style: styles.companyLine }, vm.customer.address) : null,
          vm.customer.gstin ? React.createElement(Text, { style: styles.partyLine }, `GSTIN: ${vm.customer.gstin}`) : null
        )
      ),

      // Dates & GST Meta
      React.createElement(View, { style: styles.meta },
        React.createElement(View, { style: styles.metaCell },
          React.createElement(Text, { style: styles.metaLabel }, "Issue Date"),
          React.createElement(Text, { style: styles.metaValue }, vm.formattedIssueDate)
        ),
        React.createElement(View, { style: styles.metaCell },
          React.createElement(Text, { style: styles.metaLabel }, "Due Date"),
          React.createElement(Text, { style: styles.metaValue }, vm.formattedDueDate)
        ),
        React.createElement(View, { style: styles.metaCellLast },
          React.createElement(Text, { style: styles.metaLabel }, `${vm.taxLabel} Rate`),
          React.createElement(Text, { style: styles.metaValue }, `${vm.taxRate}%`)
        )
      ),

      // Line Items Table with Repeated Header
      React.createElement(View, { style: styles.table },
        React.createElement(View, { style: styles.tableHeader, fixed: true },
          React.createElement(View, { style: styles.colIdx }, React.createElement(Text, { style: styles.tableHeaderCell }, "#")),
          React.createElement(View, { style: styles.colDesc }, React.createElement(Text, { style: styles.tableHeaderCell }, "Description")),
          React.createElement(View, { style: styles.colQty }, React.createElement(Text, { style: styles.tableHeaderCellRight }, "Qty")),
          React.createElement(View, { style: styles.colUnit }, React.createElement(Text, { style: styles.tableHeaderCellCenter }, "Unit")),
          React.createElement(View, { style: styles.colPrice }, React.createElement(Text, { style: styles.tableHeaderCellRight }, "Unit Price")),
          React.createElement(View, { style: styles.colAmount }, React.createElement(Text, { style: styles.tableHeaderCellRight }, "Amount"))
        ),
        ...vm.items.map((it, i) =>
          React.createElement(
            View,
            { key: it.id, style: i === vm.items.length - 1 ? styles.tableRowLast : styles.tableRow, wrap: false },
            React.createElement(View, { style: styles.colIdx }, React.createElement(Text, { style: styles.idxCell }, String(it.idx))),
            React.createElement(View, { style: styles.colDesc }, React.createElement(Text, { style: styles.descCell }, it.description)),
            React.createElement(View, { style: styles.colQty }, React.createElement(Text, { style: styles.numCell }, it.formattedQuantity)),
            React.createElement(View, { style: styles.colUnit }, React.createElement(Text, { style: styles.unitCell }, it.unitName || "-")),
            React.createElement(View, { style: styles.colPrice }, React.createElement(Text, { style: styles.numCell }, it.formattedPrice)),
            React.createElement(View, { style: styles.colAmount }, React.createElement(Text, { style: styles.numCellBold }, it.formattedTotal))
          )
        )
      ),

      // Totals Box
      React.createElement(View, { style: styles.totalsWrap, wrap: false },
        React.createElement(View, { style: styles.totalsBox },
          React.createElement(View, { style: styles.totalRow },
            React.createElement(Text, { style: styles.totalLabel }, "Subtotal"),
            React.createElement(Text, { style: styles.totalValue }, vm.formattedSubtotal)
          ),
          vm.hasDiscount
            ? React.createElement(View, { key: "disc", style: styles.totalRow },
                React.createElement(Text, { style: [styles.totalLabel, { color: "#059669" }] }, "Discount"),
                React.createElement(Text, { style: [styles.totalValue, { color: "#059669" }] }, vm.formattedDiscount)
              )
            : null,
          React.createElement(View, { style: styles.totalRow },
            React.createElement(Text, { style: styles.totalLabel }, `${vm.taxLabel} (${vm.taxRate}%)`),
            React.createElement(Text, { style: styles.totalValue }, vm.formattedTaxAmount)
          ),
          React.createElement(View, { style: styles.totalRowLast },
            React.createElement(Text, { style: styles.totalLabelBig }, "Total Due"),
            React.createElement(Text, { style: styles.totalValueBig }, vm.formattedTotalAmount)
          )
        )
      ),

      banner,

      vm.notes
        ? React.createElement(View, { style: styles.notesCard, key: "notes", wrap: false },
            React.createElement(Text, { style: styles.notesLabel }, "Notes / Terms"),
            React.createElement(Text, { style: styles.notesText }, vm.notes)
          )
        : null,

      // Footer with Page Numbers & Thank-you message
      React.createElement(View, { style: styles.footer, fixed: true, wrap: false },
        React.createElement(View, { style: styles.footerMainRow },
          React.createElement(Text, { style: styles.footerThanks }, "Thank you for your business!")
        ),
        React.createElement(View, { style: styles.footerMetaRow },
          React.createElement(Text, { style: styles.footerCompany }, vm.seller.name),
          React.createElement(Text, { style: styles.footerMeta }, `${vm.invoiceNumber} • ${vm.formattedIssueDate}`)
        ),
        React.createElement(Text, {
          style: styles.footerPageNum,
          render: ({ pageNumber, totalPages }: any) => `Page ${pageNumber} of ${totalPages}`,
        })
      )
    )
  );

  return renderToBuffer(doc);
}
