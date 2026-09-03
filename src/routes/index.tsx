import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Headphones,
  Phone,
  ShieldCheck,
  TicketCheck,
  Timer,
} from "lucide-react";
import { api, formatDuration, formatRelative } from "@/lib/api";
import {
  CardHeader,
  EmptyState,
  Metric,
  SurfaceCard,
} from "@/components/shared/SurfaceCard";
import {
  ConfidenceBadge,
  PriorityBadge,
  ReasonBadge,
  StatusBadge,
} from "@/components/shared/Badges";

export const Route = createFileRoute("/")({ component: Overview });

/**
 * Operations overview.
 *
 * Every figure is derived from stored calls and tickets. The previous version
 * rendered a single hardcoded escalation card and nothing else; where there is no
 * data now, this shows an empty state rather than inventing traffic.
 */
function Overview() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: api.analytics.overview,
    refetchInterval: 20_000,
  });

  const { data: queue } = useQuery({
    queryKey: ["escalations", "pending"],
    queryFn: async () => (await api.escalations.list("pending")).escalations,
    refetchInterval: 12_000,
  });

  const { data: recent } = useQuery({
    queryKey: ["calls", "recent"],
    queryFn: async () => (await api.calls.list({ limit: 8 })).calls,
    refetchInterval: 20_000,
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric
          label="Calls handled"
          value={isLoading ? "—" : (stats?.totalCalls ?? 0)}
          hint={
            stats?.activeCalls ? `${stats.activeCalls} live now` : "none live"
          }
          icon={<Phone className="size-4" />}
        />
        <Metric
          label="Resolved by AI"
          value={isLoading ? "—" : `${stats?.containmentRate ?? 0}%`}
          hint="without a human"
          tone="success"
          icon={<CheckCircle2 className="size-4" />}
        />
        <Metric
          label="Handed over"
          value={isLoading ? "—" : `${stats?.escalatedPercent ?? 0}%`}
          hint="of all calls"
          tone={(stats?.escalatedPercent ?? 0) > 40 ? "warning" : "default"}
          icon={<Headphones className="size-4" />}
        />
        <Metric
          label="Avg call length"
          value={isLoading ? "—" : formatDuration(stats?.avgHandleSeconds ?? 0)}
          icon={<Timer className="size-4" />}
        />
        <Metric
          label="Open tickets"
          value={isLoading ? "—" : (stats?.openTickets ?? 0)}
          hint={
            stats?.inProgressTickets
              ? `${stats.inProgressTickets} in progress`
              : undefined
          }
          icon={<TicketCheck className="size-4" />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <SurfaceCard>
          <CardHeader
            title="Recent calls"
            subtitle="Newest first"
            icon={<Activity className="size-4" />}
            actions={
              <Link
                to="/calls"
                className="interactive inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-primary hover:bg-accent"
              >
                All calls <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {!recent ? (
            <div className="space-y-2 p-5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-9" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<Phone className="size-5" />}
              title="No calls yet"
              description="Place a call from the caller app and it will appear here within seconds."
            />
          ) : (
            <div className="divide-y divide-border">
              {recent.map((call) => (
                <Link
                  key={call.id}
                  to="/calls"
                  className="interactive flex items-center gap-3 px-5 py-3 hover:bg-muted"
                >
                  <span className="w-[124px] shrink-0 font-mono text-[11.5px] text-muted-foreground">
                    {call.caseRef}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {call.callerName ?? "Unidentified caller"}
                    {call.orderId && (
                      <span className="ml-2 font-mono text-[11.5px] font-normal text-muted-foreground">
                        #{call.orderId}
                      </span>
                    )}
                  </span>
                  <StatusBadge status={call.status} />
                  <span className="hidden w-14 shrink-0 text-right text-[11.5px] text-muted-foreground sm:block">
                    {formatRelative(call.startedAt)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard>
          <CardHeader
            title="Waiting for a human"
            subtitle={
              queue?.length ? `${queue.length} in the queue` : "Queue is clear"
            }
            icon={<Headphones className="size-4" />}
            actions={
              <Link
                to="/agent"
                className="interactive inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-primary hover:bg-accent"
              >
                Open <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {!queue ? (
            <div className="space-y-2 p-5">
              {[0, 1].map((i) => (
                <div key={i} className="skeleton h-16" />
              ))}
            </div>
          ) : queue.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="size-5" />}
              title="Nothing waiting"
              description="The AI is handling everything on its own right now."
            />
          ) : (
            <div className="divide-y divide-border">
              {queue.slice(0, 5).map((esc) => (
                <div key={esc.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">
                      {esc.customerName}
                    </span>
                    <PriorityBadge priority={esc.priority} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <ReasonBadge reason={esc.reason} />
                    <ConfidenceBadge
                      score={esc.confidenceOverall}
                      showValue={false}
                    />
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                    {formatRelative(esc.createdAt)}
                    {esc.orderId && ` · order ${esc.orderId}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
