import { useState, useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SurfaceCard, CardHeader } from "@/components/shared/SurfaceCard";
import { ConfidenceBadge, ReasonBadge } from "@/components/shared/Badges";
import {
  Phone,
  PhoneOff,
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
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";

export const Route = createFileRoute("/console")({
  component: ConsolePage,
});

type Message = {
  id: string;
  text: string;
  sender: "user" | "agent" | "system";
  timestamp: Date;
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
}

function ConsolePage() {
  const [isConnected, setIsConnected] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [activeStage, setActiveStage] = useState(0);
  const [transcript, setTranscript] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [latestTurn, setLatestTurn] = useState<TurnResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript]);

  // Connect to live Agora Signalling stream from backend
  useEffect(() => {
    let sse: EventSource | null = null;
    try {
      sse = new EventSource(`${api.baseUrl}/api/agora/signalling/stream`);
      sse.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === "caller_utterance" && data.payload?.text) {
            setTranscript((prev) => {
              if (prev.some((m) => m.id === data.id)) return prev;
              return [
                ...prev,
                {
                  id: data.id ?? Date.now().toString(),
                  text: String(data.payload.text),
                  sender: "user",
                  timestamp: new Date(data.timestamp ?? Date.now()),
                },
              ];
            });
            setActiveStage(1);
          } else if (data.event === "agent_reply" && data.payload?.reply) {
            setTranscript((prev) => {
              if (prev.some((m) => m.id === data.id)) return prev;
              return [
                ...prev,
                {
                  id: data.id ?? Date.now().toString(),
                  text: String(data.payload.reply),
                  sender: "agent",
                  timestamp: new Date(data.timestamp ?? Date.now()),
                },
              ];
            });
            setActiveStage(4);
          } else if (data.event === "escalation_triggered") {
            setTranscript((prev) => [
              ...prev,
              {
                id: data.id ?? Date.now().toString(),
                text: `[AGORA SIGNALLING] Escalated to human: ${data.payload?.reason || "Threshold reached"} (Case: ${data.payload?.caseRef || "Pending"})`,
                sender: "system",
                timestamp: new Date(),
              },
            ]);
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
          text: `Session started (${data.callId.slice(0, 8)}…). AI Agent ready.`,
          sender: "system",
          timestamp: new Date(),
        },
        {
          id: (Date.now() + 1).toString(),
          text:
            data.greeting ||
            "Hi, thanks for calling. I can help you check your order status, assist with delivery or product issues, or connect you with a customer service agent. How can I help today?",
          sender: "agent",
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

    const userMsg: Message = {
      id: Date.now().toString(),
      text,
      sender: "user",
      timestamp: new Date(),
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

      setTranscript((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text: turn.reply,
          sender: "agent",
          timestamp: new Date(),
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

  const handleEscalate = async () => {
    if (!isConnected || !callId) return;
    await sendTurn("I want to speak to a human supervisor immediately");
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
                    {msg.sender !== "system" && (
                      <span className="text-[10px] font-semibold opacity-70 mb-1 flex items-center gap-1">
                        {msg.sender === "user" ? (
                          <User className="size-3" />
                        ) : (
                          <Bot className="size-3" />
                        )}
                        {msg.sender === "user" ? "Caller" : "Nerv AI"}
                      </span>
                    )}
                    <span className="break-words">{msg.text}</span>
                  </div>
                ))
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

        {/* Right Column - State & Data Extraction */}
        <div className="space-y-4">
          <SurfaceCard className="p-4 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Intent Detection</span>
              {latestTurn?.step && (
                <span className="px-2 py-0.5 rounded text-[10px] bg-muted font-normal capitalize">
                  {latestTurn.step}
                </span>
              )}
            </h4>

            {latestTurn ? (
              <div className="space-y-2">
                <div className="p-2.5 rounded-md bg-muted/50 border border-border">
                  <p className="text-[11px] text-muted-foreground">
                    Classified Intent
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs font-semibold text-foreground">
                      {latestTurn.intent.value || "General inquiry"}
                    </span>
                    <ConfidenceBadge
                      score={latestTurn.intent.confidence || 0.9}
                    />
                  </div>
                </div>

                <div className="p-2.5 rounded-md bg-muted/50 border border-border">
                  <p className="text-[11px] text-muted-foreground">
                    Human Handover Policy
                  </p>
                  <p className="text-xs mt-1">
                    Requests for human:{" "}
                    <span className="font-semibold text-foreground">
                      {latestTurn.humanRequestCount} / 3
                    </span>
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic py-3">
                Entities and intents will be extracted as the conversation
                unfolds.
              </p>
            )}
          </SurfaceCard>

          <SurfaceCard className="p-4 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 text-amber-500" /> Verification
              State
            </h4>

            {latestTurn?.verification ? (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between p-2 rounded bg-muted/40 border border-border">
                  <span className="text-muted-foreground">Order ID:</span>
                  <span className="font-mono font-semibold">
                    {latestTurn.verification.orderId || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-muted/40 border border-border">
                  <span className="text-muted-foreground">Orderer Name:</span>
                  <span className="font-medium">
                    {latestTurn.verification.ordererName || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-muted/40 border border-border">
                  <span className="text-muted-foreground">Confirmed:</span>
                  <span
                    className={
                      latestTurn.verification.confirmed
                        ? "text-emerald-500"
                        : "text-muted-foreground"
                    }
                  >
                    {latestTurn.verification.confirmed ? "Yes" : "No"}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic py-3">
                Order ID verification and caller matching appear here.
              </p>
            )}

            {isConnected && (
              <Button
                variant="outline"
                className="w-full text-xs text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10 mt-2"
                onClick={handleEscalate}
              >
                Simulate Escalate Request
              </Button>
            )}
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
}
