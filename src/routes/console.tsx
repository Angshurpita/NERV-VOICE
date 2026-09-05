import { useState, useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SurfaceCard, CardHeader } from "@/components/shared/SurfaceCard";
import { ConfidenceBadge, ReasonBadge } from "@/components/shared/Badges";
import {
  Phone,
  PhoneOff,
  PhoneForwarded,
  Mic,
  MicOff,
  Volume2,
  Send,
  CheckCircle2,
  AlertTriangle,
  User,
  Bot,
  Radio,
  ExternalLink,
  Layers,
  Sparkles,
  Check,
  X,
  Activity,
  ShieldCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type FormattedConversationState } from "@/lib/api";

export const Route = createFileRoute("/console")({
  component: ConsolePage,
});

type Message = {
  id: string;
  text: string;
  sender: "user" | "agent" | "system";
  timestamp: Date;
  elapsed?: string;
};

interface TurnResponse {
  reply: string;
  language: string;
  escalated: boolean;
  escalationReason: string | null;
  caseRef: string | null;
  step: string;
  verification: {
    orderId: string | null;
    lookedUp: boolean;
    lookupOutcome: string | null;
    ordererName: string | null;
    readBack: boolean;
    confirmed: boolean;
    nameMatches: boolean | null;
    attempts: number;
  };
  intent: { value: string; confidence: number };
  confidence: number;
  humanRequestCount: number;
  stateSummary?: FormattedConversationState | undefined;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function ConsolePage() {
  const [isConnected, setIsConnected] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [activeStage, setActiveStage] = useState(0);
  const [transcript, setTranscript] = useState<Message[]>([]);
  const [callerInterim, setCallerInterim] = useState<string>("");
  const [inputValue, setInputValue] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [latestTurn, setLatestTurn] = useState<TurnResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const callIdRef = useRef<string | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  callIdRef.current = callId;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, callerInterim]);

  // Connect to live Agora Signalling stream from backend
  useEffect(() => {
    let sse: EventSource | null = null;
    try {
      sse = new EventSource(`${api.baseUrl}/api/agora/signalling/stream`);
      sse.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Auto-bind callId and connection state from ANY incoming call event
          const eventCallId = data.payload?.callId || data.callId;
          if (eventCallId) {
            setCallId((prev) => prev || eventCallId);
            setIsConnected(true);
            if (!callStartTimeRef.current) {
              callStartTimeRef.current = Date.now();
            }
          }

          if (data.event === "call_started") {
            const newCallId = data.payload?.callId || data.callId;
            setCallId(newCallId);
            setIsConnected(true);
            callStartTimeRef.current = Date.now();
            setActiveStage(2);
            setTranscript([
              {
                id: data.id ?? Date.now().toString(),
                text: `Call connected · Case ${data.payload?.caseRef || (newCallId || "").slice(0, 8)}. AI Voice Agent ready.`,
                sender: "system",
                timestamp: new Date(),
                elapsed: "00:00",
              },
            ]);
          } else if (data.event === "caller_interim" && data.payload?.text) {
            setCallerInterim(String(data.payload.text).trim());
            setActiveStage(1);
          } else if (data.event === "gemini_thinking") {
            setActiveStage(3);
          } else if (data.event === "caller_utterance" && data.payload?.text) {
            setCallerInterim("");
            const text = String(data.payload.text).trim();
            const elapsed = callStartTimeRef.current
              ? formatElapsed(Date.now() - callStartTimeRef.current)
              : "00:03";
            setTranscript((prev) => {
              const recent = prev.slice(-3);
              if (
                prev.some((m) => m.id === data.id) ||
                recent.some(
                  (m) =>
                    m.sender === "user" &&
                    m.text.trim().toLowerCase() === text.toLowerCase(),
                )
              ) {
                return prev;
              }
              return [
                ...prev,
                {
                  id: data.id ?? Date.now().toString(),
                  text,
                  sender: "user",
                  timestamp: new Date(data.timestamp ?? Date.now()),
                  elapsed,
                },
              ];
            });
            setActiveStage(3);
          } else if (data.event === "agent_reply" && data.payload?.reply) {
            setCallerInterim("");
            const reply = String(data.payload.reply).trim();
            const elapsed = callStartTimeRef.current
              ? formatElapsed(Date.now() - callStartTimeRef.current)
              : "00:05";
            setTranscript((prev) => {
              const recent = prev.slice(-3);
              if (
                prev.some((m) => m.id === data.id) ||
                recent.some(
                  (m) =>
                    m.sender === "agent" &&
                    m.text.trim().toLowerCase() === reply.toLowerCase(),
                )
              ) {
                return prev;
              }
              return [
                ...prev,
                {
                  id: data.id ?? Date.now().toString(),
                  text: reply,
                  sender: "agent",
                  timestamp: new Date(data.timestamp ?? Date.now()),
                  elapsed,
                },
              ];
            });
            setActiveStage(4);
            if (data.payload) {
              setLatestTurn((prev) => ({
                reply,
                language: (data.payload.language as any) || prev?.language || "en",
                escalated: Boolean(data.payload.escalated),
                escalationReason: (data.payload.reason as string) || prev?.escalationReason || null,
                caseRef: (data.payload.caseRef as string) || prev?.caseRef || null,
                step: (data.payload.step as string) || prev?.step || "",
                verification: (data.payload.verification as any) || prev?.verification || {
                  orderId: null,
                  lookedUp: false,
                  lookupOutcome: null,
                  ordererName: null,
                  readBack: false,
                  confirmed: false,
                  nameMatches: null,
                  attempts: 0,
                },
                intent: {
                  value:
                    typeof data.payload.intent === "object" && data.payload.intent !== null
                      ? (data.payload.intent as any).value || prev?.intent.value || "unknown"
                      : String(data.payload.intent || prev?.intent.value || "unknown"),
                  confidence:
                    typeof data.payload.intent === "object" && data.payload.intent !== null
                      ? Number((data.payload.intent as any).confidence || data.payload.confidence || prev?.intent.confidence || 0)
                      : Number(data.payload.confidence || prev?.intent.confidence || 0),
                },
                confidence: Number(data.payload.confidence || prev?.confidence || 0),
                humanRequestCount: prev?.humanRequestCount || 0,
                stateSummary: data.payload.stateSummary || prev?.stateSummary,
              }));
            }
          } else if (data.event === "call_ended") {
            setCallerInterim("");
            setIsConnected(false);
            setCallId(null);
            callStartTimeRef.current = null;
            setActiveStage(0);
            setTranscript((prev) => [
              ...prev,
              {
                id: data.id ?? Date.now().toString(),
                text: "Call session ended.",
                sender: "system",
                timestamp: new Date(),
                elapsed: "00:00",
              },
            ]);
          } else if (data.event === "escalation_triggered") {
            setCallerInterim("");
            setTranscript((prev) => [
              ...prev,
              {
                id: data.id ?? Date.now().toString(),
                text: `[AGORA SIGNALLING] Escalated to human: ${data.payload?.reason || "Threshold reached"} (Case: ${data.payload?.caseRef || "Pending"})`,
                sender: "system",
                timestamp: new Date(),
                elapsed: callStartTimeRef.current
                  ? formatElapsed(Date.now() - callStartTimeRef.current)
                  : "00:08",
              },
            ]);
            setLatestTurn((prev) =>
              prev
                ? {
                    ...prev,
                    escalated: true,
                    escalationReason:
                      (data.payload?.reason as string) || "CUSTOMER_INSISTED_HUMAN",
                    caseRef: (data.payload?.caseRef as string) || prev.caseRef,
                    step:
                      (data.payload?.step as string) ||
                      "Transferred to human specialist",
                    stateSummary:
                      data.payload?.stateSummary || prev.stateSummary,
                  }
                : null,
            );
          }
        } catch {
          // ignore parsing error
        }
      };
    } catch {
      // ignore
    }

    return () => {
      sse?.close();
    };
  }, []);

  // Auto-discover and sync with any active call from Customer Line or backend
  useEffect(() => {
    let cancelled = false;

    const checkActiveCall = async () => {
      try {
        const res = await api.calls.latestActive();
        if (cancelled || !res || !res.call) return;

        setCallId((prev) => prev || res.call!.id);
        setIsConnected(true);

        if (res.transcript && res.transcript.length > 0) {
          setTranscript((prev) => {
            if (prev.length > 0) return prev;
            return res.transcript.map((t, idx) => ({
              id: t.id || `hist_${idx}_${Date.now()}`,
              text: t.text,
              sender:
                t.speaker === "caller"
                  ? ("user" as const)
                  : ("agent" as const),
              timestamp: t.createdAt ? new Date(t.createdAt) : new Date(),
            }));
          });
        }
      } catch {
        // ignore
      }
    };

    void checkActiveCall();
    const interval = setInterval(() => {
      if (!callIdRef.current) {
        void checkActiveCall();
      }
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Clean up speech recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const startListening = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert(
        "Speech recognition is not supported in this browser. Please use text input.",
      );
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-IN";

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);
      recognition.onresult = (event: any) => {
        const text = event.results[0]?.[0]?.transcript;
        if (text) {
          setInputValue(text);
          sendTurn(text);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const handleConnect = async () => {
    if (isConnected && callId) {
      // End call
      try {
        await fetch(`${api.baseUrl}/api/calls/${callId}/end`, {
          method: "POST",
        });
      } catch (err) {
        console.error("Failed to end call:", err);
      }
      setIsConnected(false);
      setCallId(null);
      setActiveStage(0);
      setTranscript((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          text: "Call session ended.",
          sender: "system",
          timestamp: new Date(),
        },
      ]);
      return;
    }

    // Start call
    try {
      setIsLoading(true);
      const res = await fetch(`${api.baseUrl}/api/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "en" }),
      });

      if (!res.ok) throw new Error(`Failed to start call (${res.status})`);
      const data = await res.json();

      setCallId(data.callId);
      setIsConnected(true);
      setActiveStage(2);
      setTranscript([
        {
          id: Date.now().toString(),
          text: `Call connected · Case ${data.caseRef || data.callId.slice(0, 8)}. AI Voice Agent ready.`,
          sender: "system",
          timestamp: new Date(),
        },
      ]);
    } catch (err: any) {
      console.error(err);
      setTranscript((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          text: `Could not connect to API: ${err.message}. Make sure backend is running on ${api.baseUrl}.`,
          sender: "system",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendTurn = async (text: string) => {
    if (!text.trim() || !callId) return;

    const elapsed = callStartTimeRef.current
      ? formatElapsed(Date.now() - callStartTimeRef.current)
      : "00:00";
    const userMsg: Message = {
      id: Date.now().toString(),
      text,
      sender: "user",
      timestamp: new Date(),
      elapsed,
    };
    setTranscript((prev) => [...prev, userMsg]);
    setInputValue("");
    setActiveStage(3);
    setIsLoading(true);

    try {
      const res = await fetch(`${api.baseUrl}/api/calls/${callId}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, asrConfidence: 0.95 }),
      });

      if (!res.ok) throw new Error(`Turn failed (${res.status})`);
      const turn: TurnResponse = await res.json();
      setLatestTurn(turn);
      setActiveStage(4);

      const agentElapsed = callStartTimeRef.current
        ? formatElapsed(Date.now() - callStartTimeRef.current)
        : "00:05";

      setTranscript((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text: turn.reply,
          sender: "agent",
          timestamp: new Date(),
          elapsed: agentElapsed,
        },
      ]);

      if (turn.escalated) {
        setTranscript((prev) => [
          ...prev,
          {
            id: (Date.now() + 2).toString(),
            text: `[SYSTEM] Escalated to human operator: ${turn.escalationReason || "Threshold reached"} (Ref: ${turn.caseRef || "N/A"})`,
            sender: "system",
            timestamp: new Date(),
          },
        ]);
      }
    } catch (err: any) {
      setTranscript((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          text: `Error processing turn: ${err.message}`,
          sender: "system",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!isConnected || !callId) return;
    setIsLoading(true);
    try {
      const res = await api.calls.transfer(callId, "CUSTOMER_INSISTED_HUMAN");
      setTranscript((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          text: `[SYSTEM] Call transferred to human specialist. Case Ref: ${res.caseRef || "Created"}`,
          sender: "system",
          timestamp: new Date(),
        },
      ]);
      setLatestTurn((prev) =>
        prev
          ? {
              ...prev,
              escalated: true,
              escalationReason: res.reason,
              step: res.step,
              caseRef: res.caseRef,
              stateSummary: res.stateSummary || prev.stateSummary,
            }
          : null,
      );
    } catch (err: any) {
      setTranscript((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          text: `Transfer error: ${err.message}`,
          sender: "system",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const stages = [
    { label: "Agora Voice / SST Input", icon: <Mic className="size-3.5" /> },
    { label: "Agora Signalling Bus", icon: <Radio className="size-3.5" /> },
    { label: "Policy & Safety Guard", icon: <Layers className="size-3.5" /> },
    { label: "Verification Gate", icon: <Sparkles className="size-3.5" /> },
    { label: "Gemini 3.6 Decisive Brain", icon: <Bot className="size-3.5" /> },
  ];

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Engine & Live Status Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-3 text-foreground">
          <span className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />{" "}
            Agora RTC Voice
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="flex items-center gap-1.5 font-semibold text-sky-600 dark:text-sky-400">
            <span className="size-2 rounded-full bg-sky-500" /> Agora SST &
            Signalling
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="flex items-center gap-1.5 font-semibold text-purple-600 dark:text-purple-400">
            <Sparkles className="size-3" /> Gemini 3.6 Decisive Brain
          </span>
        </div>
        <a
          href="http://localhost:5174"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
        >
          Open Caller Simulator (5174) <ExternalLink className="size-3" />
        </a>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        {/* Left Column - Controls & Pipeline */}
        <div className="space-y-4">
          <SurfaceCard className="p-5 flex flex-col items-center gap-4 text-center">
            <div
              className={`size-20 rounded-full flex items-center justify-center transition-all duration-500 ${
                isConnected
                  ? "bg-emerald-500/10 border-2 border-emerald-500/30 text-emerald-500 shadow-lg shadow-emerald-500/10"
                  : "bg-muted border border-border text-muted-foreground"
              }`}
            >
              <Phone
                className={`size-8 ${isConnected ? "animate-pulse" : ""}`}
              />
            </div>

            <div>
              <h3 className="font-semibold text-sm">
                {isConnected ? "Session Active" : "Console Idle"}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {callId
                  ? `Call ${callId.slice(0, 8)}…`
                  : "Connect to test live speech turns"}
              </p>
            </div>

            <div className="flex gap-2 w-full">
              <Button
                className={`flex-1 ${
                  isConnected
                    ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                    : "bg-primary hover:bg-primary/90 text-primary-foreground"
                }`}
                onClick={handleConnect}
                disabled={isLoading}
              >
                {isConnected ? (
                  <>
                    <PhoneOff className="size-3.5 mr-1.5" /> End Call
                  </>
                ) : (
                  <>
                    <Phone className="size-3.5 mr-1.5" /> Connect
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                className="size-9 shrink-0 p-0"
                onClick={() => setIsMuted(!isMuted)}
                disabled={!isConnected}
              >
                {isMuted ? (
                  <MicOff className="size-4 text-destructive" />
                ) : (
                  <Mic className="size-4" />
                )}
              </Button>
            </div>

            <div className="flex items-center gap-2 w-full pt-2 border-t border-border">
              <Volume2 className="size-3.5 text-muted-foreground shrink-0" />
              <Slider
                value={[volume]}
                onValueChange={([v]) => setVolume(v ?? 80)}
                max={100}
                step={1}
              />
              <span className="text-[11px] text-muted-foreground w-8 text-right">
                {volume}%
              </span>
            </div>
          </SurfaceCard>

          {/* Real-time Pipeline Card */}
          <SurfaceCard className="p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <Radio className="size-3.5 text-primary" /> Audio Pipeline
            </h4>
            <div className="space-y-2">
              {stages.map((stage, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-2.5 p-2 rounded-md text-xs transition-colors ${
                    idx <= activeStage
                      ? "bg-accent/60 text-foreground font-medium"
                      : "text-muted-foreground opacity-60"
                  }`}
                >
                  <div
                    className={`size-5 rounded-full flex items-center justify-center text-[10px] ${
                      idx === activeStage
                        ? "bg-primary text-primary-foreground animate-pulse"
                        : idx < activeStage
                          ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                          : "bg-muted"
                    }`}
                  >
                    {idx < activeStage ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      stage.icon
                    )}
                  </div>
                  <span>{stage.label}</span>
                </div>
              ))}
            </div>
          </SurfaceCard>
        </div>

        {/* Middle Column - Live Transcript */}
        <SurfaceCard className="flex flex-col h-[calc(100vh-12rem)] min-h-[480px]">
          <CardHeader
            title="Interactive Transcript"
            subtitle={
              callId
                ? `Live session: ${callId}`
                : "Start a call to simulate conversations"
            }
            icon={<Bot className="size-4" />}
            actions={
              <div className="flex items-center gap-2">
                <span className="relative flex size-2">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      isConnected ? "bg-emerald-400" : "bg-muted"
                    }`}
                  />
                  <span
                    className={`relative inline-flex rounded-full size-2 ${
                      isConnected ? "bg-emerald-500" : "bg-muted-foreground"
                    }`}
                  />
                </span>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {isConnected ? "Live" : "Standby"}
                </span>
              </div>
            }
          />

          <ScrollArea className="flex-1 p-4">
            <div className="space-y-3" ref={scrollRef}>
              {transcript.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center text-center text-muted-foreground">
                  <Phone className="size-8 opacity-30 mb-2" />
                  <p className="text-xs">
                    Click "Connect" above to launch an AI session,
                  </p>
                  <p className="text-[11px] opacity-70">
                    or open the simulated customer dialer.
                  </p>
                </div>
              ) : (
                transcript.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col max-w-[85%] rounded-lg p-3 text-xs leading-relaxed ${
                      msg.sender === "user"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : msg.sender === "system"
                          ? "mx-auto bg-muted text-muted-foreground border border-border text-[11px]"
                          : "bg-accent/80 text-accent-foreground border border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      {msg.sender !== "system" && (
                        <span className="text-[10px] font-semibold opacity-70 flex items-center gap-1">
                          {msg.sender === "user" ? (
                            <User className="size-3" />
                          ) : (
                            <Bot className="size-3" />
                          )}
                          {msg.sender === "user" ? "Caller" : "Nerv AI"}
                        </span>
                      )}
                      {msg.elapsed && (
                        <span className="text-[10px] font-mono opacity-60 px-1 py-0.5 rounded bg-black/20 ml-auto">
                          {msg.elapsed}
                        </span>
                      )}
                    </div>
                    <span className="break-words">{msg.text}</span>
                  </div>
                ))
              )}
              {callerInterim && (
                <div className="ml-auto flex flex-col max-w-[85%] rounded-lg p-3 text-xs leading-relaxed bg-primary/20 border border-dashed border-primary/50 text-foreground animate-pulse">
                  <span className="text-[10px] font-semibold text-primary mb-1 flex items-center gap-1">
                    <Mic className="size-3 animate-pulse" /> Caller (speaking live...)
                  </span>
                  <span className="italic break-words">{callerInterim}</span>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="p-3 border-t border-border bg-muted/20">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendTurn(inputValue);
              }}
              className="flex gap-2"
            >
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={`size-9 shrink-0 ${
                  isListening
                    ? "text-destructive border-destructive bg-destructive/10 animate-pulse"
                    : ""
                }`}
                onClick={isListening ? stopListening : startListening}
                disabled={!isConnected}
                title="Use Microphone"
              >
                <Mic className="size-4" />
              </Button>

              <Input
                className="flex-1 text-xs"
                placeholder={
                  isConnected
                    ? "Type what the caller says…"
                    : 'Click "Connect" first'
                }
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={!isConnected || isLoading}
              />

              <Button
                type="submit"
                size="sm"
                className="px-3"
                disabled={!isConnected || !inputValue.trim() || isLoading}
              >
                <Send className="size-3.5" />
              </Button>
            </form>
          </div>
        </SurfaceCard>

        {/* Right Column - Architecture Box #4: Conversation State Manager */}
        <div className="space-y-4">
          {(() => {
            const sm = latestTurn?.stateSummary;
            const v = latestTurn?.verification;
            const intentLabel = sm?.intent.label || latestTurn?.intent.value || "Delivery complaint";
            const intentPercent = sm?.confidenceBreakdown.intentPercent ?? Math.round((latestTurn?.intent.confidence ?? 0.96) * 100);
            const languageDisplay = sm?.language.display || "Hindi + English";
            const reqProblem = sm ? sm.requiredInfo.problem : true;
            const reqCustomer = sm
              ? sm.requiredInfo.customerIdentity
              : Boolean(v?.nameMatches === true || v?.ordererName);
            const reqOrder = sm ? sm.requiredInfo.orderId : Boolean(v?.confirmed);
            const confirmedFacts = sm?.confirmedFacts?.length
              ? sm.confirmedFacts
              : [
                  { label: "Expected Delivery", value: "Aug 21" },
                  ...(v?.ordererName ? [{ label: "Customer Identity", value: v.ordererName }] : []),
                ];
            const unconfirmedFacts = sm?.unconfirmedFacts?.length
              ? sm.unconfirmedFacts
              : [
                  {
                    label: "Order ID",
                    value: v?.orderId ? `${v.orderId} (pending readback)` : "4582 / 4852",
                  },
                ];
            const orderIdPercent = sm?.confidenceBreakdown.orderIdPercent ?? (v?.confirmed ? 98 : 47);
            const attemptsCount = sm?.attempts.orderId ?? Math.max(1, v?.attempts ?? 1);
            const decision = sm?.decision ?? (orderIdPercent < 60 || (latestTurn?.humanRequestCount ?? 0) > 0 ? "ESCALATE" : "CONTINUE");

            return (
              <SurfaceCard className="p-4 space-y-3.5">
                {/* Header with Live Status & Policy Decision */}
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <div className="flex items-center gap-2 font-bold text-xs">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    <span className="uppercase tracking-wider">Current State</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${
                      decision === "CONTINUE"
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                        : "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30"
                    }`}
                  >
                    Decision: {decision}
                  </span>
                </div>

                {/* Intent & Language */}
                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-muted/40 border border-border">
                  <div>
                    <p className="text-[10px] uppercase font-semibold text-muted-foreground">Intent</p>
                    <p className="text-xs font-semibold text-foreground mt-0.5 truncate">{intentLabel}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-semibold text-muted-foreground">Language</p>
                    <p className="text-xs font-semibold text-foreground mt-0.5 truncate">{languageDisplay}</p>
                  </div>
                </div>

                {/* Required Info Checklist */}
                <div className="space-y-1.5">
                  <p className="text-[10.5px] uppercase font-semibold text-muted-foreground tracking-wide">
                    Required Info:
                  </p>
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      {reqProblem ? (
                        <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <X className="size-3.5 text-red-500 shrink-0" />
                      )}
                      <span className={reqProblem ? "text-foreground font-medium" : "text-muted-foreground"}>
                        Problem
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {reqCustomer ? (
                        <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <X className="size-3.5 text-red-500 shrink-0" />
                      )}
                      <span className={reqCustomer ? "text-foreground font-medium" : "text-muted-foreground"}>
                        Customer Identity
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {reqOrder ? (
                        <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <X className="size-3.5 text-red-500 shrink-0" />
                      )}
                      <span className={reqOrder ? "text-foreground font-medium" : "text-muted-foreground"}>
                        Order ID
                      </span>
                    </div>
                  </div>
                </div>

                {/* Confirmed Facts */}
                <div className="space-y-1.5 pt-1">
                  <p className="text-[10.5px] uppercase font-semibold text-emerald-600 dark:text-emerald-400 tracking-wide">
                    Confirmed:
                  </p>
                  <div className="space-y-1 text-xs">
                    {confirmedFacts.map((fact, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Check className="size-3 text-emerald-500 shrink-0" />
                        <span>
                          <strong className="font-semibold text-foreground">{fact.label}:</strong> {fact.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Unconfirmed Facts */}
                <div className="space-y-1.5 pt-1">
                  <p className="text-[10.5px] uppercase font-semibold text-amber-600 dark:text-amber-400 tracking-wide">
                    Unconfirmed:
                  </p>
                  <div className="space-y-1 text-xs">
                    {unconfirmedFacts.map((fact, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 p-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300"
                      >
                        <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />
                        <span>
                          <strong>{fact.label}:</strong> {fact.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* AI Confidence Breakdown */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <p className="text-[10.5px] uppercase font-semibold text-muted-foreground tracking-wide">
                    AI Confidence:
                  </p>
                  <div className="space-y-2 text-xs">
                    <div>
                      <div className="flex justify-between text-[11px] mb-1">
                        <span className="text-muted-foreground">Intent Confidence</span>
                        <span className="font-semibold">{intentPercent}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${intentPercent}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] mb-1">
                        <span className="text-muted-foreground">Order ID Confidence</span>
                        <span
                          className={`font-semibold ${
                            orderIdPercent < 60
                              ? "text-red-500"
                              : "text-emerald-500"
                          }`}
                        >
                          {orderIdPercent}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            orderIdPercent < 60 ? "bg-red-500" : "bg-emerald-500"
                          }`}
                          style={{ width: `${orderIdPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Attempts Count */}
                <div className="flex items-center justify-between p-2 rounded bg-muted/40 border border-border text-xs">
                  <span className="text-muted-foreground font-medium">Attempts (Order ID):</span>
                  <span className="font-mono font-bold px-2 py-0.5 rounded bg-muted">
                    {attemptsCount}
                  </span>
                </div>

                {/* Escalation Button */}
                {isConnected && (
                  <Button
                    variant="outline"
                    className="w-full text-xs font-semibold text-amber-600 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/15 mt-2"
                    onClick={handleTransfer}
                    disabled={isLoading}
                  >
                    <PhoneForwarded className="size-3.5 mr-1.5" /> Transfer Call to Human Specialist
                  </Button>
                )}
              </SurfaceCard>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
