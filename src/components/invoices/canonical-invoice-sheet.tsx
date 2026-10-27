"use client";

import React from "react";
import type { CanonicalInvoiceViewModel } from "@/lib/invoice-formatter";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Clock, Ban, AlertCircle } from "lucide-react";

interface CanonicalInvoiceSheetProps {
  vm: CanonicalInvoiceViewModel;
  className?: string;
}

export function CanonicalInvoiceSheet({ vm, className }: CanonicalInvoiceSheetProps) {
  const companyInitial = (vm.seller.name || "S").charAt(0).toUpperCase();

  return (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm print:shadow-none print:border-none print:p-0 overflow-hidden text-slate-900 dark:text-slate-100 font-sans ${
        className || ""
      }`}
    >
      {/* Brand accent bar */}
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: vm.brandColor || "#173D32" }}
      />

      <div className="p-6 sm:p-10 print:p-0 space-y-8">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row justify-between items-start gap-6 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-3.5 max-w-md">
            {vm.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={vm.logoUrl}
                alt={`${vm.seller.name} logo`}
                className="max-h-14 max-w-[170px] object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div
                className="h-10 w-10 rounded-md flex items-center justify-center text-white font-bold text-lg shrink-0 shadow-sm"
                style={{ backgroundColor: vm.brandColor || "#173D32" }}
              >
                {companyInitial}
              </div>
            )}
            <div className="space-y-1">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
                {vm.seller.name}
              </h1>
              {vm.seller.email && (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  <a
                    href={`mailto:${vm.seller.email}`}
                    className="hover:underline text-slate-600 dark:text-slate-400"
                  >
                    {vm.seller.email}
                  </a>
                </p>
              )}
              {vm.seller.phone && (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {vm.seller.phone}
                </p>
              )}
              {vm.seller.address && (
                <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-line pt-0.5 leading-relaxed">
                  {vm.seller.address}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col items-start sm:items-end text-left sm:text-right">
            <div className="mb-2">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: vm.statusInfo.theme.badgeBg,
                  color: vm.statusInfo.theme.badgeText,
                }}
              >
                {vm.statusInfo.isPaid && <CheckCircle2 className="h-3 w-3" />}
                {vm.statusInfo.isOverdue && <AlertCircle className="h-3 w-3" />}
                {vm.statusInfo.isPending && !vm.statusInfo.isOverdue && <Clock className="h-3 w-3" />}
                {vm.statusInfo.isVoid && <Ban className="h-3 w-3" />}
                {vm.statusInfo.label}
              </span>
            </div>
            <h2
              className="text-2xl font-bold tracking-tight"
              style={{ color: vm.brandColor || "#173D32" }}
            >
              {vm.statusInfo.isPaid ? "PAID" : vm.statusInfo.isVoid ? "VOID" : "INVOICE"}
            </h2>
            <p className="text-xs font-mono font-bold text-slate-600 dark:text-slate-400 mt-0.5">
              {vm.invoiceNumber}
            </p>
            <div className="mt-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                Total Due
              </p>
              <p
                className="text-2xl font-bold tracking-tight"
                style={{ color: vm.brandColor || "#173D32" }}
              >
                {vm.formattedTotalAmount}
              </p>
            </div>
          </div>
        </div>

        {/* Parties: From & Bill To */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="bg-slate-50/70 dark:bg-slate-800/40 rounded-md p-4 border border-slate-200/80 dark:border-slate-800">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-2">
              From
            </p>
            <div className="space-y-1">
              <p className="font-bold text-sm text-slate-900 dark:text-white">
                {vm.seller.name}
              </p>
              {vm.seller.email && (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {vm.seller.email}
                </p>
              )}
              {vm.seller.phone && (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {vm.seller.phone}
                </p>
              )}
              {vm.seller.address && (
                <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-line pt-0.5">
                  {vm.seller.address}
                </p>
              )}
            </div>
          </div>

          <div
            className="rounded-md p-4 border"
            style={{
              backgroundColor: "rgba(23, 61, 50, 0.04)",
              borderColor: "rgba(23, 61, 50, 0.2)",
            }}
          >
            <p
              className="text-[11px] uppercase tracking-wider font-bold mb-2"
              style={{ color: vm.brandColor || "#173D32" }}
            >
              Bill To
            </p>
            <div className="space-y-1">
              <p className="font-bold text-sm text-slate-900 dark:text-white">
                {vm.customer.name}
              </p>
              {vm.customer.email && (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {vm.customer.email}
                </p>
              )}
              {vm.customer.phone && (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {vm.customer.phone}
                </p>
              )}
              {vm.customer.address && (
                <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-line pt-0.5">
                  {vm.customer.address}
                </p>
              )}
              {vm.customer.gstin && (
                <p className="text-xs text-slate-700 dark:text-slate-300 font-mono pt-1">
                  GSTIN: {vm.customer.gstin}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Dates & GST Meta */}
        <div className="grid grid-cols-3 gap-3 p-3.5 bg-slate-50/70 dark:bg-slate-800/40 rounded-md border border-slate-200/80 dark:border-slate-800">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              Issue Date
            </p>
            <p className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white mt-0.5">
              {vm.formattedIssueDate}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              Due Date
            </p>
            <p
              className={`font-bold text-xs sm:text-sm mt-0.5 ${
                vm.statusInfo.isOverdue ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white"
              }`}
            >
              {vm.formattedDueDate}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              {vm.taxLabel} Rate
            </p>
            <p className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white mt-0.5">
              {vm.taxRate}%
            </p>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase text-[10px] tracking-wider">
                <th className="py-2.5 px-3 w-10 text-center">#</th>
                <th className="py-2.5 px-3">Description</th>
                <th className="py-2.5 px-3 text-right w-24">Qty</th>
                <th className="py-2.5 px-3 text-center w-20">Unit</th>
                <th className="py-2.5 px-3 text-right w-28">Unit Price</th>
                <th className="py-2.5 px-3 text-right w-32 pr-4">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {vm.items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                  <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">
                    {item.idx}
                  </td>
                  <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-white">
                    {item.description}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                    {item.formattedQuantity}
                  </td>
                  <td className="py-2.5 px-3 text-center text-slate-600 dark:text-slate-400">
                    {item.unitName || "-"}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                    {item.formattedPrice}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-white pr-4">
                    {item.formattedTotal}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals Section */}
        <div className="flex flex-col items-end">
          <div className="w-full sm:w-80 space-y-2.5 p-4 bg-slate-50/70 dark:bg-slate-800/40 rounded-md border border-slate-200/80 dark:border-slate-800">
            <div className="flex justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400">Subtotal</span>
              <span className="font-mono font-medium text-slate-900 dark:text-white">
                {vm.formattedSubtotal}
              </span>
            </div>
            {vm.hasDiscount && (
              <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                <span>Discount</span>
                <span className="font-mono">{vm.formattedDiscount}</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400">
                {vm.taxLabel} ({vm.taxRate}%)
              </span>
              <span className="font-mono font-medium text-slate-900 dark:text-white">
                {vm.formattedTaxAmount}
              </span>
            </div>
            <Separator className="bg-slate-200 dark:bg-slate-700 my-1" />
            <div className="flex justify-between items-center pt-0.5">
              <span className="text-sm font-bold text-slate-900 dark:text-white">
                Total Due
              </span>
              <span
                className="text-lg font-bold font-mono"
                style={{ color: vm.brandColor || "#173D32" }}
              >
                {vm.formattedTotalAmount}
              </span>
            </div>
          </div>
        </div>

        {/* Status Banner */}
        {vm.statusInfo.bannerTitle && (
          <div
            className="p-3.5 rounded-md border text-xs"
            style={{
              backgroundColor: vm.statusInfo.theme.bg,
              borderColor: vm.statusInfo.theme.border,
              color: vm.statusInfo.theme.text,
            }}
          >
            <p className="font-bold">{vm.statusInfo.bannerTitle}</p>
            {vm.statusInfo.bannerSubtitle && (
              <p className="mt-0.5 opacity-90">{vm.statusInfo.bannerSubtitle}</p>
            )}
          </div>
        )}

        {/* Notes / Terms */}
        {vm.notes && (
          <div className="p-4 bg-slate-50/70 dark:bg-slate-800/40 rounded-md border border-slate-200/80 dark:border-slate-800 text-xs">
            <p className="uppercase tracking-wider text-slate-500 font-bold mb-1.5 text-[10px]">
              Notes / Terms
            </p>
            <p className="text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
              {vm.notes}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="pt-6 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 space-y-1">
          <p className="font-semibold text-slate-700 dark:text-slate-300">{vm.seller.name}</p>
          {vm.seller.email && <p className="text-[11px] text-slate-400">{vm.seller.email}</p>}
          <p className="text-[11px] text-slate-400 pt-1">Thank you for your business!</p>
          <div className="flex justify-between text-[10px] text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800/60 mt-3">
            <span>{vm.invoiceNumber}</span>
            <span>{vm.formattedIssueDate}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
