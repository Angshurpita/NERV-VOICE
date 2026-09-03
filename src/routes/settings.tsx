import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Shield,
  User as UserIcon,
  Palette,
  Key,
  LogOut,
  Laptop,
  Smartphone,
  Bell,
  Globe,
  Sparkles,
  Sun,
  Moon,
  Check,
} from "lucide-react";
import { SurfaceCard, CardHeader } from "@/components/shared/SurfaceCard";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { api, formatRelative } from "@/lib/api";
import { Avatar } from "@/components/layout/AppLayout";

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab:
      typeof search["tab"] === "string" ? (search["tab"] as string) : "profile",
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const search = Route.useSearch() as { tab?: string };
  const initialTab = search?.tab;
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab || "profile");

  // Profile form state
  const [fullName, setFullName] = useState(user?.fullName || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  // Sessions query
  const { data: sessionsData, refetch: refetchSessions } = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: api.auth.sessions,
  });

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await api.auth.updateProfile({ fullName, phone: phone || null });
      toast.success("Profile updated successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    setChangingPassword(true);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      toast.success("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast.error(err.message || "Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleRevokeSession = async (id: string) => {
    try {
      await api.auth.revokeSession(id);
      toast.success("Session revoked");
      refetchSessions();
    } catch (err: any) {
      toast.error(err.message || "Failed to revoke session");
    }
  };

  return (
    <div className="space-y-6 max-w-4xl animate-fade-in-up">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Account Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage your personal details, credentials, active sessions, and
          preferences
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <UserIcon className="size-3.5" /> Profile
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-2">
            <Shield className="size-3.5" /> Security
          </TabsTrigger>
          <TabsTrigger value="appearance" className="flex items-center gap-2">
            <Palette className="size-3.5" /> Appearance
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-5 pt-4">
          {/* Identity & Role Overview */}
          <SurfaceCard className="p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                {user && (
                  <Avatar name={user.fullName} color={user.avatarColor} />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-foreground">
                      {user?.fullName}
                    </h3>
                    <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary">
                      {user?.role}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {user?.email}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active Account
                </span>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <CardHeader
              title="Personal Information"
              subtitle="Update your display name, contact details, and voice preference"
              icon={<UserIcon className="size-4" />}
            />
            <form
              onSubmit={handleUpdateProfile}
              className="space-y-4 pt-4 max-w-md"
            >
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium">
                  Email address
                </Label>
                <Input
                  id="email"
                  value={user?.email || ""}
                  disabled
                  className="text-xs bg-muted/40 cursor-not-allowed text-muted-foreground"
                />
                <p className="text-[11px] text-muted-foreground">
                  Managed by your system administrator.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fullName" className="text-xs font-medium">
                  Full Name
                </Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-xs font-medium">
                  Phone Number
                </Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="text-xs"
                />
              </div>

              {/* Avatar Color Selector */}
              <div className="space-y-1.5 pt-1">
                <Label className="text-xs font-medium">
                  Avatar Accent Color
                </Label>
                <div className="flex items-center gap-2 pt-1">
                  {["indigo", "emerald", "amber", "rose", "violet", "cyan"].map(
                    (col) => (
                      <button
                        key={col}
                        type="button"
                        onClick={() => {
                          api.auth.updateProfile({ avatarColor: col });
                          toast.success(`Avatar updated to ${col}`);
                        }}
                        className={`size-7 rounded-full transition-transform hover:scale-110 flex items-center justify-center ${
                          col === "indigo"
                            ? "bg-indigo-600"
                            : col === "emerald"
                              ? "bg-emerald-600"
                              : col === "amber"
                                ? "bg-amber-600"
                                : col === "rose"
                                  ? "bg-rose-600"
                                  : col === "violet"
                                    ? "bg-purple-600"
                                    : "bg-cyan-600"
                        } ${user?.avatarColor === col ? "ring-2 ring-offset-2 ring-primary ring-offset-background scale-105" : ""}`}
                      >
                        {user?.avatarColor === col && (
                          <Check className="size-3.5 text-white" />
                        )}
                      </button>
                    ),
                  )}
                </div>
              </div>

              {/* Locale / Language selector */}
              <div className="space-y-1.5 pt-1">
                <Label className="text-xs font-medium">
                  Primary Locale / Voice Language
                </Label>
                <div className="grid grid-cols-2 gap-2 max-w-xs">
                  <Button
                    type="button"
                    variant={user?.locale === "en" ? "default" : "outline"}
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => {
                      api.auth.updateProfile({ locale: "en" });
                      toast.success("Locale set to English");
                    }}
                  >
                    <Globe className="size-3.5" /> English (IN)
                  </Button>
                  <Button
                    type="button"
                    variant={user?.locale === "hi" ? "default" : "outline"}
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => {
                      api.auth.updateProfile({ locale: "hi" });
                      toast.success("भाषा हिन्दी में बदली गई");
                    }}
                  >
                    <Globe className="size-3.5" /> हिन्दी (Hindi)
                  </Button>
                </div>
              </div>

              <div className="pt-2">
                <Button type="submit" size="sm" disabled={savingProfile}>
                  {savingProfile ? "Saving…" : "Save Profile Changes"}
                </Button>
              </div>
            </form>
          </SurfaceCard>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-5 pt-4">
          <SurfaceCard className="p-5">
            <CardHeader
              title="Change Password"
              subtitle="Must be at least 8 characters with upper, lower, and digits"
              icon={<Key className="size-4" />}
            />
            <form
              onSubmit={handleChangePassword}
              className="space-y-4 pt-4 max-w-md"
            >
              <div className="space-y-1.5">
                <Label htmlFor="current" className="text-xs">
                  Current Password
                </Label>
                <Input
                  id="current"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new" className="text-xs">
                  New Password
                </Label>
                <Input
                  id="new"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm" className="text-xs">
                  Confirm New Password
                </Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="text-xs"
                  required
                />
              </div>

              <div className="pt-2">
                <Button type="submit" size="sm" disabled={changingPassword}>
                  {changingPassword ? "Updating…" : "Change Password"}
                </Button>
              </div>
            </form>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <CardHeader
              title="Active Sessions"
              subtitle="Devices currently logged into your account"
              icon={<Shield className="size-4" />}
            />
            <div className="divide-y divide-border pt-2">
              {sessionsData?.sessions?.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground">
                      {session.userAgent?.includes("Mobile") ? (
                        <Smartphone className="size-4" />
                      ) : (
                        <Laptop className="size-4" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium">
                        {session.current
                          ? "Current Session"
                          : session.userAgent || "Web browser"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {session.ip ? `${session.ip} • ` : ""}Active{" "}
                        {formatRelative(session.lastSeenAt)}
                      </p>
                    </div>
                  </div>

                  {!session.current && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-destructive hover:bg-destructive/10"
                      onClick={() => handleRevokeSession(session.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </SurfaceCard>
        </TabsContent>

        {/* Appearance & Interface Tab */}
        <TabsContent value="appearance" className="space-y-5 pt-4">
          <SurfaceCard className="p-5">
            <CardHeader
              title="Theme & Visual Style"
              subtitle="Customize your visual theme and typography contrast"
              icon={<Palette className="size-4" />}
            />
            <div className="space-y-5 pt-4 max-w-lg">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Theme Mode</Label>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    Lite Theme Recommended
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      api.auth.updateProfile({ theme: "light" });
                      toast.success("Lite theme applied");
                    }}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-3.5 text-center transition-all ${
                      user?.theme === "light"
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "border-border bg-card hover:bg-muted/50"
                    }`}
                  >
                    <Sun className="size-5 text-amber-500" />
                    <span className="text-xs font-semibold">Lite Theme</span>
                    <span className="text-[10.5px] text-muted-foreground leading-tight">
                      Crisp &amp; clean
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      api.auth.updateProfile({ theme: "dark" });
                      toast.success("Dark theme applied");
                    }}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-3.5 text-center transition-all ${
                      user?.theme === "dark"
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "border-border bg-card hover:bg-muted/50"
                    }`}
                  >
                    <Moon className="size-5 text-indigo-400" />
                    <span className="text-xs font-semibold">Dark Theme</span>
                    <span className="text-[10.5px] text-muted-foreground leading-tight">
                      High contrast
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      api.auth.updateProfile({ theme: "system" });
                      toast.success("System theme matched");
                    }}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-3.5 text-center transition-all ${
                      user?.theme === "system"
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "border-border bg-card hover:bg-muted/50"
                    }`}
                  >
                    <Sparkles className="size-5 text-muted-foreground" />
                    <span className="text-xs font-semibold">Auto System</span>
                    <span className="text-[10.5px] text-muted-foreground leading-tight">
                      Match OS theme
                    </span>
                  </button>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <Label className="text-xs font-semibold">
                  Information Density
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant={
                      user?.density === "comfortable" ? "default" : "outline"
                    }
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      api.auth.updateProfile({ density: "comfortable" });
                      toast.success("Comfortable spacing enabled");
                    }}
                  >
                    Comfortable (Standard)
                  </Button>
                  <Button
                    type="button"
                    variant={
                      user?.density === "compact" ? "default" : "outline"
                    }
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      api.auth.updateProfile({ density: "compact" });
                      toast.success("Compact view enabled");
                    }}
                  >
                    Compact (Dense Rows)
                  </Button>
                </div>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <CardHeader
              title="Notifications &amp; Sound Alerts"
              subtitle="Control audio chime on escalations and daily performance summaries"
              icon={<Bell className="size-4" />}
            />
            <div className="space-y-4 pt-4 max-w-lg divide-y divide-border">
              <div className="flex items-center justify-between pb-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    Live Escalation Sound &amp; Banner
                  </p>
                  <p className="text-[11.5px] text-muted-foreground mt-0.5">
                    Trigger visual toast and priority alert chime whenever a
                    call is escalated to human.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={user?.notifyEscalations ? "default" : "outline"}
                  className="h-8 text-xs font-medium"
                  onClick={() => {
                    const next = !user?.notifyEscalations;
                    api.auth.updateProfile({ notifyEscalations: next });
                    toast.success(
                      next
                        ? "Escalation alerts enabled"
                        : "Escalation alerts muted",
                    );
                  }}
                >
                  {user?.notifyEscalations ? "Enabled" : "Muted"}
                </Button>
              </div>

              <div className="flex items-center justify-between pt-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    Daily Operations Summary
                  </p>
                  <p className="text-[11.5px] text-muted-foreground mt-0.5">
                    Receive morning digest of resolved calls, CSAT, and
                    unresolved tickets.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={user?.notifyDigest ? "default" : "outline"}
                  className="h-8 text-xs font-medium"
                  onClick={() => {
                    const next = !user?.notifyDigest;
                    api.auth.updateProfile({ notifyDigest: next });
                    toast.success(
                      next ? "Daily digest enabled" : "Daily digest disabled",
                    );
                  }}
                >
                  {user?.notifyDigest ? "Subscribed" : "Off"}
                </Button>
              </div>
            </div>
          </SurfaceCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
