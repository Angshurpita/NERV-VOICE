import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { api, ApiError, type User } from "./api";

/**
 * Authentication state — requirement 11.
 *
 * Backed by `GET /api/auth/me` rather than a `localStorage` flag. The difference
 * matters: the old check (`localStorage.getItem('isAuthenticated') === 'true'`)
 * was a boolean the browser owned, so anyone could set it and walk in. Here the
 * server decides, from a signed httpOnly cookie it alone can read.
 */

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** True once the first `me` check has settled, either way. */
  ready: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (data: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
  }) => Promise<User>;
  signOut: () => Promise<void>;
  updateProfile: (
    patch: Parameters<typeof api.auth.updateProfile>[0],
  ) => Promise<User>;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetched } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      try {
        return (await api.auth.me()).user;
      } catch (error) {
        // 401 is the expected answer for a signed-out visitor, not a failure —
        // returning null keeps it out of the error path so no toast fires.
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const user = data ?? null;

  const setUser = useCallback(
    (next: User | null) => queryClient.setQueryData(["auth", "me"], next),
    [queryClient],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { user: signedIn } = await api.auth.login(email, password);
      setUser(signedIn);
      return signedIn;
    },
    [setUser],
  );

  const signUp = useCallback(
    async (payload: Parameters<typeof api.auth.signup>[0]) => {
      const { user: created } = await api.auth.signup(payload);
      setUser(created);
      return created;
    },
    [setUser],
  );

  const signOut = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      // Clear locally regardless: if the network call failed the cookie may
      // still be gone, and leaving a stale user on screen is worse.
      setUser(null);
      queryClient.clear();
    }
  }, [queryClient, setUser]);

  const updateProfile = useCallback(
    async (patch: Parameters<typeof api.auth.updateProfile>[0]) => {
      const { user: updated } = await api.auth.updateProfile(patch);
      setUser(updated);
      return updated;
    },
    [setUser],
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading: isLoading,
      ready: isFetched,
      signIn,
      signUp,
      signOut,
      updateProfile,
      refresh,
    }),
    [
      user,
      isLoading,
      isFetched,
      signIn,
      signUp,
      signOut,
      updateProfile,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

/** Role ranking, mirroring the server's. Used only to hide UI, never to protect data. */
const RANK: Record<User["role"], number> = {
  customer: 0,
  agent: 1,
  supervisor: 2,
  admin: 3,
};

export function useHasRole(minimum: User["role"]): boolean {
  const { user } = useAuth();
  return user ? RANK[user.role] >= RANK[minimum] : false;
}

/**
 * Apply the user's saved appearance choices.
 *
 * Theme and density live on the account rather than in `localStorage` so they
 * follow the person between machines. The pre-hydration flash is handled by
 * defaulting the document to light, which is the theme most users will have.
 */
export function useAppearance(): void {
  const { user } = useAuth();
  const theme = user?.theme ?? "light";
  const density = user?.density ?? "comfortable";

  useEffect(() => {
    const root = document.documentElement;

    const apply = (dark: boolean) => root.classList.toggle("dark", dark);

    if (theme === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      apply(media.matches);
      const listener = (event: MediaQueryListEvent) => apply(event.matches);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    }

    apply(theme === "dark");
    return undefined;
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset["density"] = density;
  }, [density]);
}

export function useMutationWithToast<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  options: {
    invalidate?: unknown[][];
    onDone?: (result: TResult) => void;
  } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      for (const key of options.invalidate ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      options.onDone?.(result);
    },
  });
}
