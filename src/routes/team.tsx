import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, Shield, UserCheck, Mail } from "lucide-react";
import {
  SurfaceCard,
  CardHeader,
  EmptyState,
  SkeletonRows,
} from "@/components/shared/SurfaceCard";
import { Avatar } from "@/components/layout/AppLayout";
import { api, formatRelative } from "@/lib/api";

export const Route = createFileRoute("/team")({
  component: TeamPage,
});

function TeamPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["team", "members"],
    queryFn: api.team.list,
  });

  const members = data?.members ?? [];

  return (
    <div className="space-y-5 animate-fade-in-up">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Team Management</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage staff accounts, assign roles, and configure system permissions
        </p>
      </div>

      <SurfaceCard>
        <CardHeader
          title="Team Members"
          subtitle={`${members.length} registered accounts`}
          icon={<Users className="size-4" />}
        />

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-muted/30 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <SkeletonRows rows={5} columns={5} />
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={<Users className="size-5" />}
                      title="No members found"
                      description="No staff members registered."
                    />
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr
                    key={member.id}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar
                          name={member.fullName}
                          color={member.avatarColor}
                          size="sm"
                        />
                        <span className="font-semibold text-foreground">
                          {member.fullName}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Mail className="size-3" /> {member.email}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium capitalize bg-muted">
                        <Shield className="size-3 text-primary" /> {member.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                        <span className="size-1.5 rounded-full bg-emerald-500" />{" "}
                        Active
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {member.createdAt
                        ? formatRelative(member.createdAt)
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </div>
  );
}
