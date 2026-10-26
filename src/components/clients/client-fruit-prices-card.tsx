"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tag, Plus, CheckCircle2, Clock, Trash2, Calendar, ShieldCheck, Scale } from "lucide-react";
import { toast } from "sonner";

interface NegotiatedPriceRow {
  id: string;
  fruitId: string;
  fruitName: string;
  fruitVariety?: string | null;
  category?: string | null;
  unitId: string;
  unitName: string;
  unitCode: string;
  price: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  notes?: string | null;
  isActive: boolean;
  createdAt: string;
}

export function ClientFruitPricesCard({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [prices, setPrices] = useState<NegotiatedPriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openModal, setOpenModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form states
  const [fruits, setFruits] = useState<Array<{ id: string; name: string; variety?: string | null; defaultUnitId?: string | null }>>([]);
  const [units, setUnits] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [selectedFruitId, setSelectedFruitId] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().split("T")[0]);
  const [effectiveTo, setEffectiveTo] = useState("");
  const [notes, setNotes] = useState("");

  const fetchPrices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/prices`);
      if (!res.ok) throw new Error("Failed to load customer rates");
      const data = await res.json();
      setPrices(data.prices || []);
    } catch {
      toast.error("Failed to load negotiated fruit rates");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void fetchPrices();
  }, [fetchPrices]);

  // Load fruits and units when modal opens
  useEffect(() => {
    if (openModal) {
      void (async () => {
        try {
          const [fRes, uRes] = await Promise.all([
            fetch("/api/fruits?isActive=true"),
            fetch("/api/fruits/units"),
          ]);
          if (fRes.ok && uRes.ok) {
            const fData = await fRes.json();
            const uData = await uRes.json();
            setFruits(fData);
            setUnits(uData);

            if (fData.length > 0 && !selectedFruitId) {
              setSelectedFruitId(fData[0].id);
              if (fData[0].defaultUnitId) {
                setSelectedUnitId(fData[0].defaultUnitId);
              } else if (uData.length > 0) {
                setSelectedUnitId(uData[0].id);
              }
            }
          }
        } catch {
          // Ignore
        }
      })();
    }
  }, [openModal, selectedFruitId]);

  // Handle fruit change and update unit to fruit's default unit
  const handleFruitChange = (fruitId: string) => {
    setSelectedFruitId(fruitId);
    const chosen = fruits.find((f) => f.id === fruitId);
    if (chosen?.defaultUnitId) {
      setSelectedUnitId(chosen.defaultUnitId);
    }
  };

  const handleCreatePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    const numPrice = parseFloat(priceInput);
    if (isNaN(numPrice) || numPrice <= 0) {
      toast.error("Please enter a valid price greater than zero");
      return;
    }
    if (!selectedFruitId || !selectedUnitId) {
      toast.error("Please select both fruit and unit");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fruitId: selectedFruitId,
          unitId: selectedUnitId,
          price: numPrice,
          effectiveFrom,
          effectiveTo: effectiveTo ? effectiveTo : null,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create rate");

      toast.success("Negotiated rate contract saved");
      setOpenModal(false);
      setPriceInput("");
      setNotes("");
      setEffectiveTo("");
      await fetchPrices();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create rate");
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePrice = async (priceId: string) => {
    try {
      const res = await fetch(`/api/clients/${clientId}/prices/${priceId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove contract");
      toast.success("Negotiated rate contract removed");
      await fetchPrices();
    } catch {
      toast.error("Failed to remove negotiated rate");
    }
  };

  return (
    <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Tag className="h-5 w-5 text-[#173D32] dark:text-[#DCEFE3]" />
            Negotiated Produce Rates
          </CardTitle>
          <CardDescription className="text-xs">
            Customer-specific contracted rates. Invoices automatically apply these rates over daily board prices.
          </CardDescription>
        </div>

        <Dialog open={openModal} onOpenChange={setOpenModal}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5 self-start sm:self-auto bg-[#173D32] hover:bg-[#1e4d3f] text-white shadow-sm">
              <Plus className="h-4 w-4" />
              Add Negotiated Rate
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-[#173D32] dark:text-[#DCEFE3]" />
                Negotiate Rate for {clientName}
              </DialogTitle>
              <DialogDescription>
                Define a custom rate that takes precedence over daily mandi price boards.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreatePrice} className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="fruit-select" className="text-xs font-medium">Produce Item</Label>
                <Select
                  id="fruit-select"
                  value={selectedFruitId}
                  onChange={(e) => handleFruitChange(e.target.value)}
                  required
                >
                  {fruits.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} {f.variety ? `(${f.variety})` : ""}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="unit-select" className="text-xs font-medium">Unit</Label>
                  <Select
                    id="unit-select"
                    value={selectedUnitId}
                    onChange={(e) => setSelectedUnitId(e.target.value)}
                    required
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.code})
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="rate-input" className="text-xs font-medium">Agreed Rate (₹)</Label>
                  <Input
                    id="rate-input"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    required
                    className="font-bold text-base"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="from-date" className="text-xs font-medium">Effective From</Label>
                  <Input
                    id="from-date"
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="to-date" className="text-xs font-medium">Effective To (Optional)</Label>
                  <Input
                    id="to-date"
                    type="date"
                    value={effectiveTo}
                    onChange={(e) => setEffectiveTo(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes-input" className="text-xs font-medium">Agreement Notes / Reference</Label>
                <Input
                  id="notes-input"
                  placeholder="e.g. Bulk discount agreed for Q4"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <DialogFooter className="pt-3">
                <Button type="button" variant="outline" onClick={() => setOpenModal(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving} className="bg-[#173D32] hover:bg-[#1e4d3f] text-white">
                  {saving ? "Saving..." : "Save Negotiated Rate"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 text-xs text-emerald-800 dark:text-emerald-300">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>
            <strong>Priority Rule:</strong> Negotiated rates never change when daily market prices are updated.
          </span>
        </div>

        {loading ? (
          <div className="space-y-2 py-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            ))}
          </div>
        ) : prices.length === 0 ? (
          <div className="text-center py-6 text-slate-500">
            <p className="text-xs">No customer-specific fruit rates defined.</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Invoices for this client will automatically use the active daily price board.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {prices.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                      {item.fruitName}
                    </span>
                    {item.fruitVariety && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        ({item.fruitVariety})
                      </span>
                    )}
                    {item.isActive ? (
                      <Badge variant="success" className="text-[10px] py-0 px-1.5">
                        Active Contract
                      </Badge>
                    ) : (
                      <Badge variant="neutral" className="text-[10px] py-0 px-1.5">
                        Expired
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2">
                    <span>
                      Effective: <strong>{item.effectiveFrom}</strong>
                      {item.effectiveTo ? ` to ${item.effectiveTo}` : " (Open-ended)"}
                    </span>
                    {item.notes && <span className="italic">• {item.notes}</span>}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                    ₹{item.price.toFixed(2)}
                    <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-0.5">
                      /{item.unitCode}
                    </span>
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeletePrice(item.id)}
                    className="h-8 w-8 p-0 text-slate-400 hover:text-red-600"
                    title="Remove rate"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
