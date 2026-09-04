import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  ChevronsLeft,
  Headphones,
  LayoutDashboard,
  LogOut,
  Menu,
  Mic,
  Package,
  Phone,
  Settings,
  Shield,
  TicketCheck,
  User as UserIcon,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Application shell.
 *
 * Two notable changes from the previous version. The Caller Simulator has been
 * removed from the navigation — it is a separate deployment now (requirement 10),
 * because a customer-facing dialer inside the staff console was never right. And
 * the avatar opens a menu instead of logging you straight out, which it used to
 * do on a single click with no confirmation.
 */

interface NavItem {
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
  /** Minimum role. Hides the link; the API enforces the real boundary. */
  role?: "agent" | "supervisor" | "admin";
}

const NAV: NavItem[] = [
  { name: "Overview", href: "/", icon: LayoutDashboard },
  { name: "Live console", href: "/console", icon: Mic },
  { name: "Handover queue", href: "/agent", icon: Headphones },
  { name: "Tickets", href: "/tickets", icon: TicketCheck },
  { name: "Call history", href: "/calls", icon: Phone },
  { name: "Orders", href: "/orders", icon: Package },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Team", href: "/team", icon: Users, role: "supervisor" },
];

const RANK = { customer: 0, agent: 1, supervisor: 2, admin: 3 } as const;

