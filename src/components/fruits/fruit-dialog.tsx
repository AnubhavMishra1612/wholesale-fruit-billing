"use client";

import { useState, useEffect, useRef, useMemo } from "react";
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
import {
  Plus,
  Pencil,
  Apple,
  Trash2,
  Save,
  Check,
  X,
  AlertTriangle,
  AlertCircle,
  Loader2,
} from "lucide-react";
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
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  fruit?: FruitData | null;
  onFruitChange?: (fruit: FruitData | null) => void;
  catalogueFruits?: FruitData[];
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

export function FruitDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  fruit,
  onFruitChange,
  catalogueFruits = [],
  onSuccess,
  trigger,
}: FruitDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = (value: boolean) => {
    if (!isControlled) {
      setInternalOpen(value);
    }
    controlledOnOpenChange?.(value);
  };

  const [loading, setLoading] = useState(false);
  const [savingAndNext, setSavingAndNext] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const [currentFruit, setCurrentFruit] = useState<FruitData | null>(fruit || null);
  const [units, setUnits] = useState<Array<{ id: string; name: string; code: string; isDefault: boolean }>>([]);

  // Form states
  const [name, setName] = useState("");
  const [variety, setVariety] = useState("");
  const [category, setCategory] = useState("Apples & Pears");
  const [hsnCode, setHsnCode] = useState("0808");
  const [defaultUnitId, setDefaultUnitId] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Initial snapshot to track dirty state
  const initialValuesRef = useRef({
    name: "",
    variety: "",
    category: "Apples & Pears",
    hsnCode: "0808",
    defaultUnitId: "",
    isActive: true,
  });

  const isEditing = Boolean(currentFruit);

  // Keep currentFruit in sync with prop if it changes externally
  useEffect(() => {
    setCurrentFruit(fruit || null);
  }, [fruit]);

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

  // Populate form when editing or switching fruit
  useEffect(() => {
    if (open && currentFruit) {
      setName(currentFruit.name);
      setVariety(currentFruit.variety || "");
      setCategory(currentFruit.category || "Apples & Pears");
      setHsnCode(currentFruit.hsnCode || "0808");
      setDefaultUnitId(currentFruit.defaultUnitId || "");
      setIsActive(currentFruit.isActive);

      initialValuesRef.current = {
        name: currentFruit.name,
        variety: currentFruit.variety || "",
        category: currentFruit.category || "Apples & Pears",
        hsnCode: currentFruit.hsnCode || "0808",
        defaultUnitId: currentFruit.defaultUnitId || "",
        isActive: currentFruit.isActive,
      };
    } else if (open && !currentFruit) {
      setName("");
      setVariety("");
      setCategory("Apples & Pears");
      setHsnCode("0808");
      setIsActive(true);

      initialValuesRef.current = {
        name: "",
        variety: "",
        category: "Apples & Pears",
        hsnCode: "0808",
        defaultUnitId: "",
        isActive: true,
      };
    }
  }, [open, currentFruit]);

  // Check if form has unsaved modifications
  const isDirty = useMemo(() => {
    if (!open) return false;
    const init = initialValuesRef.current;
    return (
      name !== init.name ||
      variety !== init.variety ||
      category !== init.category ||
      hsnCode !== init.hsnCode ||
      defaultUnitId !== init.defaultUnitId ||
      isActive !== init.isActive
    );
  }, [open, name, variety, category, hsnCode, defaultUnitId, isActive]);

  // Safe close handler that checks for unsaved edits
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      if (isDirty) {
        setShowDiscardConfirm(true);
        return;
      }
      setOpen(false);
      setShowDeleteConfirm(false);
      setShowDiscardConfirm(false);
      return;
    }
    setOpen(true);
  }

  function handleCancel() {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    setOpen(false);
  }

  // Save changes and close modal
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Fruit name is required");
      return;
    }

    setLoading(true);
    try {
      const url = isEditing ? `/api/fruits/${currentFruit!.id}` : "/api/fruits";
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

  // Save current item and immediately advance to the next fruit in catalogue
  async function handleSaveAndNext() {
    if (!name.trim()) {
      toast.error("Fruit name is required");
      return;
    }

    setSavingAndNext(true);
    try {
      const url = isEditing ? `/api/fruits/${currentFruit!.id}` : "/api/fruits";
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

      onSuccess?.();

      // Locate next fruit in list
      if (catalogueFruits && catalogueFruits.length > 0 && isEditing) {
        const curIdx = catalogueFruits.findIndex((f) => f.id === currentFruit!.id);
        const nextFruit =
          curIdx >= 0 && curIdx < catalogueFruits.length - 1 ? catalogueFruits[curIdx + 1] : null;

        if (nextFruit) {
          toast.success(`"${data.name}" saved. Editing next: "${nextFruit.name}"`);
          setCurrentFruit(nextFruit);
          onFruitChange?.(nextFruit);
          return;
        }
      }

      toast.success(`"${data.name}" saved. End of catalogue list reached.`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save fruit");
    } finally {
      setSavingAndNext(false);
    }
  }

  // Permanent archive / delete handler
  async function handleDeleteConfirm() {
    if (!currentFruit) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/fruits/${currentFruit.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete fruit");
      }

      toast.success(`"${currentFruit.name}" removed from catalogue`);
      setShowDeleteConfirm(false);
      setOpen(false);
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete fruit");
    } finally {
      setDeleting(false);
    }
  }

  const isBusy = loading || savingAndNext || deleting;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}

      <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl md:max-w-3xl lg:max-w-[1150px] xl:max-w-[1220px] max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-2xl shadow-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900">
        {/* Header */}
        <div className="p-5 sm:p-6 pb-4 sm:pb-5 border-b border-slate-200/80 dark:border-slate-800 shrink-0 bg-white dark:bg-slate-900 flex items-start gap-4 pr-14 relative">
          <div className="w-12 h-12 rounded-xl bg-[#EAF5EF] dark:bg-[#173D32]/40 border border-[#C6E7D2] dark:border-[#173D32]/60 text-[#173D32] dark:text-[#DCEFE3] flex items-center justify-center shrink-0 shadow-xs">
            <Apple className="h-6 w-6 text-[#173D32] dark:text-[#DCEFE3]" />
          </div>

          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {isEditing ? "Edit Fruit Catalogue Item" : "Add Fruit Catalogue Item"}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              {isEditing
                ? "Update fruit name, variety, category, unit, HSN code or status."
                : "Register produce into your mandi inventory and daily price board."}
            </DialogDescription>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
              {/* Field 1: Fruit Name */}
              <div className="space-y-1.5">
                <Label htmlFor="fruit-name" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Fruit Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="fruit-name"
                  placeholder="e.g. Apple, Pomegranate, Mango"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isBusy}
                  required
                  className="h-10 rounded-lg border-slate-200 dark:border-slate-700 focus-visible:ring-2 focus-visible:ring-[#173D32] focus-visible:border-[#173D32]"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Commercial name displayed on mandi bills and price boards.
                </p>
              </div>

              {/* Field 2: Variety / Grade */}
              <div className="space-y-1.5">
                <Label htmlFor="fruit-variety" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Variety / Grade
                </Label>
                <Input
                  id="fruit-variety"
                  placeholder="e.g. Kashmiri Delicious, Royal, Grade A"
                  value={variety}
                  onChange={(e) => setVariety(e.target.value)}
                  disabled={isBusy}
                  className="h-10 rounded-lg border-slate-200 dark:border-slate-700 focus-visible:ring-2 focus-visible:ring-[#173D32] focus-visible:border-[#173D32]"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Cultivar, grade specification or produce origin marking.
                </p>
              </div>

              {/* Field 3: Category */}
              <div className="space-y-1.5">
                <Label htmlFor="fruit-category" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Category
                </Label>
                <Select
                  id="fruit-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={isBusy}
                  className="h-10 rounded-lg border-slate-200 dark:border-slate-700 focus-visible:ring-2 focus-visible:ring-[#173D32] focus-visible:border-[#173D32]"
                >
                  {DEFAULT_FRUIT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Catalogue grouping for inventory filters and reports.
                </p>
              </div>

              {/* Field 4: Default Unit */}
              <div className="space-y-1.5">
                <Label htmlFor="fruit-unit" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Default Unit of Measure
                </Label>
                <Select
                  id="fruit-unit"
                  value={defaultUnitId}
                  onChange={(e) => setDefaultUnitId(e.target.value)}
                  disabled={isBusy}
                  className="h-10 rounded-lg border-slate-200 dark:border-slate-700 focus-visible:ring-2 focus-visible:ring-[#173D32] focus-visible:border-[#173D32]"
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.code})
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Standard trading unit for wholesale weights and invoices.
                </p>
              </div>

              {/* Field 5: HSN Code (GST) */}
              <div className="space-y-1.5">
                <Label htmlFor="fruit-hsn" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  HSN Code (GST)
                </Label>
                <Input
                  id="fruit-hsn"
                  placeholder="0808 (Fresh Apples, Pears)"
                  value={hsnCode}
                  onChange={(e) => setHsnCode(e.target.value)}
                  disabled={isBusy}
                  className="h-10 rounded-lg border-slate-200 dark:border-slate-700 focus-visible:ring-2 focus-visible:ring-[#173D32] focus-visible:border-[#173D32]"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Indian GST commodity classification for fruit produce.
                </p>
              </div>

              {/* Field 6: Daily Board & Active Status */}
              <div className="flex flex-col justify-center rounded-xl border border-[#C6E7D2] dark:border-[#173D32]/60 bg-[#EAF5EF] dark:bg-[#173D32]/20 p-4 space-y-1.5 sm:pt-7">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    disabled={isBusy}
                    className="h-4 w-4 rounded border-[#173D32]/40 text-[#173D32] focus:ring-[#173D32]"
                  />
                  <span className="text-sm font-semibold text-[#173D32] dark:text-[#DCEFE3]">
                    Available in Daily Price Board
                  </span>
                </label>
                <p className="text-xs text-[#173D32]/80 dark:text-[#DCEFE3]/75 pl-6.5">
                  Enable this produce for daily mandi rate sheets and wholesale invoice lines.
                </p>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <DialogFooter className="p-4 sm:p-6 pt-3.5 sm:pt-4 border-t border-slate-200/80 dark:border-slate-800 shrink-0 bg-slate-50/80 dark:bg-slate-900/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            {/* Left Action: Delete Item (Visible when editing) */}
            <div>
              {isEditing ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isBusy}
                  className="w-full sm:w-auto gap-2 border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 hover:border-red-300 font-medium"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Item
                </Button>
              ) : (
                <div />
              )}
            </div>

            {/* Right Actions: Cancel, Save & Edit Next, Save Changes */}
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isBusy}
                className="w-full sm:w-auto border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
              >
                Cancel
              </Button>

              {isEditing && (
                <Button
                  type="button"
                  onClick={handleSaveAndNext}
                  disabled={isBusy}
                  className="w-full sm:w-auto gap-2 bg-[#EAF5EF] hover:bg-[#DCEFE3] text-[#173D32] border border-[#C6E7D2] dark:bg-[#173D32]/30 dark:hover:bg-[#173D32]/50 dark:text-[#DCEFE3] dark:border-[#173D32]/60 font-medium shadow-2xs"
                >
                  {savingAndNext ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {savingAndNext ? "Saving..." : "Save & Edit Next"}
                </Button>
              )}

              <Button
                type="submit"
                disabled={isBusy}
                className="w-full sm:w-auto gap-2 bg-[#173D32] hover:bg-[#1e4d3f] text-white shadow-sm font-semibold focus-visible:ring-2 focus-visible:ring-[#173D32]"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {loading ? "Saving..." : isEditing ? "Save Changes" : "Create Fruit"}
              </Button>
            </div>
          </DialogFooter>
        </form>

        {/* Confirmation Modal: Delete Item */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-start gap-3.5">
                <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Delete Fruit Catalogue Item?
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                    Are you sure you want to delete{" "}
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      "{currentFruit?.name}"
                    </span>
                    ? This will archive the item from your active inventory and daily price board while preserving historical invoice line items.
                  </p>
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                  className="w-full sm:w-auto gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      Delete Item
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation Modal: Discard Unsaved Changes */}
        {showDiscardConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-start gap-3.5">
                <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Discard Unsaved Changes?
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                    You have unsaved changes to this fruit item. If you leave now, your edits will not be saved.
                  </p>
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowDiscardConfirm(false)}
                  className="w-full sm:w-auto"
                >
                  Keep Editing
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setShowDiscardConfirm(false);
                    setOpen(false);
                  }}
                  className="w-full sm:w-auto bg-slate-800 hover:bg-slate-900 text-white font-semibold"
                >
                  Discard Changes
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
