"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Printer,
  CheckCircle2,
  Trash2,
  Clock,
  FileText,
  Loader2,
  Building2,
  Mail,
  MapPin,
  Calendar,
  Phone,
  Receipt,
  Pencil,
  Ban,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { formatMoney } from "@/lib/format-money";
import type { InvoiceWithRelations, InvoiceStatus } from "@/types";
import { SendInvoiceButton } from "@/components/invoices/send-invoice-button";
import { DownloadPdfButton } from "@/components/invoices/download-pdf-button";
import { RemindInvoiceButton } from "@/components/invoices/remind-invoice-button";
import { PayInvoiceButton } from "@/components/invoices/pay-invoice-button";
import { ActivityTimeline } from "@/components/invoices/activity-timeline";
import { DuplicateInvoiceButton } from "@/components/invoices/duplicate-invoice-button";
import { CopyLinkButton } from "@/components/invoices/copy-link-button";
import { VoidInvoiceButton } from "@/components/invoices/void-invoice-button";
import { buildCanonicalInvoiceViewModel } from "@/lib/invoice-formatter";
import { CanonicalInvoiceSheet } from "@/components/invoices/canonical-invoice-sheet";
import { printInvoicePdf } from "@/lib/print-pdf";

interface PaymentGatewayConfig {
  stripe: boolean;
  razorpay: boolean;
  razorpayKeyId?: string | null;
}

