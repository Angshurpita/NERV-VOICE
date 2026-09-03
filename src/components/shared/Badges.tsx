import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/api";

/**
 * Status and priority pills.
 *
 * All tones are drawn from the semantic tokens, so they invert correctly in dark
 * mode. The previous badges hardcoded `bg-orange-400/10 text-orange-400`, which
 * was invisible on a light background.
 */

type Tone =
  "neutral" | "primary" | "success" | "warning" | "destructive" | "info";

const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  primary: "bg-accent text-accent-foreground border-primary/20",
  success: "bg-success-muted text-success border-success/20",
  warning: "bg-warning-muted text-warning border-warning/20",
  destructive: "bg-destructive-muted text-destructive border-destructive/20",
  info: "bg-info-muted text-info border-info/20",
};

function Pill({
  children,
  tone = "neutral",
  dot,
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium",
        TONE[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  // Calls
  active: "success",
  completed: "neutral",
  escalated: "warning",
  abandoned: "destructive",
  // Tickets
  open: "info",
  in_progress: "primary",
  waiting_customer: "warning",
  resolved: "success",
  closed: "neutral",
  // Escalations
  pending: "warning",
  accepted: "primary",
};

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <Pill tone={tone} dot={status === "active"} className={className}>
      {titleCase(status)}
    </Pill>
  );
}

const PRIORITY_TONE: Record<string, Tone> = {
  urgent: "destructive",
  high: "warning",
  medium: "info",
  low: "neutral",
};

export function PriorityBadge({
  priority,
  className,
}: {
  priority: string;
  className?: string;
}) {
  return (
    <Pill
      tone={PRIORITY_TONE[priority] ?? "neutral"}
      className={cn("uppercase tracking-wide", className)}
    >
      {priority}
    </Pill>
  );
}

/**
 * Confidence, banded rather than precise.
 *
 * A raw percentage invites false precision — the number is a product of ASR and
 * extraction estimates. Three bands communicate what an operator can act on:
 * trust it, check it, or ask again.
 */
export function ConfidenceBadge({
  score,
  showValue = true,
  className,
}: {
  score: number;
  showValue?: boolean;
  className?: string;
}) {
  const normalised = score > 1 ? score / 100 : score;
  const tone: Tone =
    normalised >= 0.85
      ? "success"
      : normalised >= 0.6
        ? "warning"
        : "destructive";
  const label =
    normalised >= 0.85 ? "High" : normalised >= 0.6 ? "Medium" : "Low";

  return (
    <Pill tone={tone} className={className}>
      {label}
      {showValue && (
        <span className="tnum opacity-70">{Math.round(normalised * 100)}%</span>
      )}
    </Pill>
  );
}

/** Escalation reason, mapped to a readable label. */
const REASON_LABEL: Record<string, string> = {
  CUSTOMER_INSISTED_HUMAN: "Insisted on a human",
  REFUND_OR_RETURN: "Refund / return",
  CANCEL_WHILE_OUT_FOR_DELIVERY: "Cancel after dispatch",
  SAFETY_POLICY: "Safety policy",
  BACKEND_FAILURE: "System failure",
};

const REASON_TONE: Record<string, Tone> = {
  CUSTOMER_INSISTED_HUMAN: "warning",
  REFUND_OR_RETURN: "info",
  CANCEL_WHILE_OUT_FOR_DELIVERY: "warning",
  SAFETY_POLICY: "destructive",
  BACKEND_FAILURE: "destructive",
};

export function ReasonBadge({
  reason,
  className,
}: {
  reason: string;
  className?: string;
}) {
  return (
    <Pill tone={REASON_TONE[reason] ?? "neutral"} className={className}>
      {REASON_LABEL[reason] ?? titleCase(reason)}
    </Pill>
  );
}

export function LanguageBadge({
  language,
  codeSwitched,
}: {
  language: string;
  codeSwitched?: boolean;
}) {
  return (
    <Pill tone="neutral">
      {codeSwitched
        ? "Hindi + English"
        : language === "hi"
          ? "हिन्दी"
          : "English"}
    </Pill>
  );
}

export { Pill };
