import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Headphones,
  Loader2,
  PhoneIncoming,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  formatInr,
  formatRelative,
  titleCase,
  type Escalation,
} from "@/lib/api";
import {
  CardHeader,
  EmptyState,
  SurfaceCard,
} from "@/components/shared/SurfaceCard";
import {
  ConfidenceBadge,
  LanguageBadge,
  PriorityBadge,
  ReasonBadge,
  StatusBadge,
} from "@/components/shared/Badges";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/agent")({ component: HandoverQueue });

/**
 * Handover queue.
 *
 * The point of this screen is the verification report: requirement 6.2 asks the
 * AI to verify a refund or return "with a proper reason verification from your
 * end" before involving a person, so what an agent sees here is a checked file —
 * order confirmed, identity matched, policy findings — not a raw request.
 */
function HandoverQueue() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const {
    data: queue,
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["escalations", "all"],
    queryFn: async () => (await api.escalations.list()).escalations,
    refetchInterval: 12_000,
  });

  const selected = queue?.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <SurfaceCard className="flex max-h-[calc(100vh-7rem)] flex-col">
        <CardHeader
          title="Handover queue"
          subtitle={
            queue
              ? `${queue.filter((e) => e.status === "pending").length} waiting`
              : undefined
          }
          icon={<Headphones className="size-4" />}
          actions={
            <button
              onClick={() => refetch()}
              className="interactive rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RefreshCw
                className={`size-3.5 ${isFetching ? "animate-spin" : ""}`}
              />
            </button>
          }
        />

        <div className="scroll-thin flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-20" />
              ))}
            </div>
          ) : !queue || queue.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="size-5" />}
              title="Queue is clear"
              description="Nothing has needed a person yet. The AI hands over only when a caller insists, for a refund or return, or to cancel something already out for delivery."
            />
          ) : (
            <div className="divide-y divide-border">
              {queue.map((esc) => (
                <button
                  key={esc.id}
                  onClick={() => setSelectedId(esc.id)}
                  className={`interactive block w-full px-4 py-3 text-left hover:bg-muted ${
                    selectedId === esc.id ? "bg-accent" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold">
                      {esc.customerName}
                    </span>
                    <PriorityBadge priority={esc.priority} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <ReasonBadge reason={esc.reason} />
                    <StatusBadge status={esc.status} />
                  </div>
                  <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                    {esc.caseRef}
                    {esc.orderId && ` · ${esc.orderId}`} ·{" "}
                    {formatRelative(esc.createdAt)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </SurfaceCard>

      {selected ? (
        <EscalationDetail
          escalation={selected}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ["escalations"] });
            void queryClient.invalidateQueries({ queryKey: ["tickets"] });
          }}
        />
      ) : (
        <SurfaceCard className="grid place-items-center">
          <EmptyState
            icon={<Headphones className="size-5" />}
            title="Select a case"
            description="Pick a handover to see what the AI verified, what policy says, and the full transcript before you take the call."
          />
        </SurfaceCard>
      )}
    </div>
  );
}

function EscalationDetail({
  escalation,
  onChanged,
}: {
  escalation: Escalation;
  onChanged: () => void;
}) {
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState<"accept" | "resolve" | null>(null);

  const { data } = useQuery({
    queryKey: ["escalation", escalation.id],
    queryFn: () => api.escalations.get(escalation.id),
  });

  const report = escalation.report;

  const accept = async () => {
    setBusy("accept");
    try {
      await api.escalations.accept(escalation.id);
      onChanged();
      toast.success("Case accepted and assigned to you");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not accept");
    } finally {
      setBusy(null);
    }
  };

  const resolve = async () => {
    if (!resolution.trim()) {
      toast.error("Describe how you resolved it first");
      return;
    }
    setBusy("resolve");
    try {
      await api.escalations.resolve(escalation.id, resolution.trim());
      onChanged();
      setResolution("");
      toast.success("Case resolved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resolve");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SurfaceCard className="flex max-h-[calc(100vh-7rem)] flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-[16px] font-semibold">
            {escalation.customerName}
            <StatusBadge status={escalation.status} />
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted-foreground">
            <span className="font-mono">{escalation.caseRef}</span>
            <span>{formatRelative(escalation.createdAt)}</span>
            {escalation.assigneeName && (
              <span>with {escalation.assigneeName}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <ReasonBadge reason={escalation.reason} />
          <PriorityBadge priority={escalation.priority} />
          <LanguageBadge language={escalation.language} />
        </div>
      </div>

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
        <div className="rounded-lg border border-warning/20 bg-warning-muted px-3.5 py-2.5">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-warning">
            Why this reached you
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-warning">
            {escalation.detail}
          </p>
        </div>

        <div>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Bot className="size-3.5" /> AI summary
          </h3>
          <p className="rounded-lg border border-border bg-card p-3 text-[12.5px] leading-relaxed">
            {escalation.aiSummary || "No summary available."}
          </p>
        </div>

        {report && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-3.5">
              <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                <CheckCircle2 className="size-3.5" /> Verified by the AI
              </h3>
              <dl className="space-y-1.5 text-[12.5px]">
                <Row
                  label="Order"
                  value={report.orderId ?? "—"}
                  ok={report.orderConfirmed}
                />
                <Row
                  label="Name on order"
                  value={report.ordererName ?? "—"}
                  ok={report.identityConfirmed}
                />
                {report.orderStatus && (
                  <Row
                    label="Status"
                    value={titleCase(report.orderStatus)}
                    ok
                  />
                )}
                {report.orderTotalInr !== null && (
                  <Row
                    label="Value"
                    value={formatInr(report.orderTotalInr)}
                    ok
                  />
                )}
              </dl>
              <div className="mt-2.5 border-t border-border pt-2.5">
                <ConfidenceBadge score={escalation.confidenceOverall} />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-3.5">
              <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                <AlertTriangle className="size-3.5" /> Still open
              </h3>
              {report.outstanding.length === 0 ? (
                <p className="text-[12.5px] text-success">
                  Nothing — the file is complete.
                </p>
              ) : (
                <ul className="space-y-1 text-[12.5px] text-muted-foreground">
                  {report.outstanding.map((item) => (
                    <li key={item} className="flex gap-1.5">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-warning" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {report.statedReason && (
                <div className="mt-2.5 border-t border-border pt-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Caller's reason
                  </p>
                  <p className="mt-0.5 text-[12.5px] italic">
                    “{report.statedReason}”
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {report && report.policyFindings.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
              Policy findings
            </h3>
            <ul className="space-y-1 rounded-lg border border-border bg-card p-3 text-[12.5px]">
              {report.policyFindings.map((finding) => (
                <li key={finding} className="flex gap-2">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-info" />
                  {finding}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Transcript
          </h3>
          <div className="space-y-2 rounded-lg border border-border bg-card p-3">
            {!data ? (
              <div className="skeleton h-16" />
            ) : data.transcript.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                No transcript recorded.
              </p>
            ) : (
              data.transcript.map((line) => (
                <div
                  key={line.id}
                  className={`flex flex-col gap-0.5 ${line.speaker === "caller" ? "items-end" : "items-start"}`}
                >
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {line.speaker === "caller" ? "Caller" : "Meera"}
                  </span>
                  <div
                    className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12.5px] leading-relaxed ${
                      line.speaker === "caller"
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-surface-raised"
                    }`}
                  >
                    {line.text}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
        <Textarea
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          rows={2}
          placeholder="How did you resolve it? (required to close)"
          className="min-w-[200px] flex-1 resize-none text-[12.5px]"
        />
        {escalation.status === "pending" && (
          <Button
            onClick={accept}
            disabled={busy !== null}
            className="h-9 gap-1.5"
          >
            {busy === "accept" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <PhoneIncoming className="size-3.5" />
            )}
            Accept case
          </Button>
        )}
        {escalation.status !== "resolved" && (
          <Button
            onClick={resolve}
            disabled={busy !== null || !resolution.trim()}
            variant={escalation.status === "pending" ? "outline" : "default"}
            className="h-9 gap-1.5"
          >
            {busy === "resolve" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            Resolve
          </Button>
        )}
      </div>
    </SurfaceCard>
  );
}

function Row({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1.5 font-medium">
        {value}
        {ok ? (
          <CheckCircle2 className="size-3.5 text-success" />
        ) : (
          <AlertTriangle className="size-3.5 text-warning" />
        )}
      </dd>
    </div>
  );
}
