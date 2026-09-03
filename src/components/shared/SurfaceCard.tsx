import { cn } from "@/lib/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * Surface primitives — requirement 1.
 *
 * Replaces `LiquidGlassCard`, which applied a 32px `backdrop-filter` and a
 * double drop shadow to every card and lifted 2px on hover. Depth here comes from
 * a border plus an optional small shadow, so scrolling a page full of these does
 * not re-rasterise anything.
 */

interface SurfaceCardProps extends ComponentPropsWithoutRef<"div"> {
  /** Adds a shadow at rest. Use sparingly — most cards need only the border. */
  raised?: boolean;
  /** Lifts the shadow on hover. For cards that are clickable. */
  hoverable?: boolean;
  /** Staggered entrance, in ms. Keep under ~250 total or lists feel slow. */
  delay?: number;
  /** Coloured left edge, for status emphasis. */
  accent?: "primary" | "success" | "warning" | "destructive" | "info";
}

const ACCENT_BORDER: Record<NonNullable<SurfaceCardProps["accent"]>, string> = {
  primary: "border-l-primary",
  success: "border-l-success",
  warning: "border-l-warning",
  destructive: "border-l-destructive",
  info: "border-l-info",
};

export function SurfaceCard({
  raised,
  hoverable,
  delay,
  accent,
  className,
  style,
  children,
  ...rest
}: SurfaceCardProps) {
  return (
    <div
      className={cn(
        "surface",
        raised && "shadow-sm",
        hoverable && "surface-hover cursor-pointer",
        accent && `border-l-[3px] ${ACCENT_BORDER[accent]}`,
        delay !== undefined && "animate-rise",
        className,
      )}
      style={
        delay !== undefined ? { animationDelay: `${delay}ms`, ...style } : style
      }
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  icon,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b border-border px-5 py-3.5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
        <div className="min-w-0">
          <h2 className="truncate text-[13.5px] font-semibold leading-tight">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/**
 * A single number with its label.
 *
 * Deliberately has no trend arrow: a delta needs a comparison period, and the
 * old version hardcoded `trends: { calls: 12, ai: 5, esc: -3 }`, which meant the
 * arrows were decoration pointing at nothing.
 */
export function Metric({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string | undefined;
  icon?: ReactNode;
  tone?:
    ("default" | "success" | "warning" | "destructive" | "info") | undefined;
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
    info: "text-info",
  }[tone];

  return (
    <SurfaceCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">
            {label}
          </p>
          <p
            data-slot="metric"
            className={cn(
              "mt-1.5 text-2xl font-semibold leading-none",
              toneClass,
            )}
          >
            {value}
          </p>
          {hint && (
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">{hint}</p>
          )}
        </div>
        {icon && (
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg bg-muted",
              toneClass,
            )}
          >
            {icon}
          </span>
        )}
      </div>
    </SurfaceCard>
  );
}

/** Loading placeholder that reserves the final layout, so nothing shifts. */
export function SkeletonRows({
  rows = 5,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-border">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-5 py-[var(--row-py,0.8125rem)]">
              <div
                className="skeleton h-3.5"
                style={{ width: `${45 + ((r + c) % 4) * 15}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && (
        <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </span>
      )}
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && (
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
