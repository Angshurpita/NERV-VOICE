import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, Search, ExternalLink } from "lucide-react";
import {
  SurfaceCard,
  CardHeader,
  EmptyState,
  SkeletonRows,
} from "@/components/shared/SurfaceCard";
import { StatusBadge } from "@/components/shared/Badges";
import { Input } from "@/components/ui/input";
import { api, formatInr } from "@/lib/api";

export const Route = createFileRoute("/orders")({
  component: OrdersPage,
});

function OrdersPage() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["catalogue", "orders"],
    queryFn: api.catalogue.orders,
  });

  const orders = data?.orders ?? [];
  const filtered = orders.filter((o) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      o.id.toLowerCase().includes(term) ||
      o.customerName.toLowerCase().includes(term) ||
      o.items.join(", ").toLowerCase().includes(term) ||
      o.city.toLowerCase().includes(term) ||
      o.status.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-5 animate-fade-in-up">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Orders Catalogue</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Reference database used by the AI agent for customer identity and
            order verification
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order or customer…"
            className="pl-8 text-xs"
          />
        </div>
      </div>

      <SurfaceCard>
        <CardHeader
          title="All Orders"
          subtitle={`${filtered.length} total orders found`}
          icon={<Package className="size-4" />}
        />

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-muted/30 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Order ID</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Total Amount</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">City</th>
                <th className="px-4 py-3">Tracking</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <SkeletonRows rows={8} columns={7} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={<Package className="size-5" />}
                      title="No orders found"
                      description="Try adjusting your search criteria."
                    />
                  </td>
                </tr>
              ) : (
                filtered.map((order) => (
                  <tr
                    key={order.id}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-foreground">
                      #{order.id}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {order.customerName}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.status.toLowerCase()} />
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground">
                      {formatInr(order.totalInr)}
                    </td>
                    <td
                      className="px-4 py-3 text-muted-foreground max-w-xs truncate"
                      title={order.items.join(", ")}
                    >
                      {order.items.join(", ")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {order.city}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                      {order.trackingId ? (
                        <span className="flex items-center gap-1">
                          {order.trackingId}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </div>
  );
}
