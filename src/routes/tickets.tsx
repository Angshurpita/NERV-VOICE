import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Headphones,
  Loader2,
  MessageSquarePlus,
  Play,
  Plus,
  Search,
  TicketCheck,
  Timer,
  UserCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  api,
  formatRelative,
  titleCase,
  type Ticket,
  type TicketEvent,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/api";
import {
  CardHeader,
  EmptyState,
  Metric,
  SkeletonRows,
  SurfaceCard,
} from "@/components/shared/SurfaceCard";
import { PriorityBadge, StatusBadge } from "@/components/shared/Badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { Avatar } from "@/components/layout/AppLayout";

export const Route = createFileRoute("/tickets")({ component: TicketsPage });

const TABS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting_customer", label: "Waiting" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const STATUS_OPTIONS: TicketStatus[] = [
  "open",
  "in_progress",
  "waiting_customer",
  "resolved",
  "closed",
];
const PRIORITY_OPTIONS: TicketPriority[] = ["low", "medium", "high", "urgent"];

/**
 * Tickets — requirement 3.
 *
 * The previous page had a status dropdown, an assignee dropdown and an "Add
 * Note" button, none of which were wired to anything, plus four hardcoded KPI
 * numbers. Everything here posts to the API, and the workflow rules it enforces
 * (legal transitions, a resolution note before resolving) live server-side, so
 * the UI surfaces the rejection rather than pretending it succeeded.
 */
function TicketsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["tickets", tab, search],
    queryFn: () =>
      api.tickets.list({
        status: tab === "all" ? undefined : tab,
        search: search || undefined,
      }),
    refetchInterval: 25_000,
  });

  const { data: assignees } = useQuery({
    queryKey: ["assignees"],
    queryFn: async () => (await api.tickets.assignees()).assignees,
    staleTime: 300_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    void queryClient.invalidateQueries({ queryKey: ["analytics"] });
  };

  const change = async (
    id: string,
    patch: Parameters<typeof api.tickets.update>[1],
  ) => {
    try {
      await api.tickets.update(id, patch);
      invalidate();
      toast.success("Ticket updated");
    } catch (e) {
      // 422 carries the workflow rule that blocked it — worth showing verbatim.
      toast.error(
        e instanceof Error ? e.message : "Could not update the ticket",
      );
    }
  };

  const tickets = data?.tickets ?? [];
  const stats = data?.stats;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric
          label="Open"
          value={stats?.open ?? "—"}
          icon={<AlertCircle className="size-4" />}
          tone="info"
        />
        <Metric
          label="In progress"
          value={stats?.inProgress ?? "—"}
          icon={<Clock className="size-4" />}
        />
        <Metric
          label="Resolved today"
          value={stats?.resolvedToday ?? "—"}
          tone="success"
          icon={<CheckCircle2 className="size-4" />}
        />
        <Metric
          label="Avg resolution"
          value={
            stats
              ? stats.avgResolutionHours > 0
                ? `${stats.avgResolutionHours}h`
                : "—"
              : "—"
          }
          icon={<Timer className="size-4" />}
        />
        <Metric
          label="Past SLA"
          value={stats?.breachingSla ?? "—"}
          tone={(stats?.breachingSla ?? 0) > 0 ? "destructive" : "default"}
          icon={<AlertCircle className="size-4" />}
        />
      </div>

      <SurfaceCard>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={`interactive rounded-md px-2.5 py-1 text-[12.5px] font-medium ${
                  tab === t.value
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search case, customer, order…"
                className="h-8 w-56 pl-8 text-[12.5px]"
              />
            </div>
            <Button
              size="sm"
              onClick={() => setCreating(true)}
              className="h-8 gap-1.5 text-[12.5px]"
            >
              <Plus className="size-3.5" /> New ticket
            </Button>
          </div>
        </div>

        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-left">
            <thead className="sticky-head">
              <tr>
                {[
                  "Case",
                  "Customer",
                  "Subject",
                  "Priority",
                  "Status",
                  "Assignee",
                  "Updated",
                ].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonRows rows={5} columns={7} />
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={<TicketCheck className="size-5" />}
                      title={
                        search || tab !== "all"
                          ? "Nothing matches"
                          : "No tickets yet"
                      }
                      description={
                        search || tab !== "all"
                          ? "Try a different filter or search term."
                          : "A ticket is raised automatically whenever a call is handed to a human."
                      }
                    />
                  </td>
                </tr>
              ) : (
                tickets.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    expanded={openRow === ticket.id}
                    onToggle={() =>
                      setOpenRow(openRow === ticket.id ? null : ticket.id)
                    }
                    assignees={assignees ?? []}
                    onChange={change}
                    onNoteAdded={invalidate}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {tickets.length > 0 && (
          <div className="border-t border-border px-5 py-2.5 text-[12px] text-muted-foreground">
            Showing {tickets.length} of {data?.total ?? tickets.length}
          </div>
        )}
      </SurfaceCard>

      <CreateTicketDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={invalidate}
      />
    </div>
  );
}

function TicketRow({
  ticket,
  expanded,
  onToggle,
  assignees,
  onChange,
  onNoteAdded,
}: {
  ticket: Ticket;
  expanded: boolean;
  onToggle: () => void;
  assignees: Array<{ id: string; name: string; avatarColor: string }>;
  onChange: (
    id: string,
    patch: Parameters<typeof api.tickets.update>[1],
  ) => Promise<void>;
  onNoteAdded: () => void;
}) {
  const overdue =
    ticket.slaDueAt &&
    !ticket.resolvedAt &&
    !ticket.closedAt &&
    new Date(ticket.slaDueAt) < new Date();

  return (
    <>
      <tr
        onClick={onToggle}
        className={`interactive cursor-pointer border-b border-border hover:bg-muted ${expanded ? "bg-muted" : ""}`}
      >
        <td className="whitespace-nowrap px-5 py-[var(--row-py,0.8125rem)] font-mono text-[11.5px] text-muted-foreground">
          {ticket.caseRef}
        </td>
        <td className="whitespace-nowrap px-5 py-[var(--row-py,0.8125rem)] text-[13px] font-medium">
          {ticket.customerName}
        </td>
        <td className="max-w-[280px] truncate px-5 py-[var(--row-py,0.8125rem)] text-[13px] text-muted-foreground">
          {ticket.subject}
        </td>
        <td className="px-5 py-[var(--row-py,0.8125rem)]">
          <PriorityBadge priority={ticket.priority} />
        </td>
        <td className="px-5 py-[var(--row-py,0.8125rem)]">
          <StatusBadge status={ticket.status} />
        </td>
        <td className="whitespace-nowrap px-5 py-[var(--row-py,0.8125rem)] text-[12.5px]">
          {ticket.assigneeName ? (
            <span className="text-foreground">{ticket.assigneeName}</span>
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          )}
        </td>
        <td className="whitespace-nowrap px-5 py-[var(--row-py,0.8125rem)] text-[12px] text-muted-foreground">
          {formatRelative(ticket.updatedAt)}
          {overdue && (
            <span className="ml-1.5 font-medium text-destructive">overdue</span>
          )}
        </td>
      </tr>

      {expanded && (
        <tr>
          <td
            colSpan={7}
            className="border-b border-border bg-surface-raised p-0"
          >
            <TicketDetail
              ticket={ticket}
              assignees={assignees}
              onChange={onChange}
              onNoteAdded={onNoteAdded}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function TicketDetail({
  ticket,
  assignees,
  onChange,
  onNoteAdded,
}: {
  ticket: Ticket;
  assignees: Array<{ id: string; name: string; avatarColor: string }>;
  onChange: (
    id: string,
    patch: Parameters<typeof api.tickets.update>[1],
  ) => Promise<void>;
  onNoteAdded: () => void;
}) {
  const { user } = useAuth();
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState(ticket.resolution ?? "");
  const [posting, setPosting] = useState(false);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [resolving, setResolving] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const { data: detail } = useQuery({
    queryKey: ["ticket", ticket.id],
    queryFn: () => api.tickets.get(ticket.id),
  });

  const addNote = async () => {
    if (!note.trim()) return;
    setPosting(true);
    try {
      await api.tickets.addNote(ticket.id, note.trim());
      setNote("");
      onNoteAdded();
      toast.success("Note added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the note");
    } finally {
      setPosting(false);
    }
  };

  const handleConfirmResolve = async () => {
    if (!resolveNote.trim()) {
      toast.error("Please enter a resolution note before resolving.");
      return;
    }
    setResolving(true);
    try {
      await onChange(ticket.id, {
        status: "resolved",
        resolution: resolveNote.trim(),
      });
      setResolution(resolveNote.trim());
      setResolveDialogOpen(false);
      toast.success("Ticket resolved successfully");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resolve ticket");
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        {/* Quick action bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-muted/30 p-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">
            Actions:
          </span>
          {user && ticket.assigneeId !== user.id && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 bg-background shadow-xs hover:bg-muted"
              onClick={() => onChange(ticket.id, { assigneeId: user.id })}
            >
              <UserCheck className="size-3 text-primary" /> Assign to me
            </Button>
          )}
          {ticket.status === "open" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 bg-background shadow-xs hover:bg-muted"
              onClick={() =>
                onChange(ticket.id, {
                  status: "in_progress",
                  assigneeId: ticket.assigneeId || user?.id || null,
                })
              }
            >
              <Play className="size-3 text-amber-500" /> Start working
            </Button>
          )}
          {ticket.status !== "resolved" && ticket.status !== "closed" && (
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-xs"
              onClick={() => {
                setResolveNote(resolution);
                setResolveDialogOpen(true);
              }}
            >
              <CheckCircle2 className="size-3" /> Resolve ticket
            </Button>
          )}
          {ticket.status === "resolved" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 bg-background shadow-xs hover:bg-muted"
              onClick={() => onChange(ticket.id, { status: "closed" })}
            >
              <Check className="size-3 text-muted-foreground" /> Close ticket
            </Button>
          )}
        </div>

        {ticket.description && (
          <div>
            <h4 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
              What the AI recorded
            </h4>
            <p className="whitespace-pre-line rounded-lg border border-border bg-card p-3 text-[12.5px] leading-relaxed shadow-2xs">
              {ticket.description}
            </p>
          </div>
        )}

        {/* Linked transcript */}
        {detail?.transcript && detail.transcript.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-3 shadow-2xs">
            <button
              type="button"
              onClick={() => setShowTranscript(!showTranscript)}
              className="flex w-full items-center justify-between text-left text-xs font-medium text-foreground hover:opacity-80"
            >
              <span className="flex items-center gap-1.5 font-semibold">
                <Headphones className="size-3.5 text-primary" />
                Call Voice Transcript ({detail.transcript.length} turns)
              </span>
              <span className="text-[11px] font-medium text-primary">
                {showTranscript ? "Hide transcript" : "Show transcript"}
              </span>
            </button>
            {showTranscript && (
              <div className="mt-3 max-h-60 space-y-2 overflow-y-auto border-t border-border/60 pt-3 text-xs">
                {detail.transcript.map((t) => (
                  <div key={t.id} className="flex gap-2">
                    <span
                      className={`w-14 shrink-0 text-[11px] font-bold uppercase tracking-wider ${
                        t.speaker === "agent"
                          ? "text-primary"
                          : "text-foreground"
                      }`}
                    >
                      {t.speaker}:
                    </span>
                    <span className="text-muted-foreground leading-relaxed">
                      {t.text}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            History &amp; Audit Trail
          </h4>
          <ol className="space-y-2.5">
            {(detail?.events ?? []).map((event) => (
              <TimelineEntry key={event.id} event={event} />
            ))}
            {detail && detail.events.length === 0 && (
              <li className="text-[12.5px] text-muted-foreground">
                Nothing recorded yet.
              </li>
            )}
          </ol>
        </div>

        <div className="flex gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && addNote()}
            placeholder="Add an internal note…"
            className="h-9 text-[12.5px]"
          />
          <Button
            onClick={addNote}
            disabled={!note.trim() || posting}
            size="sm"
            className="h-9 gap-1.5"
          >
            {posting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <MessageSquarePlus className="size-3.5" />
            )}
            Add Note
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <Field label="Status">
          <Select
            value={ticket.status}
            onValueChange={(v) => {
              if (v === "resolved" && !resolution.trim()) {
                setResolveNote("");
                setResolveDialogOpen(true);
                return;
              }
              void onChange(ticket.id, { status: v as TicketStatus });
            }}
          >
            <SelectTrigger className="h-8 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s} className="text-[12.5px]">
                  {titleCase(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Priority">
          <Select
            value={ticket.priority}
            onValueChange={(v) =>
              onChange(ticket.id, { priority: v as TicketPriority })
            }
          >
            <SelectTrigger className="h-8 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((p) => (
                <SelectItem key={p} value={p} className="text-[12.5px]">
                  {titleCase(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Assignee">
          <Select
            value={ticket.assigneeId ?? "unassigned"}
            onValueChange={(v) =>
              onChange(ticket.id, { assigneeId: v === "unassigned" ? null : v })
            }
          >
            <SelectTrigger className="h-8 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned" className="text-[12.5px]">
                Unassigned
              </SelectItem>
              {assignees.map((a) => (
                <SelectItem key={a.id} value={a.id} className="text-[12.5px]">
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Resolution"
          hint="Required before a ticket can be marked resolved"
        >
          <Textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            onBlur={() => {
              if (resolution !== (ticket.resolution ?? "")) {
                void onChange(ticket.id, { resolution: resolution || null });
              }
            }}
            rows={3}
            placeholder="Document actions taken to resolve…"
            className="resize-none text-[12.5px]"
          />
        </Field>

        {ticket.orderId && (
          <div className="rounded-lg border border-border bg-card p-3 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Linked Order</span>
              {detail?.order && (
                <span className="font-mono text-primary font-bold">
                  ₹{detail.order.total.toLocaleString("en-IN")}
                </span>
              )}
            </div>
            <p className="mt-1 font-mono text-[13px] font-semibold text-foreground">
              #{ticket.orderId}
            </p>
            {detail?.order && (
              <div className="mt-1.5 border-t border-border/50 pt-1.5 text-[11.5px] text-muted-foreground">
                <p className="line-clamp-2">
                  {detail.order.items
                    .map((i: any) => `${i.quantity}x ${i.name}`)
                    .join(", ")}
                </p>
                <p className="mt-1 font-medium text-foreground">
                  Status:{" "}
                  <span className="capitalize">
                    {detail.order.status.toLowerCase().replace(/_/g, " ")}
                  </span>
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Resolve Dialog */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <CheckCircle2 className="size-4 text-emerald-600" />
              Resolve Case {ticket.caseRef}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Please enter the actions taken and notes for resolving this
              ticket. This will be recorded permanently in the case history.
            </p>
            <Textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="e.g. Approved replacement pickup scheduled for tomorrow. Customer notified via SMS."
              rows={4}
              className="resize-none text-xs"
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setResolveDialogOpen(false)}
                disabled={resolving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                onClick={handleConfirmResolve}
                disabled={resolving || !resolveNote.trim()}
              >
                {resolving ? (
                  <Loader2 className="size-3.5 animate-spin mr-1" />
                ) : (
                  <CheckCircle2 className="size-3.5 mr-1" />
                )}
                Confirm &amp; Resolve
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TimelineEntry({ event }: { event: TicketEvent }) {
  const label = () => {
    switch (event.kind) {
      case "created":
        return "opened the ticket";
      case "status_changed":
        return `moved it from ${titleCase(event.fromValue ?? "")} to ${titleCase(event.toValue ?? "")}`;
      case "priority_changed":
        return `changed priority from ${event.fromValue} to ${event.toValue}`;
      case "assigned":
        return `assigned it to ${event.toValue}`;
      case "note":
        return "added a note";
      case "resolved":
        return "resolved it";
      case "reopened":
        return "reopened it";
      case "escalated":
        return `escalated it — ${event.toValue}`;
    }
  };

  return (
    <li className="flex gap-2.5">
      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px]">
          <span className="font-medium">{event.actorName}</span>{" "}
          <span className="text-muted-foreground">{label()}</span>{" "}
          <span className="text-[11.5px] text-muted-foreground">
            · {formatRelative(event.at)}
          </span>
        </p>
        {event.body && (
          <p className="mt-1 whitespace-pre-line rounded-md border border-border bg-card px-2.5 py-1.5 text-[12.5px] leading-relaxed">
            {event.body}
          </p>
        )}
      </div>
    </li>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11.5px] font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[10.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CreateTicketDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [orderId, setOrderId] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.tickets.create({
        customerName: customerName.trim(),
        subject: subject.trim(),
        description,
        priority,
        orderId: orderId.trim() || null,
      });
      onCreated();
      toast.success("Ticket created");
      onClose();
      setCustomerName("");
      setSubject("");
      setDescription("");
      setOrderId("");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not create the ticket",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader className="flex-row items-center justify-between">
          <DialogTitle className="text-[15px]">New ticket</DialogTitle>
          <button
            onClick={onClose}
            className="interactive rounded-md p-1 hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <Field label="Customer">
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Rahul Sharma"
              required
              className="h-9 text-[13px]"
            />
          </Field>
          <Field label="Subject">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Delivery delayed beyond promise date"
              required
              className="h-9 text-[13px]"
            />
          </Field>
          <Field label="Order number" hint="Optional">
            <Input
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="4852"
              className="h-9 text-[13px]"
            />
          </Field>
          <Field label="Priority">
            <Select
              value={priority}
              onValueChange={(v) => setPriority(v as TicketPriority)}
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p} className="text-[13px]">
                    {titleCase(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Details">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="resize-none text-[13px]"
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="h-9"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={busy}
              className="h-9 gap-1.5"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