const AVATAR_BG: Record<string, string> = {
  indigo:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
  emerald:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
  violet:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300",
  orange:
    "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
};

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function Avatar({
  name,
  color,
  size = "md",
}: {
  name: string;
  color: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold",
        AVATAR_BG[color] ?? AVATAR_BG["indigo"],
        size === "sm" ? "size-6 text-[10px]" : "size-8 text-[11.5px]",
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const routerState = useRouterState();
  const path = routerState.location.pathname;
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  // Pending handovers drive the queue badge; polled because Vercel cannot hold a
  // socket open for us.
  const { data: pending } = useQuery({
    queryKey: ["escalations", "pending-count"],
    queryFn: async () =>
      (await api.escalations.list("pending")).escalations.length,
    refetchInterval: 15_000,
    enabled: Boolean(user),
  });

  useEffect(() => setMobileOpen(false), [path]);

  const visible = NAV.filter(
    (item) => !item.role || (user && RANK[user.role] >= RANK[item.role]),
  );
  const current = visible.find((item) => item.href === path);

  const handleSignOut = async () => {
    await signOut();
    void navigate({
      to: "/login",
      search: { next: undefined, denied: undefined },
    });
  };

  const navLinks = (onNavigate?: () => void) =>
    visible.map((item) => {
      const active = path === item.href;
      return (
        <Link
          key={item.href}
          to={item.href}
          onClick={onNavigate}
          title={collapsed ? item.name : undefined}
          className={cn(
            "interactive group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium",
            active
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {/* Active marker is a positioned element, not a border, so the label
              never shifts by a pixel between states. */}
          {active && (
            <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
          )}
          <item.icon
            className={cn("size-[17px] shrink-0", active && "text-primary")}
          />
          {!collapsed && <span className="truncate">{item.name}</span>}
          {!collapsed && item.href === "/agent" && pending ? (
            <span className="ml-auto rounded-full bg-warning-muted px-1.5 py-0.5 text-[10px] font-semibold text-warning tnum">
              {pending}
            </span>
          ) : null}
        </Link>
      );
    });

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-border bg-sidebar md:flex",
          "transition-[width] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
          collapsed ? "w-[60px]" : "w-[228px]",
        )}
      >
        <div className="flex h-14 items-center gap-2.5 px-3.5">
          <img
            src="/logo.png"
            alt=""
            className="size-7 shrink-0 rounded-md object-contain"
          />
          {!collapsed && (
            <span className="truncate font-display text-[15px] font-bold tracking-tight">
              Nerv
            </span>
          )}
        </div>

        <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          {navLinks()}
        </nav>

        <div className="space-y-0.5 border-t border-border p-2">
          <Link
            to="/settings"
            search={{ tab: "profile" }}
            className={cn(
              "interactive flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium",
              path === "/settings"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            title={collapsed ? "Settings" : undefined}
          >
            <Settings className="size-[17px] shrink-0" />
            {!collapsed && "Settings"}
          </Link>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="interactive flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronsLeft
              className={cn(
                "size-[17px] shrink-0 transition-transform",
                collapsed && "rotate-180",
              )}
            />
            {!collapsed && "Collapse"}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setMobileOpen(true)}
              className="interactive -ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
              aria-label="Open navigation"
            >
              <Menu className="size-[18px]" />
            </button>
            <h1 className="truncate font-display text-[15px] font-semibold">
              {current?.name ?? (path === "/settings" ? "Settings" : "Nerv")}
            </h1>
          </div>

          <div className="flex items-center gap-1.5">
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="interactive flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-all hover:bg-muted/70 focus:outline-hidden focus:ring-2 focus:ring-primary/20">
                    <Avatar name={user.fullName} color={user.avatarColor} />
                    <span className="hidden text-left sm:block">
                      <span className="block max-w-[140px] truncate text-[12.5px] font-semibold leading-tight text-foreground">
                        {user.fullName}
                      </span>
                      <span className="block text-[11px] capitalize leading-tight text-muted-foreground">
                        {user.role}
                      </span>
                    </span>
                  </button>
                </DropdownMenuTrigger>

                <DropdownMenuContent
                  align="end"
                  className="w-64 p-1.5 shadow-md"
                >
                  <div className="flex items-center gap-3 p-2.5 bg-muted/40 rounded-lg border border-border/50 mb-1">
                    <Avatar name={user.fullName} color={user.avatarColor} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-xs font-bold text-foreground">
                          {user.fullName}
                        </span>
                        <span className="rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider bg-primary/10 text-primary">
                          {user.role}
                        </span>
                      </div>
                      <span className="block truncate text-[11px] text-muted-foreground mt-0.5">
                        {user.email}
                      </span>
                      <div className="flex items-center gap-1.5 mt-1 text-[10.5px] text-emerald-600 font-medium">
                        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Active Staff Session
                      </div>
                    </div>
                  </div>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    onClick={() =>
                      navigate({ to: "/settings", search: { tab: "profile" } })
                    }
                    className="gap-2.5 text-xs font-medium cursor-pointer py-2"
                  >
                    <UserIcon className="size-4 text-primary" /> Profile &amp;
                    Details
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    onClick={() =>
                      navigate({ to: "/settings", search: { tab: "security" } })
                    }
                    className="gap-2.5 text-xs font-medium cursor-pointer py-2"
                  >
                    <Shield className="size-4 text-indigo-500" /> Security &amp;
                    Sessions
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    onClick={() =>
                      navigate({
                        to: "/settings",
                        search: { tab: "appearance" },
                      })
                    }
                    className="gap-2.5 text-xs font-medium cursor-pointer py-2"
                  >
                    <Settings className="size-4 text-amber-500" /> Theme &amp;
                    Appearance
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    onClick={handleSignOut}
                    className="gap-2.5 text-xs font-medium text-destructive focus:text-destructive cursor-pointer py-2"
                  >
                    <LogOut className="size-4 text-destructive" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              className="absolute inset-0 bg-foreground/25 animate-fade"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            />
            <div className="animate-rise absolute inset-y-0 left-0 flex w-[250px] flex-col border-r border-border bg-sidebar">
              <div className="flex h-14 items-center justify-between px-3.5">
                <span className="font-display text-[15px] font-bold">Nerv</span>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md p-1.5 hover:bg-muted"
                >
                  <X className="size-[18px]" />
                </button>
              </div>
              <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
                {navLinks(() => setMobileOpen(false))}
              </nav>
            </div>
          </div>
        )}

        <main className="scroll-thin flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
