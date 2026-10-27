"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Printer, Loader2 } from "lucide-react";
import { printInvoicePdf } from "@/lib/print-pdf";

interface PrintPdfButtonProps {
  invoiceId: string;
  publicPrint?: boolean;
  variant?: "outline" | "default" | "ghost" | "secondary";
  size?: "sm" | "default" | "icon" | "lg";
  label?: string;
  className?: string;
}

export function PrintPdfButton({
  invoiceId,
  publicPrint = false,
  variant = "outline",
  size = "default",
  label = "Print",
  className,
}: PrintPdfButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handlePrint() {
    setLoading(true);
    try {
      const url = publicPrint
        ? `/api/public/invoices/${invoiceId}/pdf`
        : `/api/invoices/${invoiceId}/pdf`;
      await printInvoicePdf(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to print invoice PDF");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handlePrint}
      disabled={loading}
      className={className}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Printer className="h-4 w-4 mr-2" />
      )}
      {label}
    </Button>
  );
}
