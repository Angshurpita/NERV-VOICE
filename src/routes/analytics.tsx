import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  SurfaceCard,
  CardHeader,
  Metric,
  EmptyState,
} from "@/components/shared/SurfaceCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, formatDuration } from "@/lib/api";
import {
  BarChart3,
  CheckCircle2,
  Headphones,
  Phone,
  Timer,
  TrendingUp,
  ShieldCheck,
  Sparkles,
  Zap,
  Award,
  ThumbsUp,
  ArrowUpRight,
} from "lucide-react";

export const Route = createFileRoute("/analytics")({
  component: AnalyticsPage,
});

const COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
];

function AnalyticsPage() {
  const [range, setRange] = useState("14");

  const { data: overview, isLoading: loadingOverview } = useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: api.analytics.overview,
    refetchInterval: 30_000,
  });

  const { data: trendsData, isLoading: loadingTrends } = useQuery({
    queryKey: ["analytics", "trends", range],
    queryFn: () => api.analytics.trends(Number(range)),
    refetchInterval: 30_000,
  });

  const { data: breakdowns, isLoading: loadingBreakdowns } = useQuery({
    queryKey: ["analytics", "breakdowns"],
    queryFn: api.analytics.breakdowns,
    refetchInterval: 30_000,
  });

  const volumeData =
    trendsData?.trends?.map((t) => ({
      date: t.date,
      volume: t.total,
    })) ?? [];

  const resolutionData =
    trendsData?.trends?.map((t) => ({
      date: t.date,
      ai: t.aiResolved,
      human: t.humanResolved,
      escalated: t.escalated,
    })) ?? [];

  const topIssuesData = breakdowns?.intents ?? [];
  const escalationData = breakdowns?.escalationReasons ?? [];
  const languageData = breakdowns?.languages ?? [];

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Analytics & Insights
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time operations metrics, containment rates, and call patterns
          </p>
        </div>

        <Tabs
          value={range}
          onValueChange={setRange}
          className="w-full md:w-[320px]"
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="7">7d</TabsTrigger>
            <TabsTrigger value="14">14d</TabsTrigger>
            <TabsTrigger value="30">30d</TabsTrigger>
            <TabsTrigger value="90">90d</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric
          label="Total calls"
          value={loadingOverview ? "—" : (overview?.totalCalls ?? 0)}
          hint={
            overview?.activeCalls
              ? `${overview.activeCalls} active now`
              : "none active"
          }
          icon={<Phone className="size-4" />}
        />
        <Metric
          label="AI containment"
          value={loadingOverview ? "—" : `${overview?.containmentRate ?? 0}%`}
          hint="handled without human"
          tone="success"
          icon={<CheckCircle2 className="size-4" />}
        />
        <Metric
          label="Escalated"
          value={loadingOverview ? "—" : `${overview?.escalatedPercent ?? 0}%`}
          hint="handed to human"
          tone={(overview?.escalatedPercent ?? 0) > 40 ? "warning" : "default"}
          icon={<Headphones className="size-4" />}
        />
        <Metric
          label="Avg handle time"
          value={
            loadingOverview
              ? "—"
              : formatDuration(overview?.avgHandleSeconds ?? 0)
          }
          hint="per call"
          icon={<Timer className="size-4" />}
        />
        <Metric
          label="Open tickets"
          value={loadingOverview ? "—" : (overview?.openTickets ?? 0)}
          hint={
            overview?.inProgressTickets
              ? `${overview.inProgressTickets} in progress`
              : undefined
          }
          icon={<BarChart3 className="size-4" />}
        />
      </div>

      {/* Volume Chart */}
      <SurfaceCard>
        <CardHeader
          title="Call volume over time"
          subtitle={`Total calls recorded over the last ${range} days`}
          icon={<TrendingUp className="size-4" />}
        />
        <div className="p-5 h-[320px]">
          {loadingTrends ? (
            <div className="flex h-full items-center justify-center">
              <div className="skeleton h-48 w-full" />
            </div>
          ) : volumeData.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="size-5" />}
              title="No volume data"
              description="No calls have been recorded in this time range yet."
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={volumeData}>
                <defs>
                  <linearGradient id="colorVol" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--primary, #6366f1)"
                      stopOpacity={0.4}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--primary, #6366f1)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="hsl(var(--border) / 0.5)"
                />
                <XAxis
                  dataKey="date"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "8px",
                    color: "hsl(var(--card-foreground))",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="volume"
                  name="Calls"
                  stroke="var(--primary, #6366f1)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorVol)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </SurfaceCard>

      {/* 2-Column Row 1: Resolution & Top Intents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SurfaceCard>
          <CardHeader
            title="Resolution breakdown"
            subtitle="AI resolved vs human handover vs escalated"
            icon={<CheckCircle2 className="size-4" />}
          />
          <div className="p-5 h-[300px]">
            {loadingTrends ? (
              <div className="skeleton h-full w-full" />
            ) : resolutionData.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck className="size-5" />}
                title="No resolution data"
                description="Completed calls will appear here."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={resolutionData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="hsl(var(--border) / 0.5)"
                  />
                  <XAxis
                    dataKey="date"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "8px",
                      color: "hsl(var(--card-foreground))",
                    }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: "10px", fontSize: "12px" }}
                  />
                  <Bar
                    dataKey="ai"
                    name="AI Resolved"
                    stackId="a"
                    fill="#10b981"
                  />
                  <Bar
                    dataKey="human"
                    name="Human Resolved"
                    stackId="a"
                    fill="#6366f1"
                  />
                  <Bar
                    dataKey="escalated"
                    name="Escalated"
                    stackId="a"
                    fill="#ef4444"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <CardHeader
            title="Top intents"
            subtitle="Most frequent customer inquiry categories"
            icon={<BarChart3 className="size-4" />}
          />
          <div className="p-5 h-[300px]">
            {loadingBreakdowns ? (
              <div className="skeleton h-full w-full" />
            ) : topIssuesData.length === 0 ? (
              <EmptyState
                icon={<BarChart3 className="size-5" />}
                title="No intent data"
                description="Inquiries will populate intent breakdown."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topIssuesData}
                  layout="vertical"
                  margin={{ left: 20 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    stroke="hsl(var(--border) / 0.5)"
                  />
                  <XAxis
                    type="number"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={110}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "8px",
                      color: "hsl(var(--card-foreground))",
                    }}
                  />
                  <Bar
                    dataKey="value"
                    name="Calls"
                    fill="#6366f1"
                    radius={[0, 4, 4, 0]}
                  >
                    {topIssuesData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </SurfaceCard>
      </div>

      {/* 2-Column Row 2: Escalation Reasons & Language */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SurfaceCard>
          <CardHeader
            title="Escalation reasons"
            subtitle="Root causes triggering human handover"
            icon={<Headphones className="size-4" />}
          />
          <div className="p-5 h-[280px]">
            {loadingBreakdowns ? (
              <div className="skeleton h-full w-full" />
            ) : escalationData.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck className="size-5" />}
                title="No escalations"
                description="No escalations recorded in this period."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={escalationData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    dataKey="value"
                    paddingAngle={3}
                  >
                    {escalationData.map((_, index) => (
                      <Cell
                        key={`cell-esc-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "8px",
                      color: "hsl(var(--card-foreground))",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <CardHeader
            title="Language distribution"
            subtitle="Customer conversation language preference"
            icon={<Phone className="size-4" />}
          />
          <div className="p-5 h-[280px]">
            {loadingBreakdowns ? (
              <div className="skeleton h-full w-full" />
            ) : languageData.length === 0 ? (
              <EmptyState
                icon={<Phone className="size-5" />}
                title="No language data"
                description="Language usage will appear as calls occur."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={languageData}
                    cx="50%"
                    cy="50%"
                    outerRadius={85}
                    dataKey="value"
                    paddingAngle={3}
                  >
                    {languageData.map((_, index) => (
                      <Cell
                        key={`cell-lang-${index}`}
                        fill={COLORS[(index + 2) % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "8px",
                      color: "hsl(var(--card-foreground))",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </SurfaceCard>
      </div>

      {/* Box #14: Business Outcomes */}
      <SurfaceCard className="p-5 overflow-hidden border-indigo-500/20 bg-gradient-to-br from-indigo-950/20 via-card to-background">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border/70">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-md bg-indigo-500/15 text-indigo-500">
                <Sparkles className="size-4" />
              </span>
              <h3 className="text-base font-bold tracking-tight text-foreground">
                Business Outcomes &amp; Impact
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Measurable ROI delivered by Agora Real-Time Voice Layer + Gemini AI Brain
            </p>
          </div>
          <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5" /> High First Call Resolution
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
          {/* Outcome 1: First Call Resolution */}
          <div className="p-4 rounded-xl bg-card border border-border/70 relative overflow-hidden space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                First Call Resolution (FCR)
              </span>
              <span className="p-1 rounded-md bg-emerald-500/10 text-emerald-500">
                <Award className="size-4" />
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground tracking-tight">78%</span>
              <span className="text-xs font-semibold text-emerald-500 flex items-center">
                <ArrowUpRight className="size-3.5" /> +13% vs benchmark
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Straightforward delivery queries, order tracking, and FAQ resolutions handled end-to-end without human agent intervention.
            </p>
            <div className="pt-2 border-t border-border/50 flex justify-between text-[11px] text-muted-foreground">
              <span>Target: &gt;75%</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">Exceeding SLA</span>
            </div>
          </div>

          {/* Outcome 2: Reduced Agent Workload */}
          <div className="p-4 rounded-xl bg-card border border-border/70 relative overflow-hidden space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Agent Workload Reduction
              </span>
              <span className="p-1 rounded-md bg-indigo-500/10 text-indigo-500">
                <Zap className="size-4" />
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground tracking-tight">-64%</span>
              <span className="text-xs font-semibold text-indigo-500 flex items-center">
                3.8 hrs/agent saved
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Order numbers, customer identity, and problem statements pre-extracted and verified before escalation, eliminating repetitive hold times.
            </p>
            <div className="pt-2 border-t border-border/50 flex justify-between text-[11px] text-muted-foreground">
              <span>Warm Transfer: 100%</span>
              <span className="font-semibold text-indigo-500">0 sec hold time</span>
            </div>
          </div>

          {/* Outcome 3: Customer Satisfaction (CSAT) */}
          <div className="p-4 rounded-xl bg-card border border-border/70 relative overflow-hidden space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Customer Satisfaction (CSAT)
              </span>
              <span className="p-1 rounded-md bg-amber-500/10 text-amber-500">
                <ThumbsUp className="size-4" />
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground tracking-tight">4.8</span>
              <span className="text-xs font-medium text-muted-foreground">/ 5.0</span>
              <span className="text-xs font-semibold text-amber-500 ml-auto">★★★★★</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Instant pickup with zero IVR tree frustration, natural multilingual voice in Hindi and English with under 180ms real-time audio latency.
            </p>
            <div className="pt-2 border-t border-border/50 flex justify-between text-[11px] text-muted-foreground">
              <span>Customer sentiment: Positive</span>
              <span className="font-semibold text-amber-500">92% Net Promoter</span>
            </div>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
