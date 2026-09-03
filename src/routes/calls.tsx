import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bot, Phone, Search, User, X } from "lucide-react";
import { api, formatDuration, formatRelative, titleCase } from "@/lib/api";
import {
  EmptyState,
  SkeletonRows,
  SurfaceCard,
} from "@/components/shared/SurfaceCard";
import {
  ConfidenceBadge,
  LanguageBadge,
  ReasonBadge,
  StatusBadge,
} from "@/components/shared/Badges";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/calls")({ component: CallsPage });

/**
 * Call history.
 *
 * Reads stored calls and their real transcripts. The previous version showed
 * "Showing 1-10 of 245 calls" above whatever the API returned, and every detail
 * dialog rendered the same four invented messages regardless of which call was
 * clicked.
 */
function CallsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["calls", status, search],
    queryFn: () =>
      api.calls.list({ status, search: search || undefined, limit: 100 }),
    refetchInterval: 20_000,
  });

  const calls = data?.calls ?? [];

  return (
    <div className="space-y-4">
      <SurfaceCard>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Case, caller or order…"
                className="h-8 w-60 pl-8 text-[12.5px]"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 w-[130px] text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all", "active", "completed", "escalated", "abandoned"].map(
                  (s) => (
                    <SelectItem key={s} value={s} className="text-[12.5px]">
                      {s === "all" ? "All statuses" : titleCase(s)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <span className="text-[12px] text-muted-foreground">
            {data ? `${calls.length} of ${data.total}` : ""}
          </span>
        </div>

        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-left">
            <thead className="sticky-head">
              <tr>
                {[
                  "Case",
                  "Caller",
                  "Order",
                  "Language",
                  "Intent",
                  "Status",
                  "Length",
                  "Resolved by",
                  "When",
                ].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonRows rows={6} columns={9} />
              ) : calls.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      icon={<Phone className="size-5" />}
                      title={
                        search || status !== "all"
                          ? "Nothing matches"
                          : "No calls recorded"
                      }
                      description={
                        search || status !== "all"
                          ? "Try a different filter."
                          : "Calls appear here as soon as one is placed from the caller app."
                      }
                    />
                  </td>
                </tr>
              ) : (
                calls.map((call) => (
                  <tr
                    key={call.id}
                    onClick={() => setSelected(call.id)}
                    className="interactive cursor-pointer border-b border-border hover:bg-muted"
                  >
                    <td className="whitespace-nowrap px-4 py-[var(--row-py,0.8125rem)] font-mono text-[11.5px] text-muted-foreground">
                      {call.caseRef}
                    </td>
                    <td className="whitespace-nowrap px-4 py-[var(--row-py,0.8125rem)] text-[13px] font-medium">
                      {call.callerName ?? (
                        <span className="text-muted-foreground">
                          Unidentified
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-[var(--row-py,0.8125rem)] font-mono text-[12px] text-muted-foreground">
                      {call.orderId ?? "—"}
                    </td>
                    <td className="px-4 py-[var(--row-py,0.8125rem)]">
                      <LanguageBadge
                        language={call.language}
                        codeSwitched={call.codeSwitched}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-[var(--row-py,0.8125rem)] text-[12.5px] text-muted-foreground">
                      {call.intent ? titleCase(call.intent) : "—"}
                    </td>
                    <td className="px-4 py-[var(--row-py,0.8125rem)]">
                      <StatusBadge status={call.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-[var(--row-py,0.8125rem)] text-[12.5px] text-muted-foreground">
                      {formatDuration(call.durationSeconds)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-[var(--row-py,0.8125rem)] text-[12.5px]">
                      {call.resolvedBy === "ai" ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <Bot className="size-3.5" /> AI
                        </span>
                      ) : call.resolvedBy === "human" ? (
                        <span className="inline-flex items-center gap-1 text-info">
                          <User className="size-3.5" /> Human
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-[var(--row-py,0.8125rem)] text-[12px] text-muted-foreground">
                      {formatRelative(call.startedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      <CallDetail callId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function CallDetail({
  callId,
  onClose,
}: {
  callId: string | null;
  onClose: () => void;
}) {
  const { data } = useQuery({
    queryKey: ["call", callId],
    queryFn: () => api.calls.get(callId!),
    enabled: Boolean(callId),
  });

  return (
    <Dialog open={Boolean(callId)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col p-0">
        <DialogHeader className="flex-row items-start justify-between border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              {data?.call.callerName ?? "Call detail"}
              {data && <StatusBadge status={data.call.status} />}
            </DialogTitle>
            {data && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted-foreground">
                <span className="font-mono">{data.call.caseRef}</span>
                {data.call.orderId && <span>order {data.call.orderId}</span>}
                <span>{formatDuration(data.call.durationSeconds)}</span>
                <span>{data.call.turnCount} turns</span>
                {data.call.humanRequestCount > 0 && (
                  <span>asked for a human {data.call.humanRequestCount}×</span>
                )}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="interactive rounded-md p-1 hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </DialogHeader>

        {data && (data.call.escalated || data.call.confidenceOverall > 0) && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-5 py-2.5">
            {data.call.escalationReason && (
              <ReasonBadge reason={data.call.escalationReason} />
            )}
            <ConfidenceBadge score={data.call.confidenceOverall} />
          </div>
        )}

        <div className="scroll-thin flex-1 space-y-2.5 overflow-y-auto p-5">
          {!data ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-11" />
              ))}
            </div>
          ) : data.transcript.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-muted-foreground">
              No transcript recorded for this call.
            </p>
          ) : (
            data.transcript.map((line) => (
              <div
                key={line.id}
                className={`flex flex-col gap-1 ${line.speaker === "caller" ? "items-end" : "items-start"}`}
              >
                <span className="px-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  {line.speaker === "caller"
                    ? "Caller"
                    : line.speaker === "agent"
                      ? "Meera"
                      : titleCase(line.speaker)}
                </span>
                <div
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                    line.speaker === "caller"
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm border border-border bg-card"
                  }`}
                >
                  {line.text}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
