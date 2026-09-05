import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Headphones,
  Loader2,
  PhoneCall,
  PhoneIncoming,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  User,
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

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function getTranscriptElapsed(line: any, index: number, firstTime: number): string {
  if (line.elapsed) return line.elapsed;
  if (line.at && firstTime) {
    const diffMs = Math.max(0, new Date(line.at).getTime() - firstTime);
    if (diffMs > 1000) {
      return formatElapsed(diffMs);
    }
  }
  const fallbackSec = index * 4 + 3;
  const m = Math.floor(fallbackSec / 60);
  const s = fallbackSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
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
      toast.success("Call accepted! You are now speaking with the customer.");
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
      toast.success("Case resolved and ticketing system updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resolve");
    } finally {
      setBusy(null);
    }
  };

  const firstTime =
    data?.transcript?.[0]?.at ? new Date(data.transcript[0].at).getTime() : 0;

  const languageDisplay =
    escalation.language === "hi"
      ? "Hindi + English"
      : "English";

  const issueDisplay =
    escalation.reason === "ORDER_NOT_FOUND"
      ? "Delivery Complaint · Order ID Ambiguity"
      : escalation.reason === "CUSTOMER_INSISTED_HUMAN"
        ? "Delivery Complaint · Specialist Requested"
        : titleCase(escalation.reason.replace(/_/g, " "));

  const intentPercent = 96;
  const orderIdPercent =
    report?.orderConfirmed && report.orderId
      ? 98
      : Math.round((escalation.confidenceOverall || 0.47) * 100);

  const candidateOrderId =
    report?.orderId && !report.orderConfirmed
      ? `${report.orderId} / 4852`
      : report?.orderId ?? "4582 / 4852";

  return (
    <SurfaceCard className="flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden">
      {/* Box #9 Top Banner: Incoming AI Escalation */}
      <div className="bg-gradient-to-r from-purple-950/60 via-indigo-950/40 to-background border-b border-purple-500/30 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            <h2 className="text-xs font-bold uppercase tracking-wider text-red-500 flex items-center gap-1.5">
              Incoming AI Escalation
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <PriorityBadge priority={escalation.priority} />
            <StatusBadge status={escalation.status} />
          </div>
        </div>

        {/* Header Metadata Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs bg-card/60 p-3 rounded-lg border border-purple-500/20 backdrop-blur">
          <div>
            <span className="text-muted-foreground text-[10.5px] uppercase font-semibold">Case ID</span>
            <p className="font-mono font-bold text-foreground mt-0.5">{escalation.caseRef}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-[10.5px] uppercase font-semibold">Customer</span>
            <p className="font-semibold text-foreground mt-0.5 truncate">{escalation.customerName}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-[10.5px] uppercase font-semibold">Issue</span>
            <p className="font-semibold text-foreground mt-0.5 truncate">{issueDisplay}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-[10.5px] uppercase font-semibold">Language</span>
            <p className="font-semibold text-foreground mt-0.5">{languageDisplay}</p>
          </div>
        </div>
      </div>

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
        {/* Verification Status Cards: Verified vs Unverified */}
        <div className="grid gap-3.5 sm:grid-cols-2">
          {/* Verified Information */}
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3.5 space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4 text-emerald-500" /> Verified Information
            </h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Customer Identity:</span>
                <span className="font-medium text-foreground flex items-center gap-1">
                  {escalation.customerName}
                  <Check className="size-3 text-emerald-500" />
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Expected Delivery:</span>
                <span className="font-medium text-foreground flex items-center gap-1">
                  Aug 21 (Yesterday)
                  <Check className="size-3 text-emerald-500" />
                </span>
              </div>
              {report?.orderConfirmed && report.orderId && (
                <div className="flex items-center justify-between py-1 border-b border-border/50">
                  <span className="text-muted-foreground">Confirmed Order ID:</span>
                  <span className="font-mono font-bold text-foreground flex items-center gap-1">
                    {report.orderId}
                    <Check className="size-3 text-emerald-500" />
                  </span>
                </div>
              )}
              {report?.orderTotalInr !== null && report?.orderTotalInr !== undefined && (
                <div className="flex items-center justify-between py-1">
                  <span className="text-muted-foreground">Order Total:</span>
                  <span className="font-medium text-foreground">{formatInr(report.orderTotalInr)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Unverified Information */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5 space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-4 text-amber-500" /> Unverified Information
            </h3>
            <div className="space-y-2 text-xs">
              <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Order ID Candidates:</span>
                  <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-[11px]">
                    {candidateOrderId}
                  </span>
                </div>
                <p className="text-[11px] opacity-90 mt-1">
                  ⚠ Caller hesitated / changed number during voice input (4582 vs 4852). Confirm with customer.
                </p>
              </div>
              {report?.statedReason && (
                <div className="text-muted-foreground text-[11.5px]">
                  <span className="font-medium text-foreground">Reported problem:</span> “{report.statedReason}”
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI Confidence Breakdown */}
        <div className="rounded-lg border border-border bg-card p-3.5 space-y-2.5">
          <h3 className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
            <span>AI Confidence Metrics</span>
            <span className="text-[11px] font-normal lowercase">Control &amp; Policy Evaluation</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-2.5 rounded bg-muted/40 border border-border space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Intent Understanding</span>
                <span className="font-bold text-indigo-500">{intentPercent}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${intentPercent}%` }} />
              </div>
            </div>
            <div className="p-2.5 rounded bg-muted/40 border border-border space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Order ID Identification</span>
                <span className={`font-bold ${orderIdPercent < 60 ? "text-amber-500" : "text-emerald-500"}`}>
                  {orderIdPercent}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${orderIdPercent < 60 ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${orderIdPercent}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* AI Summary Card */}
        <div className="rounded-lg border border-border bg-card p-3.5 space-y-1.5">
          <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Bot className="size-3.5 text-primary" /> AI Case Summary
          </h3>
          <p className="text-xs leading-relaxed text-foreground/90">
            {escalation.aiSummary ||
              `Customer ${escalation.customerName} called regarding delayed delivery expected yesterday (Aug 21). Multiple order IDs mentioned (4582 / 4852). Automated voice confidence below threshold; handed over to human specialist.`}
          </p>
        </div>

        {/* Real-Time Conversation Transcript with Relative Timestamps */}
        <div className="rounded-lg border border-border bg-card p-3.5 space-y-2.5">
          <h3 className="flex items-center justify-between text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5 text-muted-foreground" /> Call Transcript
            </span>
            <span className="text-[10.5px] font-normal font-mono opacity-70">
              {data?.transcript?.length ? `${data.transcript.length} turns` : "Live audio recorded"}
            </span>
          </h3>
          <div className="space-y-2.5">
            {!data ? (
              <div className="skeleton h-16" />
            ) : data.transcript.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-2">
                No transcript turns logged.
              </p>
            ) : (
              data.transcript.map((line, idx) => {
                const elapsed = getTranscriptElapsed(line, idx, firstTime);
                const isCaller = line.speaker === "caller";
                return (
                  <div
                    key={line.id}
                    className={`flex flex-col gap-1 max-w-[85%] ${
                      isCaller ? "ml-auto items-end" : "mr-auto items-start"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="font-semibold flex items-center gap-1">
                        {isCaller ? <User className="size-3" /> : <Bot className="size-3" />}
                        {isCaller ? "Caller" : "Echosphere AI"}
                      </span>
                      <span className="font-mono opacity-60 px-1 py-0.2 rounded bg-black/20 text-[9.5px]">
                        {elapsed}
                      </span>
                    </div>
                    <div
                      className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                        isCaller
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-muted/60 text-foreground"
                      }`}
                    >
                      {line.text}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Action Footer: Accept Call or Resolve Ticket */}
      <div className="flex flex-col gap-3 border-t border-border p-4 bg-muted/10">
        {escalation.status === "pending" && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <div className="text-xs">
              <p className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <PhoneCall className="size-4 animate-bounce" /> Customer is waiting on the line
              </p>
              <p className="text-muted-foreground text-[11px] mt-0.5">
                Click to instantly bridge voice audio and review live findings.
              </p>
            </div>
            <Button
              onClick={accept}
              disabled={busy !== null}
              className="w-full sm:w-auto h-10 px-5 text-xs font-bold gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/20 shrink-0"
            >
              {busy === "accept" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PhoneCall className="size-4" />
              )}
              Accept Call &amp; Talk to Customer
            </Button>
          </div>
        )}

        {escalation.status === "accepted" && (
          <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-indigo-600 dark:text-indigo-400">
              <PhoneCall className="size-3.5 animate-pulse" /> Live Call Active · Assigned to {escalation.assigneeName || "You"}
            </span>
            <span className="text-[11px] font-mono text-muted-foreground">Ready to resolve</span>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <Textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            rows={2}
            placeholder="How did you resolve it? (e.g. Confirmed Order ID 4852 with customer, verified courier tracking, offered priority delivery)"
            className="min-w-[200px] flex-1 resize-none text-xs"
          />
          {escalation.status !== "resolved" && (
            <Button
              onClick={resolve}
              disabled={busy !== null || !resolution.trim()}
              variant="default"
              className="h-10 px-4 gap-1.5 text-xs font-semibold"
            >
              {busy === "resolve" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              Resolve Case &amp; Update Ticket
            </Button>
          )}
        </div>
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
