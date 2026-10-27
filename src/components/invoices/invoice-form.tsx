"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  ArrowLeft,
  Pencil,
  Tag,
  Calendar,
  Layers,
  RotateCcw,
} from "lucide-react";
import { formatCurrency, calculateInvoiceTotals } from "@/lib/utils";
import { invoiceSchema, type InvoiceInput } from "@/lib/validations";
import { AiReceiptButton } from "@/components/invoices/ai-receipt-button";
import type { Client } from "@prisma/client";
import { ZodError } from "zod";
import type { ParsedReceipt } from "@/app/api/parse-receipt/route";
import type { InvoiceWithRelations } from "@/types";
import type { PriceSource } from "@/lib/pricing-resolver";

// ---------- Types ----------

export interface CatalogueFruit {
  id: string;
  name: string;
  variety?: string | null;
  category?: string | null;
  defaultUnitId?: string | null;
  defaultUnit?: { id: string; name: string; code?: string | null };
}

export interface CatalogueUnit {
  id: string;
  name: string;
  code?: string | null;
}

export interface FormLineItem {
  id: string;
  description: string;
  quantity: string;
  price: string;
  fruitId?: string;
  fruitName?: string;
  fruitVariety?: string;
  unitId?: string;
  unitName?: string;
  unitPriceSnapshot?: number;
  priceSource: PriceSource;
  suggestedPrice?: string;
  resolvedSource?: PriceSource;
  isResolving?: boolean;
}

type FormMode = "create" | "edit";

interface InvoiceFormProps {
  mode: FormMode;
  clients: Client[];
  /** When editing: the existing invoice (with items+client). */
  invoice?: InvoiceWithRelations;
  /** When creating: optionally pre-select a client (?clientId=). */
  initialClientId?: string;
  /** User's default tax rate (from settings) used for new invoices. */
  defaultTaxRate?: number;
  /** User's default tax label (e.g. GST/VAT/TAX) used for new invoices. */
  defaultTaxLabel?: string;
  /** User's default due-in-days (from settings) used for new invoices. Default 30. */
  defaultDueDays?: number;
  /** User's default notes/terms (from settings) pre-filled on new invoices. */
  defaultNotes?: string;
}

// ---------- Helpers ----------

const emptyItem = (): FormLineItem => ({
  id: crypto.randomUUID(),
  description: "",
  quantity: "1.000",
  price: "0",
  priceSource: "MANUAL",
  suggestedPrice: undefined,
  resolvedSource: undefined,
  isResolving: false,
});

function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultDates(dueInDays = 30) {
  const today = new Date();
  const due = new Date();
  due.setDate(due.getDate() + Math.max(0, dueInDays | 0));
  return { issue: toLocalISODate(today), due: toLocalISODate(due) };
}

type FormErrors = Record<string, string>;

// ---------- Component ----------

