import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    next:
      typeof search["next"] === "string"
        ? (search["next"] as string)
        : undefined,
    denied:
      search["denied"] === "1" || search["denied"] === true ? true : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { next, denied } = Route.useSearch();
  const { user, ready, signIn, signUp } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Show whether the API is even reachable, so a failed sign-in is not
  // misattributed to a wrong password.
  const [apiUp, setApiUp] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .health()
      .then(() => setApiUp(true))
      .catch(() => setApiUp(false));
  }, []);

  // Already signed in — skip the form.
  useEffect(() => {
    if (ready && user && user.role !== "customer") {
      void navigate({ to: next ?? "/", replace: true });
    }
  }, [ready, user, next, navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const phoneVal = phone.trim();
      const account =
        mode === "signin"
          ? await signIn(email.trim(), password)
          : await signUp({
              email: email.trim(),
              password,
              fullName: fullName.trim(),
              ...(phoneVal ? { phone: phoneVal } : {}),
            });

      if (account.role === "customer") {
        setError(
          "This is the staff console. Customer accounts use the caller line instead.",
        );
        return;
      }

      toast.success(
        mode === "signin"
          ? `Welcome back, ${account.fullName.split(" ")[0]}`
          : "Account created",
      );
      void navigate({ to: next ?? "/", replace: true });
    } catch (e) {
      const errMsg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not sign you in. Try again.";
      if (
        mode === "signup" &&
        (errMsg.toLowerCase().includes("already exists") ||
          (e instanceof ApiError && e.status === 409))
      ) {
        setMode("signin");
        setPassword("");
        setError(
          "An account with this email already exists. Please sign in with your password.",
        );
        toast.info("Account already exists. Switched to sign in.");
      } else {
        setError(errMsg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <img
            src="/logo.png"
            alt=""
            className="mb-3.5 size-11 rounded-xl object-contain"
          />
          <h1 className="font-display text-[22px] font-bold tracking-tight">
            {mode === "signin"
              ? "Sign in to Nerv"
              : "Create your account"}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {mode === "signin"
              ? "Operations console for the Nerv AI voice support line"
              : "You will get agent access to the console"}
          </p>
        </div>

        {denied && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-warning/20 bg-warning-muted px-3.5 py-2.5 text-[12.5px] text-warning">
            <AlertTriangle className="mt-px size-4 shrink-0" />
            <span>That account does not have access to the staff console.</span>
          </div>
        )}

        {apiUp === false && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive-muted px-3.5 py-2.5 text-[12.5px] text-destructive">
            <AlertTriangle className="mt-px size-4 shrink-0" />
            <span>
              Cannot reach the API at{" "}
              <code className="font-mono">{api.baseUrl}</code>. Start it with{" "}
              <code className="font-mono">npm run dev:api</code>.
            </span>
          </div>
        )}

        <div className="surface p-6 shadow-sm">
          <form onSubmit={submit} className="space-y-3.5">
            {mode === "signup" && (
              <>
                <Field label="Full name" htmlFor="fullName">
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Priya Menon"
                    autoComplete="name"
                    required
                  />
                </Field>
                <Field label="Phone" htmlFor="phone" optional>
                  <Input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    autoComplete="tel"
                  />
                </Field>
              </>
            )}

            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                required
              />
            </Field>

            <Field
              label="Password"
              htmlFor="password"
              hint={
                mode === "signup"
                  ? "8+ characters, with a capital letter or a number"
                  : undefined
              }
            >
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                required
              />
            </Field>

            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive-muted px-3 py-2 text-[12.5px] text-destructive">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={busy}
              className="h-10 w-full gap-2 text-[13px]"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {mode === "signin" ? "Sign in" : "Create account"}
              {!busy && <ArrowRight className="size-4" />}
            </Button>
          </form>

          {mode === "signin" && (
            <div className="mt-4 rounded-lg border border-border/60 bg-muted/40 p-3 text-[11.5px]">
              <p className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px] mb-2">Demo Credentials</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEmail("admin@nerv.dev");
                    setPassword("Echosphere123");
                  }}
                  className="flex-1 rounded border border-border bg-card px-2 py-1 text-center font-medium hover:bg-accent transition-colors"
                >
                  Admin: admin@nerv.dev
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEmail("rohit.verma@nerv.dev");
                    setPassword("Echosphere123");
                  }}
                  className="flex-1 rounded border border-border bg-card px-2 py-1 text-center font-medium hover:bg-accent transition-colors"
                >
                  Agent: rohit.verma@nerv.dev
                </button>
              </div>
            </div>
          )}

          <div className="mt-5 border-t border-border pt-4 text-center">
            <p className="text-[12.5px] text-muted-foreground">
              {mode === "signin"
                ? "No account yet?"
                : "Already have an account?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "signin" ? "signup" : "signin");
                  setError(null);
                  setPassword("");
                }}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {mode === "signin" ? "Create one" : "Sign in"}
              </button>
            </p>
          </div>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-[11.5px] text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Sessions are signed server-side and can be revoked from Settings
        </p>

        <p className="mt-5 text-center text-[11.5px] text-muted-foreground">
          Looking for the customer line?{" "}
          <a
            href="http://localhost:5174"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Open the Nerv customer line
          </a>
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string | undefined;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={htmlFor} className="text-[12.5px] font-medium">
          {label}
        </Label>
        {optional && (
          <span className="text-[11px] text-muted-foreground">optional</span>
        )}
      </div>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