interface CompanySettings {
  companyName: string;
  companyEmail: string;
  companyAddress?: string | null;
  companyPhone?: string | null;
  currency: string;
  defaultTaxRate: number | string;
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const config: Record<
    InvoiceStatus,
    { variant: "draft" | "warning" | "success" | "neutral"; label: string; icon: typeof Clock }
  > = {
    DRAFT: { variant: "draft", label: "Draft", icon: Clock },
    PENDING: { variant: "warning", label: "Pending", icon: Clock },
    PARTIALLY_PAID: { variant: "warning", label: "Partially Paid", icon: Clock },
    PAID: { variant: "success", label: "Paid", icon: CheckCircle2 },
    VOID: { variant: "neutral", label: "Void", icon: Ban },
  };
  const { variant, label, icon: Icon } = config[status];
  return (
    <Badge variant={variant} className="gap-1 text-xs px-2.5 py-1">
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [invoice, setInvoice] = useState<InvoiceWithRelations | null>(null);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [payments, setPayments] = useState<PaymentGatewayConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<"markPaid" | "delete" | "print" | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invRes, setRes, payRes] = await Promise.all([
        fetch(`/api/invoices/${id}`, { cache: "no-store" }),
        fetch(`/api/settings`, { cache: "no-store" }),
        fetch(`/api/site/payments`, { cache: "no-store" }),
      ]);
      if (invRes.status === 404) { setError("Invoice not found"); return; }
      if (!invRes.ok) throw new Error("Failed to load invoice");
      const inv: InvoiceWithRelations = await invRes.json();
      setInvoice(inv);
      if (setRes.ok) {
        const s: CompanySettings = await setRes.json();
        setSettings(s);
      }
      if (payRes.ok) {
        const p: PaymentGatewayConfig = await payRes.json();
        setPayments(p);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchAll(); }, 0);
    return () => clearTimeout(timer);
  }, [fetchAll]);

  async function handleMarkPaid() {
    if (!invoice || !confirm("Mark this invoice as paid?")) return;
    setActionLoading("markPaid");
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PAID" }),
      });
      if (res.ok) {
        await fetchAll();
        toast.success("Invoice marked as paid", { description: invoice.invoiceNumber });
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to mark as paid");
      }
    } finally { setActionLoading(null); }
  }

  async function handleDelete() {
    if (!invoice) return;
    if (!confirm("Are you sure you want to delete this invoice? This cannot be undone.")) return;
    setActionLoading("delete");
    try {
      const res = await fetch(`/api/invoices/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Invoice deleted");
        router.push("/invoices");
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to delete invoice");
        setActionLoading(null);
      }
    } catch {
      toast.error("Network error — please try again");
      setActionLoading(null);
    }
  }

  async function handlePrint() {
    if (!invoice) return;
    setActionLoading("print");
    try {
      await printInvoicePdf(`/api/invoices/${invoice.id}/pdf`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to print invoice PDF");
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-slate-500 mt-3">Loading invoice...</p>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="text-center py-24">
        <FileText className="h-12 w-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
        <p className="font-medium text-slate-700 dark:text-slate-200">{error ?? "Invoice not found"}</p>
        <Link href="/invoices" className="inline-block mt-4">
          <Button variant="outline">Back to Invoices</Button>
        </Link>
      </div>
    );
  }

  const subtotalNum = Number(invoice.subtotal);
  const discountAmountNum = Number(invoice.discountAmount ?? 0);
  const netNum = subtotalNum - discountAmountNum;
  const taxRateNum = Number(invoice.taxRate);
  const taxLabel =
    (invoice as unknown as { taxLabel?: string }).taxLabel || "GST";
  const taxAmount = (netNum * taxRateNum) / 100;
  const totalNum = Number(invoice.totalAmount);
  const currency = settings?.currency ?? "INR";

  const companyName = settings?.companyName || "Your Business Name";
  const companyEmail = settings?.companyEmail || "billing@example.com";
  const companyAddress = settings?.companyAddress || "";
  const companyPhone = settings?.companyPhone || "";

  const isPaid = invoice.status === "PAID";
  const isPending = invoice.status === "PENDING";
  const isDraft = invoice.status === "DRAFT";
  const isVoid = invoice.status === "VOID";

  const dueDate = new Date(invoice.dueDate);
  const issueDate = new Date(invoice.issueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysOverdue = isPending ? Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
  const isOverdue = daysOverdue > 0;

  const vm = buildCanonicalInvoiceViewModel(invoice, settings);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between no-print">
        <div className="flex items-center gap-3">
          <Link href="/invoices">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-mono">{invoice.invoiceNumber}</h1>
              <StatusBadge status={invoice.status} />
              {isOverdue && (
                <Badge variant="destructive" className="gap-1">
                  <Clock className="h-3 w-3" />
                  {daysOverdue}d overdue
                </Badge>
              )}
            </div>
            <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm">
              Created {formatDate(invoice.createdAt)} · {invoice.client.name}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isVoid && (
            <Link href={`/invoices/${invoice.id}/edit`}>
              <Button variant="outline">
                <Pencil className="h-4 w-4 mr-2" /> Edit
              </Button>
            </Link>
          )}
          {(isPending || isDraft) && (
            <SendInvoiceButton invoiceId={invoice.id} clientEmail={invoice.client.email} />
          )}
          {isPending && (
            <>
              {payments && (payments.stripe || payments.razorpay) ? (
                payments.razorpay && !payments.stripe ? (
                  <PayInvoiceButton
                    invoiceId={invoice.id}
                    alreadyPaid={isPaid}
                    size="default"
                    provider="razorpay"
                    razorpayKeyId={payments.razorpayKeyId}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/25"
                  />
                ) : (
                  <PayInvoiceButton
                    invoiceId={invoice.id}
                    alreadyPaid={isPaid}
                    size="default"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/25"
                  />
                )
              ) : (
                <PayInvoiceButton
                  invoiceId={invoice.id}
                  alreadyPaid={isPaid}
                  size="default"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/25"
                />
              )}
              <RemindInvoiceButton
                invoiceId={invoice.id}
                clientEmail={invoice.client.email}
                disabled={actionLoading !== null}
                onSent={fetchAll}
                variant={isOverdue ? "default" : "outline"}
                className={isOverdue ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}
              />
            </>
          )}
          {!isPaid && !isVoid && (
            <Button onClick={handleMarkPaid} disabled={actionLoading !== null} variant="secondary">
              {actionLoading === "markPaid" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Mark as Paid
            </Button>
          )}
          <DownloadPdfButton invoiceId={invoice.id} />
          <CopyLinkButton invoiceId={invoice.id} />
          <DuplicateInvoiceButton invoiceId={invoice.id} />
          <Button variant="outline" onClick={handlePrint} disabled={actionLoading !== null}>
            {actionLoading === "print" ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Printer className="h-4 w-4 mr-2" />
            )}
            Print
          </Button>
          {!isVoid && (
            <VoidInvoiceButton
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoiceNumber}
              variant="outline"
              disabled={actionLoading !== null}
            />
          )}
          <Button variant="destructive" onClick={handleDelete} disabled={actionLoading !== null}>
            {actionLoading === "delete" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
            Delete
          </Button>
        </div>
      </div>

      {/* Status Banner */}
      {isVoid && (
        <div className="rounded-xl bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-900 dark:to-slate-950 border border-slate-300 dark:border-slate-700 p-4 flex items-center gap-3 no-print">
          <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0">
            <Ban className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </div>
          <div>
            <p className="font-semibold text-slate-700 dark:text-slate-300">Invoice Voided</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">This invoice has been cancelled. It is not payable and is excluded from revenue reports.</p>
          </div>
        </div>
      )}
      {isOverdue && (
        <div className="rounded-xl bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/40 dark:to-rose-950/40 border border-red-200 dark:border-red-900/50 p-4 flex items-center gap-3 no-print">
          <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center shrink-0">
            <Clock className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="font-semibold text-red-700 dark:text-red-300">Payment Overdue</p>
            <p className="text-sm text-red-600 dark:text-red-400">This invoice was due {daysOverdue} day{daysOverdue !== 1 ? "s" : ""} ago — consider sending a reminder.</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3 print:block">
        <div className="lg:col-span-2 space-y-6">

      {/* Canonical Invoice Document */}
      <CanonicalInvoiceSheet vm={vm} className="shadow-sm" />
        </div>{/* /lg:col-span-2 */}
        <aside className="no-print lg:col-span-1">
          <div className="lg:sticky lg:top-24">
            <ActivityTimeline invoiceId={invoice.id} />
          </div>
        </aside>
      </div>{/* /grid */}
    </div>
  );
}
