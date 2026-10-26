"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Plus, Pencil, Apple } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_FRUIT_CATEGORIES } from "@/lib/fruit-defaults";

export interface FruitData {
  id: string;
  name: string;
  variety?: string | null;
  category?: string | null;
  hsnCode?: string | null;
  defaultUnitId?: string | null;
  isActive: boolean;
  isArchived: boolean;
  defaultUnit?: { id: string; name: string; code: string } | null;
}

interface FruitDialogProps {
  fruit?: FruitData | null;
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

export function FruitDialog({ fruit, onSuccess, trigger }: FruitDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [units, setUnits] = useState<Array<{ id: string; name: string; code: string; isDefault: boolean }>>([]);

  // Form states
  const [name, setName] = useState("");
  const [variety, setVariety] = useState("");
  const [category, setCategory] = useState("Apples & Pears");
  const [hsnCode, setHsnCode] = useState("0808");
  const [defaultUnitId, setDefaultUnitId] = useState("");
  const [isActive, setIsActive] = useState(true);

  const isEditing = Boolean(fruit);

  // Load active units for the dropdown
  useEffect(() => {
    if (open) {
      void (async () => {
        try {
          const res = await fetch("/api/fruits/units");
          if (res.ok) {
            const data = await res.json();
            setUnits(data);
            if (!defaultUnitId && data.length > 0) {
              const def = data.find((u: { isDefault: boolean }) => u.isDefault) || data[0];
              setDefaultUnitId(def.id);
            }
          }
        } catch {
          // Ignore
        }
      })();
    }
  }, [open, defaultUnitId]);

  // Populate form when editing or resetting
  useEffect(() => {
    if (open && fruit) {
      setName(fruit.name);
      setVariety(fruit.variety || "");
      setCategory(fruit.category || "Apples & Pears");
      setHsnCode(fruit.hsnCode || "0808");
      setDefaultUnitId(fruit.defaultUnitId || "");
      setIsActive(fruit.isActive);
    } else if (open && !fruit) {
      setName("");
      setVariety("");
      setCategory("Apples & Pears");
      setHsnCode("0808");
      setIsActive(true);
    }
  }, [open, fruit]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Fruit name is required");
      return;
    }

    setLoading(true);
    try {
      const url = isEditing ? `/api/fruits/${fruit!.id}` : "/api/fruits";
      const method = isEditing ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          variety: variety.trim() || null,
          category: category.trim() || null,
          hsnCode: hsnCode.trim() || "0808",
          defaultUnitId: defaultUnitId || null,
          isActive,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save fruit");
      }

      toast.success(isEditing ? `"${data.name}" updated` : `"${data.name}" added to catalogue`);
      setOpen(false);
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save fruit");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="gap-2 bg-[#173D32] hover:bg-[#1e4d3f] text-white shadow-sm">
            <Plus className="h-4 w-4" />
            Add Fruit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Apple className="h-5 w-5 text-[#173D32] dark:text-[#DCEFE3]" />
            {isEditing ? "Edit Fruit Catalogue Item" : "Add New Fruit"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update variety, category, default unit, or active status."
              : "Register produce into your mandi inventory and daily price board."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fruit-name" className="text-sm font-medium">
                Fruit Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="fruit-name"
                placeholder="e.g. Apple, Pomegranate"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fruit-variety" className="text-sm font-medium">
                Variety / Grade
              </Label>
              <Input
                id="fruit-variety"
                placeholder="e.g. Kashmiri Delicious, Royal"
                value={variety}
                onChange={(e) => setVariety(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fruit-category" className="text-sm font-medium">
                Category
              </Label>
              <Select
                id="fruit-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {DEFAULT_FRUIT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fruit-unit" className="text-sm font-medium">
                Default Unit
              </Label>
              <Select
                id="fruit-unit"
                value={defaultUnitId}
                onChange={(e) => setDefaultUnitId(e.target.value)}
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.code})
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fruit-hsn" className="text-sm font-medium">
                HSN Code (GST)
              </Label>
              <Input
                id="fruit-hsn"
                placeholder="0808 (Fresh Apples, Pears)"
                value={hsnCode}
                onChange={(e) => setHsnCode(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-3 pt-6">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#173D32] focus:ring-[#173D32]"
                />
                Available in Daily Board
              </label>
            </div>
          </div>

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="gap-2 bg-[#173D32] hover:bg-[#1e4d3f] text-white">
              {loading ? "Saving..." : isEditing ? "Save Changes" : "Create Fruit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
