"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { History, TrendingUp, TrendingDown, ArrowUpDown, Calendar } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";

interface PriceHistoryEntry {
  id: string;
  effectiveDate: string;
  price: number;
  notes?: string | null;
  unit: { id: string; name: string; code: string };
  createdAt: string;
}

interface PriceHistoryStats {
  count: number;
  latest: number | null;
  highest: number | null;
  lowest: number | null;
  average: number | null;
}

interface PriceHistoryDialogProps {
  fruitId: string;
  fruitName: string;
  variety?: string | null;
  unitId?: string | null;
  trigger?: React.ReactNode;
}

export function PriceHistoryDialog({
  fruitId,
  fruitName,
  variety,
  unitId,
  trigger,
}: PriceHistoryDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<PriceHistoryEntry[]>([]);
  const [stats, setStats] = useState<PriceHistoryStats | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/api/prices/history?fruitId=${fruitId}&limit=30`;
      if (unitId) url += `&unitId=${unitId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load price history");
      const data = await res.json();
      setHistory(data.history || []);
      setStats(data.stats || null);
    } catch {
      toast.error("Failed to load price history");
    } finally {
      setLoading(false);
    }
  }, [fruitId, unitId]);

  useEffect(() => {
    if (open) {
      void fetchHistory();
    }
  }, [open, fetchHistory]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500 hover:text-[#173D32]">
            <History className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-[#173D32] dark:text-[#DCEFE3]" />
            Price History: {fruitName} {variety && `(${variety})`}
          </DialogTitle>
          <DialogDescription>
            Chronological market price records and 30-day statistical spread.
          </DialogDescription>
        </DialogHeader>

        {stats && stats.count > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2">
            <div className="p-3 rounded-lg bg-secondary/60 dark:bg-primary/30 border border-primary/20">
              <span className="text-[11px] font-medium text-muted-foreground block">Latest</span>
              <span className="text-lg font-bold text-primary dark:text-secondary">
                ₹{stats.latest?.toFixed(2)}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-primary/10 dark:bg-primary/20 border border-primary/20">
              <span className="text-[11px] font-medium text-muted-foreground block">30d High</span>
              <span className="text-lg font-bold text-primary dark:text-secondary">
                ₹{stats.highest?.toFixed(2)}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-[#E8A23A]/10 dark:bg-[#E8A23A]/20 border border-[#E8A23A]/30">
              <span className="text-[11px] font-medium text-muted-foreground block">30d Low</span>
              <span className="text-lg font-bold text-[#E8A23A]">
                ₹{stats.lowest?.toFixed(2)}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-muted/70 dark:bg-muted/40 border border-border">
              <span className="text-[11px] font-medium text-muted-foreground block">30d Avg</span>
              <span className="text-lg font-bold text-foreground">
                ₹{stats.average?.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        <div className="space-y-2 mt-2">
          {loading ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <Calendar className="h-8 w-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm">No price history recorded yet for this fruit.</p>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3 text-left font-medium">Effective Date</th>
                    <th className="py-2.5 px-3 text-left font-medium">Unit</th>
                    <th className="py-2.5 px-3 text-right font-medium">Rate (₹)</th>
                    <th className="py-2.5 px-3 text-left font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {history.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-medium text-slate-800 dark:text-slate-200">
                        {row.effectiveDate}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 font-mono">
                        {row.unit.name} ({row.unit.code})
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900 dark:text-slate-100">
                        ₹{row.price.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 truncate max-w-[150px]">
                        {row.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
