"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Apple,
  Search,
  Scale,
  Plus,
  Pencil,
  Archive,
  RotateCcw,
  Tag,
  CheckCircle2,
  XCircle,
  Filter,
} from "lucide-react";
import { FruitDialog, type FruitData } from "@/components/fruits/fruit-dialog";
import { UnitDialog } from "@/components/fruits/unit-dialog";
import { toast } from "sonner";
import { DEFAULT_FRUIT_CATEGORIES } from "@/lib/fruit-defaults";

export default function FruitsPage() {
  const [fruits, setFruits] = useState<FruitData[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedFruit, setSelectedFruit] = useState<FruitData | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const fetchFruits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/fruits?includeArchived=${showArchived}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load fruit catalogue");
      const data: FruitData[] = await res.json();
      setFruits(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load fruits");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    void fetchFruits();
  }, [fetchFruits]);

  const filteredFruits = useMemo(() => {
    if (!fruits) return [];
    return fruits.filter((f) => {
      const matchesCategory =
        selectedCategory === "ALL" || (f.category || "General Produce") === selectedCategory;

      if (!matchesCategory) return false;

      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        f.name.toLowerCase().includes(q) ||
        (f.variety ?? "").toLowerCase().includes(q) ||
        (f.category ?? "").toLowerCase().includes(q) ||
        (f.hsnCode ?? "").toLowerCase().includes(q)
      );
    });
  }, [fruits, selectedCategory, search]);

  const stats = useMemo(() => {
    if (!fruits) return { total: 0, active: 0, categories: 0 };
    const nonArchived = fruits.filter((f) => !f.isArchived);
    const active = nonArchived.filter((f) => f.isActive).length;
    const cats = new Set(nonArchived.map((f) => f.category || "General Produce")).size;
    return {
      total: nonArchived.length,
      active,
      categories: cats,
    };
  }, [fruits]);

  async function handleToggleStatus(fruit: FruitData) {
    try {
      const res = await fetch(`/api/fruits/${fruit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !fruit.isActive }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      toast.success(
        fruit.isActive
          ? `"${fruit.name}" disabled from daily board`
          : `"${fruit.name}" enabled in daily board`
      );
      await fetchFruits();
    } catch {
      toast.error("Failed to update status");
    }
  }

  async function handleToggleArchive(fruit: FruitData) {
    const nextArchived = !fruit.isArchived;
    try {
      const res = await fetch(`/api/fruits/${fruit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: nextArchived, isActive: nextArchived ? false : true }),
      });
      if (!res.ok) throw new Error("Failed to update archive status");
      toast.success(
        nextArchived
          ? `"${fruit.name}" archived from catalogue`
          : `"${fruit.name}" restored to catalogue`
      );
      await fetchFruits();
    } catch {
      toast.error("Failed to archive fruit");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header section with responsive layout */}
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent flex items-center gap-2.5">
            <Apple className="h-7 w-7 text-red-500" />
            Fruit Catalogue
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage wholesale produce varieties, units of measure, and active daily board items.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <UnitDialog onUnitsChanged={fetchFruits} />
          <Button
            onClick={() => {
              setSelectedFruit(null);
              setIsDialogOpen(true);
            }}
            className="gap-2 bg-[#173D32] hover:bg-[#1e4d3f] text-white shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Add Fruit
          </Button>
        </div>
      </div>

      {/* Quick metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card className="p-4 bg-card border-border">
          <p className="text-xs font-medium text-muted-foreground">Total Produce</p>
          <p className="text-2xl font-bold text-primary dark:text-secondary mt-0.5">{stats.total}</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-secondary/50 to-background dark:from-primary/20 dark:to-card border-border">
          <p className="text-xs font-medium text-muted-foreground">Active in Daily Board</p>
          <p className="text-2xl font-bold text-primary dark:text-secondary mt-0.5">{stats.active}</p>
        </Card>
        <Card className="col-span-2 sm:col-span-1 p-4 bg-gradient-to-br from-secondary/40 to-muted dark:from-primary/30 dark:to-card border-border">
          <p className="text-xs font-medium text-muted-foreground">Produce Categories</p>
          <p className="text-2xl font-bold text-primary dark:text-secondary mt-0.5">{stats.categories}</p>
        </Card>
      </div>

      {/* Search, Filter bar & Archive switch */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-2 flex-1">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by fruit name, variety, category, HSN..."
              className="pl-9 w-full bg-white dark:bg-slate-900"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="ALL">All Categories</option>
              {DEFAULT_FRUIT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <Button
              variant={showArchived ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowArchived((s) => !s)}
              className="h-10 text-xs shrink-0"
            >
              {showArchived ? "Hide Archived" : "Show Archived"}
            </Button>
          </div>
        </div>
      </div>

      {/* Catalogue List / Grid */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-5 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
              </CardHeader>
              <CardContent>
                <div className="h-4 w-full bg-slate-100 dark:bg-slate-800/50 rounded mb-2" />
                <div className="h-4 w-2/3 bg-slate-100 dark:bg-slate-800/50 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 p-6 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <Button onClick={fetchFruits} variant="outline" size="sm" className="mt-3">
            Retry
          </Button>
        </Card>
      ) : filteredFruits.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <div className="h-12 w-12 rounded-full bg-[#DCEFE3] dark:bg-[#173D32]/40 text-[#173D32] dark:text-[#DCEFE3] flex items-center justify-center mx-auto mb-3">
            <Apple className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
            {search ? "No matching fruits found" : "Your fruit catalogue is empty"}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
            {search
              ? "Try adjusting your search terms or selecting 'All Categories'."
              : "Add your first wholesale fruit variety to begin pricing and billing."}
          </p>
          {!search && (
            <div className="mt-4">
              <Button
                onClick={() => {
                  setSelectedFruit(null);
                  setIsDialogOpen(true);
                }}
                className="gap-2 bg-[#173D32] hover:bg-[#1e4d3f] text-white shadow-sm"
              >
                <Plus className="h-4 w-4" />
                Add Fruit
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredFruits.map((fruit) => (
            <Card
              key={fruit.id}
              className={`transition-all border hover:shadow-md ${
                fruit.isArchived
                  ? "bg-slate-50/60 dark:bg-slate-900/40 opacity-70 border-slate-200 dark:border-slate-800"
                  : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800"
              }`}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="font-semibold text-base text-slate-900 dark:text-slate-100 truncate">
                        {fruit.name}
                      </h3>
                      {fruit.variety && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium">
                          {fruit.variety}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {fruit.category || "General Produce"} • HSN: {fruit.hsnCode || "0808"}
                    </p>
                  </div>

                  <div className="shrink-0 flex items-center gap-1">
                    {fruit.isArchived ? (
                      <Badge variant="neutral" className="text-[10px]">
                        Archived
                      </Badge>
                    ) : fruit.isActive ? (
                      <Badge variant="success" className="text-[10px] gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="draft" className="text-[10px] gap-1">
                        <XCircle className="h-3 w-3" />
                        Inactive
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1 font-mono">
                    <Scale className="h-3.5 w-3.5 text-[#173D32] dark:text-[#DCEFE3]" />
                    Unit: {fruit.defaultUnit ? `${fruit.defaultUnit.name} (${fruit.defaultUnit.code})` : "Kilogram (kg)"}
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedFruit(fruit);
                        setIsDialogOpen(true);
                      }}
                      className="h-8 w-8 p-0 text-slate-500 hover:text-[#173D32]"
                      title="Edit fruit details"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>

                    {!fruit.isArchived && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleStatus(fruit)}
                        className={`h-8 px-2 text-xs ${
                          fruit.isActive
                            ? "text-slate-500 hover:text-amber-600"
                            : "text-emerald-600 hover:text-emerald-700 font-medium"
                        }`}
                        title={fruit.isActive ? "Deactivate from daily board" : "Activate for daily board"}
                      >
                        {fruit.isActive ? "Disable" : "Enable"}
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleArchive(fruit)}
                      className={`h-8 w-8 p-0 ${
                        fruit.isArchived
                          ? "text-emerald-600 hover:text-emerald-700"
                          : "text-slate-400 hover:text-red-600"
                      }`}
                      title={fruit.isArchived ? "Restore to catalogue" : "Archive fruit"}
                    >
                      {fruit.isArchived ? (
                        <RotateCcw className="h-3.5 w-3.5" />
                      ) : (
                        <Archive className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Single Edit / Create Fruit Catalogue Modal */}
      <FruitDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        fruit={selectedFruit}
        onFruitChange={setSelectedFruit}
        catalogueFruits={filteredFruits}
        onSuccess={fetchFruits}
      />
    </div>
  );
}
