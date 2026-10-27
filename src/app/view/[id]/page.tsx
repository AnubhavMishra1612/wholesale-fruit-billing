"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Loader2,
  ShieldCheck,
  Lock,
  ArrowLeft,
} from "lucide-react";
import type { InvoiceWithRelations } from "@/types";
import { DownloadPdfButton } from "@/components/invoices/download-pdf-button";
import { PrintPdfButton } from "@/components/invoices/print-pdf-button";
import { PayInvoiceButton } from "@/components/invoices/pay-invoice-button";
import { PayMethods } from "@/components/invoices/pay-methods";
import { toast } from "sonner";
import { buildCanonicalInvoiceViewModel } from "@/lib/invoice-formatter";
import { CanonicalInvoiceSheet } from "@/components/invoices/canonical-invoice-sheet";

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
  logoUrl?: string | null;
  brandColor?: string;
  payments?: PaymentGatewayConfig;
}

function PublicInvoiceViewInner() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params.id;

  const [invoice, setInvoice] = useState<InvoiceWithRelations | null>(null);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"sheet" | "pdf">("sheet");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [invRes, setRes] = await Promise.all([
          fetch(`/api/invoices/${id}`, { cache: "no-store" }),
          fetch(`/api/public/settings?invoiceId=${encodeURIComponent(id)}`, { cache: "no-store" }),
        ]);
        if (invRes.status === 404) {
          setError("This invoice was not found. It may have been deleted or the link is incorrect.");
          return;
        }
        if (!invRes.ok) throw new Error("Unable to load invoice");
        const inv: InvoiceWithRelations = await invRes.json();
        if (!active) return;
        setInvoice(inv);
        if (setRes.ok) {
          const s: CompanySettings = await setRes.json();
          setSettings(s);
        }
        // Show toast when redirected back from Stripe
        if (searchParams.get("paid") === "1") {
          toast.success("Payment successful!", { description: `Thank you for paying ${inv.invoiceNumber}.` });
        } else if (searchParams.get("cancelled") === "1") {
          toast.message("Payment cancelled", { description: "You can retry payment at any time." });
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id, searchParams]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center">
          <Loader2 className="h-9 w-9 animate-spin text-[#173D32] dark:text-[#DCEFE3] mx-auto" />
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-3 font-medium">Loading invoice...</p>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg border-slate-200 dark:border-slate-800">
          <CardContent className="py-12 px-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
              <Lock className="h-6 w-6 text-slate-500 dark:text-slate-400" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Invoice not found
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-2 leading-relaxed">
              {error ?? "This invoice doesn't exist or the link is invalid."}
            </p>
            <div className="mt-6">
              <Link href="/login">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Admin Login
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const vm = buildCanonicalInvoiceViewModel(invoice, settings);
  const companyName = vm.seller.name;

  return (
    <div className="min-h-screen bg-slate-100/70 dark:bg-slate-950 py-8 px-4 font-sans">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Secure top action bar */}
        <div className="no-print flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <ShieldCheck className="h-4 w-4 text-[#173D32] dark:text-emerald-400 shrink-0" />
            <span>
              Invoice from <strong className="font-semibold text-slate-900 dark:text-white">{companyName}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {vm.statusInfo.isPending && settings?.payments && (settings.payments.stripe || settings.payments.razorpay) ? (
              <PayMethods
                invoiceId={invoice.id}
                alreadyPaid={vm.statusInfo.isPaid}
                payments={settings.payments}
                size="sm"
                direction="horizontal"
              />
            ) : vm.statusInfo.isPending ? (
              <PayInvoiceButton
                invoiceId={invoice.id}
                alreadyPaid={vm.statusInfo.isPaid}
                size="sm"
                className="bg-[#173D32] hover:bg-[#1e4d3f] text-white shadow-sm"
              />
            ) : null}

            {/* View Mode Toggle: Document Sheet vs Raw PDF */}
            <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setViewMode("sheet")}
                className={`px-2.5 py-1 text-xs font-medium rounded ${
                  viewMode === "sheet"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                Document
              </button>
              <button
                type="button"
                onClick={() => setViewMode("pdf")}
                className={`px-2.5 py-1 text-xs font-medium rounded ${
                  viewMode === "pdf"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                PDF View
              </button>
            </div>

            <DownloadPdfButton invoiceId={invoice.id} publicDownload size="sm" />
            <PrintPdfButton invoiceId={invoice.id} publicPrint size="sm" />
          </div>
        </div>

        {/* Main Invoice View: Canonical Sheet or Direct PDF Embed */}
        {viewMode === "sheet" ? (
          <CanonicalInvoiceSheet vm={vm} className="shadow-md" />
        ) : (
          <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 shadow-md bg-white">
            <iframe
              src={`/api/public/invoices/${invoice.id}/pdf#toolbar=1`}
              className="w-full h-[900px] border-none"
              title={`${vm.invoiceNumber} PDF Preview`}
            />
          </div>
        )}

        {/* Footer info */}
        <div className="text-center text-xs text-slate-400 dark:text-slate-600 no-print pt-2">
          <Link href="/login" className="hover:text-slate-600 dark:hover:text-slate-400 hover:underline">
            Admin Login
          </Link>
          <span className="mx-2">·</span>
          <span>Wholesale Fruit Billing</span>
        </div>
      </div>
    </div>
  );
}

export default function PublicInvoiceViewPage() {
  return (
    <Suspense fallback={null}>
      <PublicInvoiceViewInner />
    </Suspense>
  );
}