export function InvoiceForm({
  mode,
  clients,
  invoice,
  initialClientId,
  defaultTaxRate = 0,
  defaultTaxLabel = "GST",
  defaultDueDays = 30,
  defaultNotes = "",
}: InvoiceFormProps) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const dates = defaultDates(defaultDueDays);

  // Catalogue state
  const [fruits, setFruits] = useState<CatalogueFruit[]>([]);
  const [units, setUnits] = useState<CatalogueUnit[]>([]);

  // Pull discount fields from the Prisma invoice shape
  type Disc = {
    discountType?: "PERCENT" | "FIXED" | null;
    discountValue?: number | null;
    taxLabel?: string | null;
  };
  const invDisc = invoice as unknown as Disc | undefined;

  // Initial values — for edit, hydrate from the existing invoice.
  const initials = useMemo(() => {
    if (isEdit && invoice) {
      const issue = toLocalISODate(new Date(invoice.issueDate));
      const due = toLocalISODate(new Date(invoice.dueDate));
      return {
        clientId: invoice.clientId,
        status: invoice.status as "DRAFT" | "PENDING" | "PAID",
        issueDate: issue,
        dueDate: due,
        taxRate: String(Number(invoice.taxRate)),
        taxLabel: (invDisc?.taxLabel ?? defaultTaxLabel ?? "GST").toUpperCase(),
        discountType: (invDisc?.discountType ?? "") as "" | "PERCENT" | "FIXED",
        discountValue:
          invDisc?.discountValue != null ? String(Number(invDisc.discountValue)) : "",
        notes: invoice.notes ?? "",
        items:
          invoice.items.length > 0
            ? invoice.items.map((it) => ({
                id: it.id,
                description: it.description,
                quantity: String(it.quantity),
                price: String(Number(it.price)),
                fruitId: it.fruitId ?? undefined,
                fruitName: it.fruitName ?? undefined,
                fruitVariety: it.fruitVariety ?? undefined,
                unitId: it.unitId ?? undefined,
                unitName: it.unitName ?? undefined,
                unitPriceSnapshot:
                  it.unitPriceSnapshot != null ? Number(it.unitPriceSnapshot) : undefined,
                priceSource: (it.fruitId ? "OVERRIDE" : "MANUAL") as PriceSource,
                suggestedPrice: String(Number(it.price)),
                resolvedSource: (it.fruitId ? "OVERRIDE" : "MANUAL") as PriceSource,
                isResolving: false,
              }))
            : [emptyItem()],
      };
    }
    return {
      clientId:
        initialClientId && clients.find((c) => c.id === initialClientId)
          ? initialClientId
          : clients[0]?.id ?? "",
      status: "DRAFT" as const,
      issueDate: dates.issue,
      dueDate: dates.due,
      taxRate: String(defaultTaxRate),
      taxLabel: (defaultTaxLabel || "GST").toUpperCase(),
      discountType: "" as "" | "PERCENT" | "FIXED",
      discountValue: "",
      notes: defaultNotes ?? "",
      items: [emptyItem()] as FormLineItem[],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, invoice?.id]);

  const [clientId, setClientId] = useState<string>(initials.clientId);
  const [status, setStatus] = useState<"DRAFT" | "PENDING" | "PAID">(initials.status);
  const [issueDate, setIssueDate] = useState<string>(initials.issueDate);
  const [dueDate, setDueDate] = useState<string>(initials.dueDate);
  const [taxRate, setTaxRate] = useState<string>(initials.taxRate);
  const [taxLabel, setTaxLabel] = useState<string>(initials.taxLabel);
  const [discountType, setDiscountType] = useState<"" | "PERCENT" | "FIXED">(
    initials.discountType
  );
  const [discountValue, setDiscountValue] = useState<string>(initials.discountValue);
  const [notes, setNotes] = useState<string>(initials.notes);
  const [items, setItems] = useState<FormLineItem[]>(initials.items);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [aiSuccess, setAiSuccess] = useState(false);

  // Load tenant's fruit catalogue & units
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/fruits?isActive=true")
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch("/api/fruits/units")
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ]).then(([fruitsData, unitsData]) => {
      if (!active) return;
      if (Array.isArray(fruitsData)) setFruits(fruitsData);
      if (Array.isArray(unitsData)) setUnits(unitsData);
    });
    return () => {
      active = false;
    };
  }, []);

  // Sync selected client once clients list loads in create mode
  useEffect(() => {
    if (isEdit || clientId || clients.length === 0) return;
    const timer = setTimeout(() => {
      setClientId(
        initialClientId && clients.find((c) => c.id === initialClientId)
          ? initialClientId
          : clients[0].id
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [clients, clientId, initialClientId, isEdit]);

  // When client changes in create mode, auto-adjust due date
  useEffect(() => {
    if (isEdit || !clientId) return;
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    const clientDueDays = (client as { dueDays?: number | null }).dueDays;
    const days =
      typeof clientDueDays === "number" && clientDueDays >= 0
        ? clientDueDays
        : defaultDueDays;
    const baseDate = issueDate ? new Date(issueDate) : new Date();
    if (Number.isNaN(baseDate.getTime())) return;
    const due = new Date(baseDate);
    due.setDate(due.getDate() + days);
    const next = toLocalISODate(due);
    const timer = setTimeout(() => setDueDate((prev) => (prev === next ? prev : next)), 0);
    return () => clearTimeout(timer);
  }, [clientId, clients, defaultDueDays, isEdit, issueDate]);

  // Decimal-safe invoice totals
  const totals = useMemo(() => {
    const parsed = items.map((it) => ({
      quantity: Number(it.quantity) || 0,
      price: Number(it.price) || 0,
    }));
    const dType = discountType === "PERCENT" || discountType === "FIXED" ? discountType : null;
    const dVal = dType ? Number(discountValue) || 0 : 0;
    return calculateInvoiceTotals(parsed, Number(taxRate) || 0, {
      type: dType,
      value: dVal,
    });
  }, [items, taxRate, discountType, discountValue]);

  // Resolve price helper (invokes API)
  const resolvePrice = useCallback(
    async (
      itemId: string,
      targetFruitId?: string,
      targetUnitId?: string,
      targetClientId?: string,
      targetDate?: string
    ) => {
      if (!targetFruitId || !targetUnitId) return;

      setItems((prev) =>
        prev.map((it) => (it.id === itemId ? { ...it, isResolving: true } : it))
      );

      try {
        const cId = targetClientId || clientId;
        const dStr = targetDate || issueDate;
        const params = new URLSearchParams({
          fruitId: targetFruitId,
          unitId: targetUnitId,
          date: dStr,
        });
        if (cId) params.set("clientId", cId);

        const res = await fetch(`/api/prices/resolve?${params.toString()}`);
        if (!res.ok) throw new Error("Price resolution failed");
        const data = await res.json();

        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== itemId) return it;
            if (data.price != null) {
              const formattedPrice = Number(data.price).toFixed(2);
              return {
                ...it,
                price: formattedPrice,
                suggestedPrice: formattedPrice,
                priceSource: data.source as PriceSource,
                resolvedSource: data.source as PriceSource,
                unitPriceSnapshot: Number(data.price),
                unitName: data.unitName || it.unitName,
                isResolving: false,
              };
            } else {
              return {
                ...it,
                priceSource: "MANUAL",
                resolvedSource: "MANUAL",
                suggestedPrice: undefined,
                unitName: data.unitName || it.unitName,
                isResolving: false,
              };
            }
          })
        );
      } catch (err) {
        console.error("Price resolution error:", err);
        setItems((prev) =>
          prev.map((it) =>
            it.id === itemId
              ? { ...it, isResolving: false, priceSource: "MANUAL" }
              : it
          )
        );
      }
    },
    [clientId, issueDate]
  );

  const firstFruitSelectRef = useRef<HTMLSelectElement | null>(null);
  const shouldFocusNewRowRef = useRef(false);

  // Line item actions: insert new row at index 0 (top of the list)
  function addItem() {
    shouldFocusNewRowRef.current = true;
    setItems((prev) => [emptyItem(), ...prev]);
    setErrors((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (k.startsWith("items.")) delete next[k];
      });
      return next;
    });
  }

  // Automatically focus and smoothly scroll new first row into view
  useEffect(() => {
    if (shouldFocusNewRowRef.current) {
      shouldFocusNewRowRef.current = false;
      if (firstFruitSelectRef.current) {
        firstFruitSelectRef.current.focus({ preventScroll: true });
        firstFruitSelectRef.current.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }
    }
  }, [items]);

  function removeItem(id: string) {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function updateItem(id: string, field: keyof FormLineItem, value: string) {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        const updated = { ...i, [field]: value };

        // Handle explicit manual price edits (invoice-only override)
        if (field === "price") {
          if (i.suggestedPrice != null) {
            const entered = Number(value);
            const suggested = Number(i.suggestedPrice);
            if (entered !== suggested && !Number.isNaN(entered)) {
              updated.priceSource = "OVERRIDE";
            } else if (entered === suggested) {
              updated.priceSource = i.resolvedSource || "CUSTOMER_CONTRACT";
            }
          } else {
            updated.priceSource = "MANUAL";
          }
        }
        return updated;
      })
    );
  }

  function handleFruitSelect(itemId: string, selectedFruitId: string) {
    if (!selectedFruitId || selectedFruitId === "CUSTOM") {
      setItems((prev) =>
        prev.map((it) =>
          it.id === itemId
            ? {
                ...it,
                fruitId: undefined,
                fruitName: undefined,
                fruitVariety: undefined,
                priceSource: "MANUAL",
                suggestedPrice: undefined,
                resolvedSource: undefined,
              }
            : it
        )
      );
      return;
    }

    const selectedFruit = fruits.find((f) => f.id === selectedFruitId);
    if (!selectedFruit) return;

    // Default unit to fruit's default unit or first available unit
    const defaultUnitId = selectedFruit.defaultUnitId || units[0]?.id;
    const defaultUnitObj =
      units.find((u) => u.id === defaultUnitId) || selectedFruit.defaultUnit;
    const unitName = defaultUnitObj?.code || defaultUnitObj?.name || "kg";

    const autoDesc = `${selectedFruit.name}${
      selectedFruit.variety ? ` (${selectedFruit.variety})` : ""
    }`;

    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        return {
          ...it,
          fruitId: selectedFruit.id,
          fruitName: selectedFruit.name,
          fruitVariety: selectedFruit.variety || undefined,
          unitId: defaultUnitId || undefined,
          unitName,
          description: it.description.trim() === "" ? autoDesc : it.description,
        };
      })
    );

    if (defaultUnitId) {
      resolvePrice(itemId, selectedFruit.id, defaultUnitId);
    }
  }

  function handleUnitSelect(itemId: string, selectedUnitId: string) {
    const selectedUnit = units.find((u) => u.id === selectedUnitId);
    const unitName = selectedUnit?.code || selectedUnit?.name;

    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        return {
          ...it,
          unitId: selectedUnitId,
          unitName,
        };
      })
    );

    const currentItem = items.find((i) => i.id === itemId);
    if (currentItem?.fruitId) {
      resolvePrice(itemId, currentItem.fruitId, selectedUnitId);
    }
  }

  // Re-resolve active fruit prices when client or issue date changes
  const prevClientRef = useRef(clientId);
  const prevDateRef = useRef(issueDate);

  useEffect(() => {
    const clientChanged = prevClientRef.current !== clientId;
    const dateChanged = prevDateRef.current !== issueDate;

    if (clientChanged || dateChanged) {
      prevClientRef.current = clientId;
      prevDateRef.current = issueDate;

      // Re-resolve for items with fruitId that were not manually overridden
      items.forEach((item) => {
        if (item.fruitId && item.unitId && item.priceSource !== "OVERRIDE") {
          resolvePrice(item.id, item.fruitId, item.unitId, clientId, issueDate);
        }
      });
    }
  }, [clientId, issueDate, items, resolvePrice]);

  function validate(): boolean {
    setErrors({});
    setSubmitError(null);
    try {
      const dType = discountType === "PERCENT" || discountType === "FIXED" ? discountType : null;
      const payload: InvoiceInput & { notes?: string } = {
        clientId,
        status,
        issueDate,
        dueDate,
        taxRate: Number(taxRate) || 0,
        taxLabel: (taxLabel.trim().toUpperCase() || "GST").slice(0, 12),
        discountType: dType,
        discountValue: dType ? Number(discountValue) || 0 : null,
        notes: notes.trim() || undefined,
        items: items.map((it) => ({
          ...(isEdit ? { id: it.id } : {}),
          description: it.description,
          quantity: Number(it.quantity),
          price: Number(it.price),
          fruitId: it.fruitId || undefined,
          fruitName: it.fruitName || undefined,
          fruitVariety: it.fruitVariety || undefined,
          unitId: it.unitId || undefined,
          unitName: it.unitName || undefined,
          unitPriceSnapshot: Number(it.price),
        })),
      };
      invoiceSchema.parse(payload);
      return true;
    } catch (err) {
      if (err instanceof ZodError) {
        const next: FormErrors = {};
        for (const issue of err.issues) {
          const key = issue.path.join(".");
          next[key] = issue.message;
        }
        setErrors(next);
        if (next[""] || Object.keys(next).length === 0) {
          setSubmitError(Object.values(next)[0] ?? "Please fix the errors below");
        }
      }
      return false;
    }
  }

  function itemError(itemId: string, field: string): string | undefined {
    const idx = items.findIndex((i) => i.id === itemId);
    return errors[`items.${idx}.${field}`];
  }

  function handleAiParsed(data: ParsedReceipt) {
    const newItems: FormLineItem[] = data.items.map((it) => ({
      id: crypto.randomUUID(),
      description: it.description,
      quantity: String(it.quantity),
      price: String(it.price),
      priceSource: "MANUAL",
    }));
    setItems(newItems);
    const match = clients.find(
      (c) => c.name.toLowerCase() === data.clientName.trim().toLowerCase()
    );
    if (match) setClientId(match.id);
    setErrors((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (k.startsWith("items.")) delete next[k];
      });
      return next;
    });
    setAiSuccess(true);
    setTimeout(() => setAiSuccess(false), 2500);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setLoading(true);
    setSubmitError(null);

    const dType = discountType === "PERCENT" || discountType === "FIXED" ? discountType : null;
    const payload = {
      clientId,
      status,
      issueDate,
      dueDate,
      taxRate: Number(taxRate) || 0,
      taxLabel: (taxLabel.trim().toUpperCase() || "GST").slice(0, 12),
      discountType: dType,
      discountValue: dType ? Number(discountValue) || 0 : null,
      notes: notes.trim() || undefined,
      items: items.map((it) => ({
        ...(isEdit ? { id: it.id } : {}),
        description: it.description.trim(),
        quantity: Number(it.quantity),
        price: Number(it.price),
        fruitId: it.fruitId || undefined,
        fruitName: it.fruitName || undefined,
        fruitVariety: it.fruitVariety || undefined,
        unitId: it.unitId || undefined,
        unitName: it.unitName || undefined,
        unitPriceSnapshot: Number(it.price),
      })),
    };

    try {
      const url = isEdit ? `/api/invoices/${invoice!.id}` : "/api/invoices";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.details && Array.isArray(data.details)) {
          const next: FormErrors = {};
          for (const d of data.details as Array<{ field: string; message: string }>) {
            next[d.field] = d.message;
          }
          setErrors(next);
        }
        setSubmitError(
          data.error || (isEdit ? "Failed to update invoice" : "Failed to create invoice")
        );
        toast.error(
          data.error || (isEdit ? "Failed to update invoice" : "Failed to create invoice")
        );
        return;
      }
      if (isEdit) {
        toast.success("Invoice updated", {
          description: data.invoiceNumber ?? "Changes saved",
        });
        router.push(`/invoices/${data.id}`);
        router.refresh();
      } else {
        toast.success("Invoice created", {
          description: data.invoiceNumber ?? "New invoice ready",
        });
        router.push(`/invoices/${data.id}`);
        router.refresh();
      }
    } catch {
      setSubmitError("Network error — please check your connection and try again");
      toast.error("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  const headerTitle = isEdit ? "Edit Invoice" : "New Invoice";
  const headerSubtitle = isEdit
    ? `Update details for ${invoice?.invoiceNumber ?? "this invoice"}`
    : "Create a new wholesale invoice for fruit consignments";
  const submitLabel = isEdit ? "Save Changes" : "Create Invoice";
  const submittingLabel = isEdit ? "Saving..." : "Creating Invoice...";
  const backHref = isEdit && invoice ? `/invoices/${invoice.id}` : "/invoices";

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        {/* Header card */}
        <div className="flex items-center justify-between no-print">
          <div className="flex items-center gap-3">
            <Link href={backHref}>
              <Button variant="ghost" size="icon" className="rounded-full">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#173D32] dark:text-[#DCEFE3]">
                {headerTitle}
              </h1>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
                {headerSubtitle}
              </p>
            </div>
          </div>
        </div>

        {(submitError || errors.dueDate || errors.clientId) && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-700 dark:text-red-300 animate-in fade-in">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">
                {submitError ?? "Please fix the following errors:"}
              </p>
              <ul className="list-disc list-inside mt-1 text-red-600 dark:text-red-400">
                {errors.dueDate && <li>{errors.dueDate}</li>}
                {errors.clientId && <li>{errors.clientId}</li>}
              </ul>
            </div>
          </div>
        )}

        {aiSuccess && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-sm text-emerald-700 dark:text-emerald-300 animate-in fade-in">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span className="font-medium">
              Receipt scanned successfully — items imported.
            </span>
          </div>
        )}

        {/* Invoice Metadata Card */}
        <Card className="border-slate-200/60 dark:border-slate-800/60 overflow-hidden shadow-sm">
          <CardHeader className="border-b border-border/80 bg-muted/40 rounded-t-xl">
            <CardTitle className="text-base flex items-center gap-2 text-[#173D32] dark:text-[#DCEFE3]">
              <span className="h-7 w-7 rounded-lg bg-secondary text-primary dark:bg-primary/40 dark:text-secondary flex items-center justify-center">
                {isEdit ? (
                  <Pencil className="h-4 w-4 text-primary dark:text-secondary" />
                ) : (
                  <Sparkles className="h-4 w-4 text-primary dark:text-secondary" />
                )}
              </span>
              Consignment & Client Details
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="client" className="text-foreground font-medium">
                  Client / Buyer <span className="text-destructive">*</span>
                </Label>
                <select
                  id="client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className={`flex h-11 w-full rounded-lg border bg-card dark:text-foreground px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    errors.clientId ? "border-destructive" : "border-border"
                  }`}
                >
                  <option value="">Select a client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.email})
                    </option>
                  ))}
                </select>
                {errors.clientId && (
                  <p className="text-xs text-destructive">{errors.clientId}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="status" className="text-foreground font-medium">
                  Status
                </Label>
                <select
                  id="status"
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as "DRAFT" | "PENDING" | "PAID")
                  }
                  className="flex h-11 w-full rounded-lg border border-border bg-card dark:text-foreground px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="DRAFT">📝 Draft (No Debt)</option>
                  <option value="PENDING">⏳ Pending / Sent (Customer Debt)</option>
                  <option value="PAID">✅ Paid (Consignment Cleared)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label
                  htmlFor="issueDate"
                  className="text-slate-700 dark:text-slate-300 font-medium"
                >
                  Consignment Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="issueDate"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="dueDate"
                  className="text-slate-700 dark:text-slate-300 font-medium"
                >
                  Payment Due Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={
                    errors.dueDate ? "h-11 border-red-400 dark:border-red-500" : "h-11"
                  }
                />
                {errors.dueDate && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {errors.dueDate}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label
                  htmlFor="taxRate"
                  className="text-slate-700 dark:text-slate-300 font-medium"
                >
                  Tax / Mandi Cess Rate (%)
                </Label>
                <Input
                  id="taxRate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  className="h-11"
                />
                {errors.taxRate && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {errors.taxRate}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="taxLabel"
                  className="text-slate-700 dark:text-slate-300 font-medium"
                >
                  Tax Label
                </Label>
                <Input
                  id="taxLabel"
                  value={taxLabel}
                  onChange={(e) => setTaxLabel(e.target.value.toUpperCase())}
                  maxLength={12}
                  placeholder="GST"
                  className="h-11 uppercase tracking-wide font-medium"
                />
                {errors.taxLabel && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {errors.taxLabel}
                  </p>
                )}
              </div>
            </div>

            {/* Discount */}
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300 font-medium">
                Consignment Discount{" "}
                <span className="text-slate-400 font-normal">(optional)</span>
              </Label>
              <div className="flex items-stretch gap-2">
                <select
                  value={discountType}
                  onChange={(e) =>
                    setDiscountType(e.target.value as "" | "PERCENT" | "FIXED")
                  }
                  className="h-11 rounded-lg border border-border bg-card dark:text-foreground px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">No discount</option>
                  <option value="PERCENT">Percentage (%)</option>
                  <option value="FIXED">Flat amount (₹)</option>
                </select>
                <div className="relative flex-1">
                  {discountType === "FIXED" && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                      ₹
                    </span>
                  )}
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    max={discountType === "PERCENT" ? 100 : undefined}
                    disabled={!discountType}
                    placeholder={
                      discountType === "PERCENT"
                        ? "e.g. 5"
                        : discountType === "FIXED"
                        ? "e.g. 500"
                        : "0"
                    }
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    className={["h-11", discountType === "FIXED" ? "pl-7" : ""].join(" ")}
                  />
                  {discountType === "PERCENT" && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                      %
                    </span>
                  )}
                </div>
                {totals.discountAmount > 0 && (
                  <div className="flex items-center px-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-sm font-medium whitespace-nowrap">
                    −{formatCurrency(totals.discountAmount)}
                  </div>
                )}
              </div>
              {errors.discountValue && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {errors.discountValue}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="notes"
                className="text-slate-700 dark:text-slate-300 font-medium"
              >
                Notes / Terms{" "}
                <span className="text-slate-400 font-normal">(optional)</span>
              </Label>
              <Textarea
                id="notes"
                rows={2}
                placeholder="Gate pass number, lorry number, mandi remarks, bank details..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
                className="resize-y min-h-[70px]"
              />
              {errors.notes && (
                <p className="text-xs text-red-600 dark:text-red-400">{errors.notes}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Fruit Line Items Card */}
        <Card className="border-slate-200/60 dark:border-slate-800/60 overflow-hidden shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 flex-wrap border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 rounded-t-xl">
            <CardTitle className="text-base flex items-center gap-2 text-[#173D32] dark:text-[#DCEFE3]">
              <span className="h-7 w-7 rounded-lg bg-[#DCEFE3] text-[#173D32] flex items-center justify-center font-bold">
                🍎
              </span>
              Fruit Line Items & Consignments
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {!isEdit && (
                <AiReceiptButton
                  onParsed={handleAiParsed}
                  onError={(msg) => setSubmitError(msg)}
                />
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addItem}
                className="border-dashed bg-white dark:bg-slate-900 border-[#173D32]/30 text-[#173D32] dark:text-[#DCEFE3] hover:bg-[#DCEFE3]/30"
              >
                <Plus className="h-4 w-4 mr-1" /> Add Fruit Item
              </Button>
            </div>
          </CardHeader>

          <CardContent className="pt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((item, idx) => {
              const qty = Number(item.quantity) || 0;
              const price = Number(item.price) || 0;
              const lineTotal = Math.round((qty * price + Number.EPSILON) * 100) / 100;
              const descErr = itemError(item.id, "description");
              const qtyErr = itemError(item.id, "quantity");
              const priceErr = itemError(item.id, "price");

              return (
                <div key={item.id} className="py-4 space-y-3 first:pt-0">
                  {/* Top line item row: Fruit & Unit Selection + Price Source Badge */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap flex-1 min-w-[280px]">
                      <span className="text-xs font-semibold text-slate-400 w-5">
                        #{idx + 1}
                      </span>
                      {/* Fruit Selector */}
                      <select
                        ref={idx === 0 ? firstFruitSelectRef : undefined}
                        id={`fruit-select-${item.id}`}
                        aria-label={`Fruit for item ${idx + 1}`}
                        value={item.fruitId ?? ""}
                        onChange={(e) => handleFruitSelect(item.id, e.target.value)}
                        className="h-9 rounded-md border border-border bg-card dark:text-foreground px-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#173D32] dark:focus-visible:ring-[#DCEFE3]"
                      >
                        <option value="">-- Select Fruit from Catalogue --</option>
                        {fruits.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                            {f.variety ? ` (${f.variety})` : ""}
                            {f.category ? ` · ${f.category}` : ""}
                          </option>
                        ))}
                        <option value="CUSTOM">✏️ Manual / Non-Catalogue</option>
                      </select>

                      {/* Unit Selector */}
                      <select
                        aria-label={`Unit for item ${idx + 1}`}
                        value={item.unitId ?? ""}
                        onChange={(e) => handleUnitSelect(item.id, e.target.value)}
                        className="h-9 rounded-md border border-border bg-card dark:text-foreground px-2.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="">Unit...</option>
                        {units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code || u.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Price Source Indicator Badge */}
                    <div className="flex items-center gap-2">
                      {item.isResolving ? (
                        <Badge variant="outline" className="text-xs animate-pulse">
                          Resolving price...
                        </Badge>
                      ) : item.priceSource === "CUSTOMER_CONTRACT" ? (
                        <Badge
                          variant="success"
                          className="bg-[#DCEFE3] text-[#173D32] border-[#173D32]/20 font-medium flex items-center gap-1"
                        >
                          <Tag className="h-3 w-3" />
                          Contract Rate (₹{item.suggestedPrice || item.price})
                        </Badge>
                      ) : item.priceSource === "DAILY_BOARD" ? (
                        <Badge
                          variant="secondary"
                          className="bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 font-medium flex items-center gap-1"
                        >
                          <Calendar className="h-3 w-3" />
                          Daily Board (₹{item.suggestedPrice || item.price})
                        </Badge>
                      ) : item.priceSource === "OVERRIDE" ? (
                        <Badge
                          variant="warning"
                          className="bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-medium flex items-center gap-1"
                        >
                          ⚡ Invoice Override
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-slate-500 font-normal flex items-center gap-1"
                        >
                          ✍️ Manual Price
                        </Badge>
                      )}

                      {/* Reset override button if overridden */}
                      {item.priceSource === "OVERRIDE" && item.suggestedPrice && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (item.suggestedPrice) {
                              updateItem(item.id, "price", item.suggestedPrice);
                            }
                          }}
                          className="h-7 px-2 text-xs text-slate-500 hover:text-primary"
                          title="Reset to resolved rate"
                        >
                          <RotateCcw className="h-3 w-3 mr-1" /> Reset
                        </Button>
                      )}

                      {/* Remove item button */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(item.id)}
                        disabled={items.length === 1}
                        className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Inputs row: Description, Decimal Qty, Unit Price, Line Total */}
                  <div className="grid grid-cols-12 gap-3 items-center">
                    <div className="col-span-12 md:col-span-5 space-y-1">
                      <Label className="text-xs text-slate-500">
                        Description / Consignment Lot
                      </Label>
                      <Input
                        placeholder={`e.g. Kashmiri Apples - Batch A`}
                        value={item.description}
                        onChange={(e) => updateItem(item.id, "description", e.target.value)}
                        className={descErr ? "border-red-400 h-10" : "h-10"}
                      />
                    </div>

                    <div className="col-span-5 md:col-span-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-slate-500">
                          Qty ({item.unitName || "unit"})
                        </Label>
                        <span className="text-[10px] text-slate-400">3 dec.</span>
                      </div>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="1.000"
                        value={item.quantity}
                        onChange={(e) => updateItem(item.id, "quantity", e.target.value)}
                        className={`text-right font-mono ${qtyErr ? "border-red-400" : ""} h-10`}
                      />
                    </div>

                    <div className="col-span-4 md:col-span-2 space-y-1">
                      <Label className="text-xs text-slate-500">
                        Rate (₹/{item.unitName || "unit"})
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={item.price}
                        onChange={(e) => updateItem(item.id, "price", e.target.value)}
                        className={`text-right font-mono ${priceErr ? "border-red-400" : ""} h-10`}
                      />
                    </div>

                    <div className="col-span-3 md:col-span-2 space-y-1 text-right">
                      <Label className="text-xs text-slate-500">Amount</Label>
                      <div className="h-10 flex items-center justify-end font-bold text-sm tabular-nums text-[#173D32] dark:text-[#DCEFE3] pr-1">
                        {formatCurrency(lineTotal)}
                      </div>
                    </div>
                  </div>

                  {(descErr || qtyErr || priceErr) && (
                    <div className="text-xs text-red-600 dark:text-red-400 pl-1">
                      {descErr || qtyErr || priceErr}
                    </div>
                  )}
                </div>
              );
            })}

            {errors.items && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                {errors.items}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary sidebar */}
      <div className="lg:col-span-1">
        <Card className="sticky top-24 border-border shadow-md overflow-hidden bg-card">
          <CardHeader className="border-b border-border/80 bg-muted/30">
            <CardTitle className="text-base flex items-center gap-2 text-[#173D32] dark:text-[#DCEFE3]">
              <Layers className="h-4 w-4" />
              Invoice Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1 text-slate-600 dark:text-slate-400">
                <span>Subtotal ({items.length} items)</span>
                <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                  {formatCurrency(totals.subtotal)}
                </span>
              </div>

              {totals.discountAmount > 0 && (
                <div className="flex justify-between py-1 text-emerald-700 dark:text-emerald-400 font-medium">
                  <span>
                    Discount{" "}
                    {discountType === "PERCENT" && discountValue
                      ? `(${discountValue}%)`
                      : ""}
                  </span>
                  <span className="tabular-nums">
                    −{formatCurrency(totals.discountAmount)}
                  </span>
                </div>
              )}

              <div className="flex justify-between py-1 text-slate-600 dark:text-slate-400">
                <span>
                  {taxLabel || "GST"} ({taxRate || "0"}%)
                </span>
                <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                  {formatCurrency(totals.taxAmount)}
                </span>
              </div>

              <Separator className="my-2 bg-slate-200 dark:bg-slate-700" />

              <div className="flex justify-between py-2 items-center">
                <span className="text-base font-bold text-slate-900 dark:text-white">
                  Total Payable
                </span>
                <span className="text-2xl font-bold text-[#173D32] dark:text-[#DCEFE3] tabular-nums">
                  {formatCurrency(totals.total)}
                </span>
              </div>
            </div>

            <div className="pt-2 space-y-3">
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 text-base font-semibold bg-[#173D32] hover:bg-[#173D32]/90 text-white dark:bg-[#DCEFE3] dark:text-[#173D32] dark:hover:bg-[#DCEFE3]/90 shadow-sm"
              >
                {loading ? submittingLabel : submitLabel}
              </Button>

              <Link href={backHref} className="block">
                <Button variant="ghost" className="w-full text-slate-500 hover:text-slate-900">
                  Cancel
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
