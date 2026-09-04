import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAppearance, useAuth } from "@/lib/auth";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

/** Routes reachable without a session. */
const PUBLIC_ROUTES = new Set(["/login"]);

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="font-display text-6xl font-bold text-muted-foreground/40">
          404
        </p>
        <h2 className="mt-3 font-display text-lg font-semibold">
          Page not found
        </h2>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          That page doesn't exist or has moved.
        </p>
        <Link
          to="/"
          className="interactive mt-5 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:opacity-90"
        >
          Back to overview
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-lg font-semibold">
          This page didn't load
        </h1>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          Something went wrong on our end. Try again, or head back to the
          overview.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="interactive inline-flex items-center rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/"
            className="interactive inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-[13px] font-medium hover:bg-muted"
          >
            Overview
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "Nerv — AI Voice Support Console" },
        {
          name: "description",
          content: "Operations console for the Nerv AI voice support line",
        },
        { name: "color-scheme", content: "light dark" },
      ],
      links: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossOrigin: "anonymous",
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter+Tight:wght@400;500;600&display=swap",
        },
        { rel: "stylesheet", href: appCss },
        { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      ],
    }),
    shellComponent: RootShell,
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Shell />
        <Toaster position="bottom-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}

/**
 * Auth gate.
 *
 * Waits for the `me` check to settle before deciding anything — redirecting on
 * `user === null` while the request is still in flight would bounce every
 * signed-in visitor to the login page on a hard refresh.
 */
function Shell() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const routerState = useRouterState();
  const path = routerState.location.pathname;
  const isPublic = PUBLIC_ROUTES.has(path);

  useAppearance();

  useEffect(() => {
    if (!ready) return;

    if (!user && !isPublic) {
      // Remember where they were headed, so signing in lands them there.
      void navigate({
        to: "/login",
        search: { next: path, denied: undefined },
        replace: true,
      });
      return;
    }

    // A customer account has no business in the staff console; the caller app is
    // a separate deployment.
    if (user && user.role === "customer" && !isPublic) {
      void navigate({
        to: "/login",
        search: { next: undefined, denied: true },
        replace: true,
      });
    }
  }, [ready, user, isPublic, path, navigate]);

  if (!ready && !isPublic) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
          <p className="text-[12.5px] text-muted-foreground">
            Checking your session…
          </p>
        </div>
      </div>
    );
  }

  if (isPublic) return <Outlet />;
  if (!user) return null;

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
