"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CalendarDays,
  Copy,
  Save,
  RotateCcw,
  Search,
  CheckCircle2,
  Clock,
  Sparkles,
  History,
  TrendingUp,
  TrendingDown,
  Info,
  Apple,
} from "lucide-react";
import { toast } from "sonner";
import { PriceHistoryDialog } from "@/components/prices/price-history-dialog";

interface DailyPriceBoardRow {
  fruitId: string;
  fruitName: string;
  fruitVariety?: string | null;
  category: string;
  hsnCode?: string | null;
  unitId: string;
  unitName: string;
  unitCode: string;
  price: number | null;
  notes?: string | null;
  priceId?: string | null;
  effectiveDate: string;
  updatedAt?: string | null;
}

export default function DailyPriceBoardPage() {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [rows, setRows] = useState<DailyPriceBoardRow[]>([]);
  const [originalRows, setOriginalRows] = useState<DailyPriceBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  // Fetch rate board for selected date
  const fetchBoard = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prices/daily?date=${date}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load daily price board");
      const data = await res.json();
      setRows(data.board || []);
      setOriginalRows(JSON.parse(JSON.stringify(data.board || [])));
    } catch {
      toast.error("Failed to load daily price board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBoard(selectedDate);
  }, [selectedDate, fetchBoard]);

  // Handle single cell rate edit
  const handlePriceChange = (fruitId: string, val: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.fruitId !== fruitId) return r;
        const num = val === "" ? null : parseFloat(val);
        return {
          ...r,
          price: isNaN(num as number) ? null : num,
        };
      })
    );
  };

  // Copy yesterday's prices into today's price list, allowing edits before saving
  const handleCopyYesterday = async () => {
    setCopying(true);
    try {
      const res = await fetch(`/api/prices/daily/yesterday?date=${selectedDate}`);
      if (!res.ok) throw new Error("Failed to fetch prior prices");
      const data = await res.json();

      if (!data.priorDate || data.prices.length === 0) {
        toast.info(data.message || "No previous prices available to copy.");
        return;
      }

      const priorMap = new Map<string, number>();
      for (const p of data.prices) {
        priorMap.set(p.fruitId, p.price);
      }

      let copiedCount = 0;
      setRows((prev) =>
        prev.map((r) => {
          const priorRate = priorMap.get(r.fruitId);
          if (priorRate !== undefined && priorRate !== null) {
            copiedCount++;
            return {
              ...r,
              price: priorRate,
            };
          }
          return r;
        })
      );

      toast.success(
        `Copied ${copiedCount} prices from ${data.priorDate}. You can review and edit before saving.`,
        { duration: 4000 }
      );
    } catch {
      toast.error("Failed to copy previous prices");
    } finally {
      setCopying(false);
    }
  };

  // Identify modified rows
  const changedRows = useMemo(() => {
    const origMap = new Map(originalRows.map((r) => [r.fruitId, r.price]));
    return rows.filter((r) => {
      const orig = origMap.get(r.fruitId);
      return r.price !== null && r.price !== orig;
    });
  }, [rows, originalRows]);

  // Bulk save all valid priced items
  const handleSaveAll = async () => {
    const validPrices = rows
      .filter((r) => r.price !== null && r.price > 0 && r.unitId)
      .map((r) => ({
        fruitId: r.fruitId,
        unitId: r.unitId,
        price: r.price as number,
        notes: r.notes || null,
      }));

    if (validPrices.length === 0) {
      toast.error("Please enter at least one positive fruit price to save.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/prices/daily/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveDate: selectedDate,
          prices: validPrices,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save prices");

      toast.success(`Saved ${validPrices.length} daily market prices for ${selectedDate}`);
      await fetchBoard(selectedDate);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save prices");
    } finally {
      setSaving(false);
    }
  };

  // Filtered rows for search & category
  const categories = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.category || "General Produce")));
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (categoryFilter !== "ALL" && r.category !== categoryFilter) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        r.fruitName.toLowerCase().includes(q) ||
        (r.fruitVariety ?? "").toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
      );
    });
  }, [rows, categoryFilter, search]);

  const stats = useMemo(() => {
    const total = rows.length;
    const priced = rows.filter((r) => r.price !== null && r.price > 0).length;
    const pending = total - priced;
    return { total, priced, pending };
  }, [rows]);

  return (
    <div className="space-y-6">
      {/* Top Header & Date Selection */}
      <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent flex items-center gap-2.5">
            <CalendarDays className="h-7 w-7 text-[#173D32] dark:text-[#DCEFE3]" />
            Daily Price Board
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Publish morning mandi wholesale rates. These act as default prices for all new invoices on this date.
          </p>
        </div>

        {/* Date Selector & Copy yesterday button */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-1.5 shadow-sm">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-2">Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-sm font-medium bg-transparent border-0 focus:ring-0 text-slate-800 dark:text-slate-200 cursor-pointer"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyYesterday}
            disabled={copying || loading}
            className="gap-2 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:text-[#173D32] shadow-sm"
          >
            <Copy className="h-4 w-4 text-[#173D32] dark:text-[#DCEFE3]" />
            {copying ? "Copying..." : "Copy Yesterday's"}
          </Button>

          <Button
            size="sm"
            onClick={handleSaveAll}
            disabled={saving || loading}
            className="gap-2 bg-[#173D32] hover:bg-[#1e4d3f] shadow-md shadow-[#173D32]/20 text-white font-semibold"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : `Save All Prices ${changedRows.length > 0 ? `(${changedRows.length})` : ""}`}
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 bg-card border-border">
          <p className="text-xs font-medium text-muted-foreground">Total Produce</p>
          <p className="text-2xl font-bold text-foreground mt-0.5">{stats.total}</p>
        </Card>
        <Card className="p-4 bg-primary/10 dark:bg-primary/20 border border-primary/20">
          <p className="text-xs font-medium text-muted-foreground">Priced Today</p>
          <p className="text-2xl font-bold text-primary dark:text-secondary mt-0.5">{stats.priced}</p>
        </Card>
        <Card className="p-4 bg-[#E8A23A]/10 dark:bg-[#E8A23A]/20 border border-[#E8A23A]/30">
          <p className="text-xs font-medium text-muted-foreground">Unpriced</p>
          <p className="text-2xl font-bold text-[#E8A23A] mt-0.5">{stats.pending}</p>
        </Card>
      </div>

      {/* Invariance Banner */}
      <div className="p-3.5 rounded-xl bg-secondary/60 dark:bg-primary/30 border border-primary/20 dark:border-primary/50 flex items-start gap-3 text-xs text-primary dark:text-secondary">
        <Info className="h-5 w-5 text-primary dark:text-secondary shrink-0 mt-0.5" />
        <p>
          <span className="font-semibold">Contract Invariance Guarantee:</span> Default daily prices applied here will never overwrite negotiated client rates. If a customer has an agreed price contract for this date, their negotiated rate takes 100% priority.
        </p>
      </div>

      {/* Filter and Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search produce name or variety..."
            className="pl-9 bg-white dark:bg-slate-900"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
        >
          <option value="ALL">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Price Grid / Table (Touch optimized for mobile/Android mandi operations) */}
      <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Apple className="h-8 w-8 mx-auto text-slate-400 mb-2" />
            <p className="font-medium text-slate-700 dark:text-slate-300">No produce found</p>
            <p className="text-xs text-slate-400 mt-1">
              Add fruits in the Fruit Catalogue to begin entering daily market prices.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Produce & Variety</th>
                  <th className="py-3 px-3 hidden sm:table-cell">Category</th>
                  <th className="py-3 px-3">Unit</th>
                  <th className="py-3 px-4 w-44 text-right">Daily Rate (₹)</th>
                  <th className="py-3 px-3 w-16 text-center">History</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRows.map((row) => {
                  const isPriced = row.price !== null && row.price > 0;
                  return (
                    <tr
                      key={row.fruitId}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                          {row.fruitName}
                        </div>
                        {row.fruitVariety && (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {row.fruitVariety}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400 hidden sm:table-cell">
                        {row.category}
                      </td>

                      <td className="py-3 px-3">
                        <span className="font-mono text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                          {row.unitCode}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-sm font-semibold text-slate-400">₹</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={row.price ?? ""}
                            onChange={(e) => handlePriceChange(row.fruitId, e.target.value)}
                            className="w-28 text-right font-bold text-base h-10 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 focus:border-[#173D32] focus:ring-[#173D32] rounded-lg shadow-sm"
                          />
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center">
                        <PriceHistoryDialog
                          fruitId={row.fruitId}
                          fruitName={row.fruitName}
                          variety={row.fruitVariety}
                          unitId={row.unitId}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
