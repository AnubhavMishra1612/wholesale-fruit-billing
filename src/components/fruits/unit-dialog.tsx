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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Scale, Plus, Star, Archive, Check } from "lucide-react";
import { toast } from "sonner";

export interface FruitUnitData {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
  isArchived: boolean;
  _count?: {
    fruits: number;
    dailyPrices: number;
    customerPrices: number;
  };
}

interface UnitDialogProps {
  onUnitsChanged?: () => void;
  trigger?: React.ReactNode;
}

export function UnitDialog({ onUnitsChanged, trigger }: UnitDialogProps) {
  const [open, setOpen] = useState(false);
  const [units, setUnits] = useState<FruitUnitData[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  // New unit form state
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const fetchUnits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/fruits/units?includeArchived=true");
      if (!res.ok) throw new Error("Failed to load units");
      const data = await res.json();
      setUnits(data);
    } catch {
      toast.error("Failed to load units");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchUnits();
    }
  }, [open, fetchUnits]);

  async function handleCreateUnit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !code.trim()) {
      toast.error("Name and code are required");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/fruits/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim().toLowerCase(),
          isDefault,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create unit");
      }

      toast.success(`Unit "${data.name}" created`);
      setName("");
      setCode("");
      setIsDefault(false);
      await fetchUnits();
      onUnitsChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create unit");
    } finally {
      setCreating(false);
    }
  }

  async function handleSetDefault(unit: FruitUnitData) {
    try {
      const res = await fetch(`/api/fruits/units/${unit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) throw new Error("Failed to set default");
      toast.success(`"${unit.name}" is now the default unit`);
      await fetchUnits();
      onUnitsChanged?.();
    } catch {
      toast.error("Failed to set default unit");
    }
  }

  async function handleToggleArchive(unit: FruitUnitData) {
    const nextArchived = !unit.isArchived;
    try {
      const res = await fetch(`/api/fruits/units/${unit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: nextArchived, isDefault: nextArchived ? false : undefined }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      toast.success(nextArchived ? `Unit "${unit.name}" archived` : `Unit "${unit.name}" restored`);
      await fetchUnits();
      onUnitsChanged?.();
    } catch {
      toast.error("Failed to update unit");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-2">
            <Scale className="h-4 w-4" />
            Units of Measure
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-[#173D32] dark:text-[#DCEFE3]" />
            Fruit Units of Measure (UOM)
          </DialogTitle>
          <DialogDescription>
            Manage wholesale packing units (kg, crate, box, bag, etc.) used in your billing catalogue.
          </DialogDescription>
        </DialogHeader>

        {/* Create new unit form */}
        <form onSubmit={handleCreateUnit} className="space-y-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <Plus className="h-4 w-4 text-[#173D32] dark:text-[#DCEFE3]" /> Add Custom Unit
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="unit-name" className="text-xs font-medium">Unit Name</Label>
              <Input
                id="unit-name"
                placeholder="e.g. Wooden Crate, Cartons"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit-code" className="text-xs font-medium">Short Code</Label>
              <Input
                id="unit-code"
                placeholder="e.g. wcrt, ctn"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="rounded border-slate-300 text-[#173D32] focus:ring-[#173D32]"
              />
              Set as default unit for new fruits
            </label>
            <Button type="submit" size="sm" disabled={creating} className="gap-1.5 bg-[#173D32] hover:bg-[#1e4d3f] text-white">
              <Plus className="h-4 w-4" />
              {creating ? "Saving..." : "Add Unit"}
            </Button>
          </div>
        </form>

        {/* Units list */}
        <div className="space-y-2 mt-4">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Configured Units ({units.length})
          </h4>

          {loading ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : units.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">No units found.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              {units.map((unit) => (
                <div
                  key={unit.id}
                  className={`flex items-center justify-between p-3 transition-colors ${
                    unit.isArchived ? "bg-slate-50/50 dark:bg-slate-900/30 opacity-60" : "bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="h-8 w-8 rounded-lg bg-[#DCEFE3] dark:bg-[#173D32]/40 text-[#173D32] dark:text-[#DCEFE3] font-mono text-xs font-bold flex items-center justify-center shrink-0">
                      {unit.code}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
                          {unit.name}
                        </span>
                        {unit.isDefault && (
                          <Badge variant="default" className="text-[10px] py-0 px-1.5 bg-[#173D32] text-white">
                            Default
                          </Badge>
                        )}
                        {unit.isArchived && (
                          <Badge variant="neutral" className="text-[10px] py-0 px-1.5">
                            Archived
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        Code: <code className="text-slate-600 dark:text-slate-400">{unit.code}</code>
                        {unit._count && ` • Used in ${unit._count.fruits} fruits`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {!unit.isDefault && !unit.isArchived && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetDefault(unit)}
                        className="text-xs text-slate-600 dark:text-slate-400 hover:text-[#173D32] h-8 px-2 gap-1"
                        title="Set as default unit"
                      >
                        <Star className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Default</span>
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleArchive(unit)}
                      className={`text-xs h-8 px-2 gap-1 ${
                        unit.isArchived
                          ? "text-emerald-600 hover:text-emerald-700"
                          : "text-slate-400 hover:text-red-600"
                      }`}
                      title={unit.isArchived ? "Restore unit" : "Archive unit"}
                    >
                      <Archive className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{unit.isArchived ? "Restore" : "Archive"}</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
