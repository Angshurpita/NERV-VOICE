import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Send,
  Volume2,
  Radio,
  Sparkles,
  Cpu,
} from "lucide-react";
import type { LanguageCode } from "@echosphere/core";
import {
  api,
  type Scenario,
  type TurnResponse,
  type VerificationState,
} from "./api";
import { agoraCallManager } from "./agoraClient";

type Turn = { id: number; who: "caller" | "agent" | "system"; text: string };
type Phase =
  | "idle"
  | "connecting"
  | "starting_agent"
  | "connected"
  | "listening"
  | "caller_speaking"
  | "processing"
  | "agent_speaking"
  | "escalating"
  | "ending"
  | "ended"
  | "error";

let turnId = 0;

export default function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [language, setLanguage] = useState<LanguageCode>("en");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [typed, setTyped] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<TurnResponse | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [apiUp, setApiUp] = useState<boolean | null>(null);
  const [agoraStatus, setAgoraStatus] = useState<{
    enabled: boolean;
    appId: string | null;
    capabilities?: {
      voiceRtc: boolean;
      speechToTextSst: boolean;
      conversationalAi: boolean;
      signallingRtm: boolean;
      cloudAgentConfigured?: boolean;
    };
    activeSessions?: number;
  } | null>(null);
  const [agoraConnected, setAgoraConnected] = useState(false);
  const [agentActive, setAgentActive] = useState(false);
  const [agoraChannel, setAgoraChannel] = useState<string | null>(null);
  const [audioVolume, setAudioVolume] = useState(0);
  const [modelName, setModelName] = useState<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("idle");
  const micRef = useRef(false);
  const callIdRef = useRef<string | null>(null);
  const unsubscribeSignallingRef = useRef<(() => void) | null>(null);

  phaseRef.current = phase;
  micRef.current = micOn;
  callIdRef.current = callId;

  useEffect(() => {
    api
      .health()
      .then((h) => {
        setApiUp(true);
        if (h.model) setModelName(h.model);
      })
      .catch(() => setApiUp(false));
    api
      .scenarios()
      .then((r) => setScenarios(r.scenarios))
      .catch(() => setScenarios([]));
    api
      .agoraStatus()
      .then(setAgoraStatus)
      .catch(() => setAgoraStatus(null));

    agoraCallManager.onVolume = (vol) => {
      setAudioVolume(vol);
      if (vol > 20 && phaseRef.current === "listening") {
        setPhase("caller_speaking");
      } else if (vol <= 20 && phaseRef.current === "caller_speaking") {
        setPhase("listening");
      }
    };

    agoraCallManager.onRemoteUserJoined = () => {
      setAgentActive(true);
    };

    agoraCallManager.onError = (err) => {
      setError(err.message);
      setPhase("error");
    };

    return () => {
      if (unsubscribeSignallingRef.current) {
        unsubscribeSignallingRef.current();
      }
    };
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns]);

  const push = useCallback((who: Turn["who"], text: string) => {
    setTurns((prev) => {
      // Avoid duplicate consecutive messages
      const last = prev[prev.length - 1];
      if (last && last.who === who && last.text.trim() === text.trim()) {
        return prev;
      }
      return [...prev, { id: ++turnId, who, text }];
    });
  }, []);

  /**
   * Simulation / Test Text Turn.
   * Designated strictly for debugging deterministic policy logic without audio.
   * Real voice conversation proceeds automatically from the caller's microphone into Agora RTC.
   */
  const sendText = useCallback(
    async (text: string, confidence = 1) => {
      const trimmed = text.trim();
      if (!trimmed || !callId) return;

      push("caller", trimmed);
      setPhase("processing");
      setError(null);

      try {
        const result = await api.turn(callId, trimmed, confidence);
        setLatest(result);
        setLanguage(result.language);
        push("agent", result.reply);

        if (phaseRef.current !== "ended") {
          setTimeout(() => {
            if (
              phaseRef.current === "processing" ||
              phaseRef.current === "agent_speaking"
            ) {
              setPhase("listening");
            }
          }, 1500);
        }

        if (result.escalated) {
          push(
            "system",
            result.caseRef
              ? `Handed to a human agent — case ${result.caseRef}`
              : "Handed to a human agent",
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
        setPhase("listening");
      }
    },
    [callId, agoraChannel, push],
  );

  const startCall = async () => {
    setPhase("connecting");
    setError(null);
    setTurns([]);
    setLatest(null);
    setAgentActive(false);

    try {
      // 1. Initialize Call record on backend
      const call = await api.startCall(language);
      setCallId(call.callId);
      push("system", `Connected · case ${call.caseRef}`);
      push("agent", call.greeting);

      const targetChannel = call.channelName || `nerv_${call.callId}`;
      setAgoraChannel(targetChannel);

      // 2. Obtain real Agora credentials & tokens
      setPhase("starting_agent");
      const agora = await api.getAgoraChannel(targetChannel);

      // 3. Connect to real-time signalling SSE stream
      if (unsubscribeSignallingRef.current) {
        unsubscribeSignallingRef.current();
      }
      unsubscribeSignallingRef.current = api.subscribeSignalling(
        call.callId,
        (sig) => {
          if (!sig || !sig.event) return;

          switch (sig.event) {
            case "caller_utterance": {
              const callerSpeech = String(sig.payload?.text || "").trim();
              if (callerSpeech) {
                push("caller", callerSpeech);
                setPhase("processing");
              }
              break;
            }
            case "gemini_thinking": {
              setPhase("processing");
              break;
            }
            case "agent_reply": {
              const agentSpeech = String(sig.payload?.reply || "").trim();
              if (agentSpeech) {
                push("agent", agentSpeech);
                setPhase("agent_speaking");
                setTimeout(() => {
                  if (phaseRef.current === "agent_speaking") {
                    setPhase("listening");
                  }
                }, 3000);
              }
              if (sig.payload?.confidence !== undefined || sig.payload?.step) {
                setLatest((prev) => ({
                  ...(prev || {
                    reply: agentSpeech,
                    language: (sig.payload?.language as LanguageCode) || "en",
                    escalated: Boolean(sig.payload?.escalated),
                    escalationReason: (sig.payload?.reason as string) || null,
                    caseRef: (sig.payload?.caseRef as string) || null,
                    step: (sig.payload?.step as string) || "",
                    verification: {
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
                      value: (sig.payload?.intent as string) || "unknown",
                      confidence: Number(sig.payload?.confidence || 0),
                    },
                    confidence: Number(sig.payload?.confidence || 0),
                    humanRequestCount: 0,
                  }),
                  step: (sig.payload?.step as string) || prev?.step || "",
                  confidence: Number(
                    sig.payload?.confidence ?? prev?.confidence ?? 0,
                  ),
                  caseRef:
                    (sig.payload?.caseRef as string) || prev?.caseRef || null,
                }));
              }
              break;
            }
            case "escalation_triggered": {
              push(
                "system",
                sig.payload?.caseRef
                  ? `Handed to a human agent — case ${sig.payload.caseRef}`
                  : "Handed to a human agent",
              );
              setPhase("escalating");
              break;
            }
            case "call_ended": {
              setPhase("ended");
              break;
            }
          }
        },
      );

      // 4. Start real Agora Conversational AI Agent in the channel
      const agentRes = await api.startCloudAgent(
        agora.channelName,
        call.language,
        call.greeting,
        call.callId,
      );

      if (!agentRes.ok) {
        throw new Error(
          agentRes.message ||
            agentRes.error ||
            "Agora Conversational Agent could not be started.",
        );
      }
      setAgentActive(true);

      // 5. Join Agora RTC channel and publish genuine microphone audio
      // This will throw if microphone permission is denied or device fails.
      await agoraCallManager.join({
        appId: agora.appId,
        channelName: agora.channelName,
        uid: agora.uid,
        rtcToken: agora.rtcToken,
        rtmToken: agora.rtmToken,
      });
      setAgoraConnected(true);

      // 6. Ready for natural spoken voice conversation!
      setPhase("listening");
      setMicOn(true);
      micRef.current = true;
    } catch (e) {
      setPhase("idle");
      setAgoraConnected(false);
      setAgentActive(false);
      await agoraCallManager.leave().catch(() => undefined);
      setError(e instanceof Error ? e.message : "Could not connect call");
    }
  };

  const hangUp = async () => {
    setPhase("ending");
    phaseRef.current = "ending";
    setMicOn(false);
    micRef.current = false;

    if (unsubscribeSignallingRef.current) {
      unsubscribeSignallingRef.current();
      unsubscribeSignallingRef.current = null;
    }

    try {
      if (agoraChannel) {
        await api
          .stopCloudAgent(agoraChannel, undefined, callId || undefined)
          .catch(() => null);
      }
      await agoraCallManager.leave();
    } catch {
      // ignore
    }
    setAgoraConnected(false);
    setAgentActive(false);
    setAgoraChannel(null);
    setAudioVolume(0);

    if (callId) {
      try {
        const result = await api.endCall(callId);
        push("system", `Call ended · ${result.durationSeconds ?? 0}s`);
      } catch {
        push("system", "Call ended");
      }
    }
    setCallId(null);
    setPhase("ended");
    setTimeout(() => setPhase("idle"), 600);
  };

  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    micRef.current = next;
    agoraCallManager.setMute(!next);
  };

  const live = callId !== null && phase !== "ended" && phase !== "idle";

  return (
    <>
      <header className="brand">
        <div>
          <h1>Nerv · Customer Line</h1>
          <div className="sub">
            {apiUp === false
              ? "Support line unreachable"
              : live
                ? "Call in progress"
                : "Not connected"}
          </div>
        </div>
        <div className="seg" role="group" aria-label="Language">
          <button
            aria-pressed={language === "en"}
            onClick={() => setLanguage("en")}
            disabled={live}
          >
            English
          </button>
          <button
            aria-pressed={language === "hi"}
            onClick={() => setLanguage("hi")}
            disabled={live}
          >
            हिन्दी
          </button>
        </div>
      </header>

      <div className="app">
        <main>
          {apiUp === false && (
            <div className="card">
              <div className="banner error" style={{ margin: 18 }}>
                <AlertTriangle size={15} />
                <span>
                  Cannot reach the support API at <code>{api.baseUrl}</code>.
                  Start it with <code>npm run dev:api</code>.
                </span>
              </div>
            </div>
          )}

          <div className="card">
            <div className="dialer">
              <div
                className={`orb ${live ? "live" : ""} ${phase === "agent_speaking" ? "speaking" : ""} ${
                  (phase === "listening" || phase === "caller_speaking") &&
                  micOn
                    ? "listening"
                    : ""
                }`}
              >
                <div className="orb-core">
                  {phase === "agent_speaking" ? (
                    <Volume2 size={26} />
                  ) : (
                    <Phone size={26} />
                  )}
                </div>
              </div>

              <div className="status-line">
                <div className="state">
                  {stateLabel(phase, micOn, agentActive)}
                </div>
                {latest?.step && live && (
                  <div className="step">{latest.step}</div>
                )}
              </div>

              <div className="row">
                {live ? (
                  <button className="hangup" onClick={hangUp}>
                    <PhoneOff size={18} /> End call
                  </button>
                ) : (
                  <button
                    className="call"
                    onClick={startCall}
                    disabled={
                      phase === "connecting" ||
                      phase === "starting_agent" ||
                      apiUp === false
                    }
                  >
                    <Phone size={18} />
                    {phase === "connecting" || phase === "starting_agent"
                      ? "Connecting…"
                      : "Call support"}
                  </button>
                )}
                {live && (
                  <button
                    className={`mic ${micOn ? "active" : ""}`}
                    onClick={toggleMic}
                    title={micOn ? "Mute microphone" : "Unmute microphone"}
                  >
                    {micOn ? <Mic size={17} /> : <MicOff size={17} />}
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="banner error">
                <AlertTriangle size={15} />
                <span>{error}</span>
              </div>
            )}

            <div className="banner info">
              <Info size={15} />
              <span>
                Real voice is handled end-to-end by the Agora Conversational AI
                Agent & EchoSphere brain. Speak into your microphone naturally.
              </span>
            </div>

            <div className="meta" style={{ flexWrap: "wrap", gap: "8px 16px" }}>
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <Radio
                  size={13}
                  color={agoraConnected ? "#10b981" : "#6b7280"}
                />
                <b>Agora RTC</b>{" "}
                <span style={{ color: agoraConnected ? "#10b981" : "inherit" }}>
                  {agoraConnected
                    ? agoraChannel
                      ? `Live (${agoraChannel})`
                      : "Connected"
                    : agoraStatus?.enabled
                      ? "Ready"
                      : "Not configured"}
                </span>
              </span>
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <Mic size={13} color={micOn ? "#10b981" : "#6b7280"} />
                <b>Agora Voice</b>{" "}
                <span>
                  {micOn ? `Microphone Live (${audioVolume}%)` : "Muted"}
                </span>
              </span>
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <Cpu size={13} color={agentActive ? "#10b981" : "#6366f1"} />
                <b>Agora Agent</b>{" "}
                <span style={{ color: agentActive ? "#10b981" : "#6366f1" }}>
                  {agentActive ? "Active (Conversational AI)" : "Ready"}
                </span>
              </span>
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <Sparkles size={13} color="#8b5cf6" />
                <b>EchoSphere Brain</b>{" "}
                <span style={{ color: "#8b5cf6" }}>
                  {modelName ?? "Deterministic Policy"}
                </span>
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Conversation</h2>
              {latest && (
                <span className="tag contained">
                  confidence {Math.round(latest.confidence * 100)}%
                </span>
              )}
            </div>

            <div className="transcript" ref={transcriptRef}>
              {turns.length === 0 && (
                <div className="bubble system">
                  Press "Call support" to start. Speak into your microphone once
                  connected, or pick a scenario on the right.
                </div>
              )}
              {turns.map((t) => (
                <div key={t.id} className={`bubble ${t.who}`}>
                  {t.who !== "system" && (
                    <span className="who">
                      {t.who === "caller" ? "You" : "Agent"}
                    </span>
                  )}
                  {t.text}
                </div>
              ))}
            </div>

            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                const text = typed;
                setTyped("");
                void sendText(text);
              }}
            >
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={
                  live
                    ? "Type a message (optional debug text fallback)…"
                    : "Start a call first"
                }
                disabled={!live || phase === "processing"}
              />
              <button
                className="primary"
                type="submit"
                disabled={!live || !typed.trim()}
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        </main>

        <aside>
          {latest && (
            <div className="card">
              <div className="card-head">
                <h2>Verification</h2>
              </div>
              <VerificationChecks
                v={latest.verification}
                humanRequests={latest.humanRequestCount}
              />
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h2>Test scenarios</h2>
              <span
                className="sub"
                style={{ fontSize: 11.5, color: "var(--text-subtle)" }}
              >
                {scenarios.length}
              </span>
            </div>
            <div className="scenarios">
              {scenarios.length === 0 && (
                <div
                  style={{
                    color: "var(--text-subtle)",
                    fontSize: 12.5,
                    padding: 4,
                  }}
                >
                  Scenarios load from the API.
                </div>
              )}
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  className="scenario"
                  disabled={!live}
                  onClick={() => {
                    if (s.language !== language) setLanguage(s.language);
                    void sendText(s.say);
                  }}
                  title={live ? "Send this line" : "Start a call first"}
                >
                  <div className="title">
                    <span>{s.title}</span>
                    <span
                      className={`tag ${s.escalates ? "escalates" : "contained"}`}
                    >
                      {s.escalates ? "human" : "AI"}
                    </span>
                  </div>
                  <div className="say">"{s.say}"</div>
                  <div className="expect">{s.expect}</div>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function VerificationChecks({
  v,
  humanRequests,
}: {
  v: VerificationState;
  humanRequests: number;
}) {
  const steps = [
    {
      label: v.orderId ? `Order number ${v.orderId}` : "Order number",
      done: Boolean(v.orderId),
      fail: false,
    },
    {
      label:
        v.lookupOutcome === "found"
          ? "Order found"
          : v.lookupOutcome === "not_found"
            ? "Order not recognised"
            : v.lookupOutcome === "backend_unavailable"
              ? "Order service unavailable"
              : "Order lookup",
      done: v.lookupOutcome === "found",
      fail:
        v.lookupOutcome === "not_found" ||
        v.lookupOutcome === "backend_unavailable",
    },
    {
      label:
        v.nameMatches === true
          ? `Name matches${v.ordererName ? ` · ${v.ordererName}` : ""}`
          : "Name on the order",
      done: v.nameMatches === true,
      fail: v.nameMatches === false,
    },
    { label: "Details read back", done: v.readBack, fail: false },
    { label: "Confirmed by you", done: v.confirmed, fail: false },
  ];

  return (
    <div className="checks">
      {steps.map((s) => (
        <div
          key={s.label}
          className={`check ${s.done ? "done" : ""} ${s.fail ? "fail" : ""}`}
        >
          <span className="dot">
            {s.done ? <CheckCircle2 size={11} /> : s.fail ? "!" : ""}
          </span>
          {s.label}
        </div>
      ))}
      {humanRequests > 0 && (
        <div className="check" style={{ marginTop: 4 }}>
          <span className="dot">{humanRequests}</span>
          {humanRequests >= 3
            ? "Handing over"
            : `Asked for a human ${humanRequests}×`}
        </div>
      )}
    </div>
  );
}

function stateLabel(
  phase: Phase,
  micOn: boolean,
  agentActive: boolean,
): string {
  switch (phase) {
    case "idle":
      return "Ready to call";
    case "connecting":
      return "Connecting to EchoSphere…";
    case "starting_agent":
      return "Starting Agora Conversational AI Agent…";
    case "connected":
      return agentActive
        ? "Connected · Agora Agent Active"
        : "Connecting Agora RTC…";
    case "listening":
      return micOn ? "Listening via Agora RTC" : "Microphone muted";
    case "caller_speaking":
      return "Caller speaking into microphone…";
    case "processing":
      return "EchoSphere brain processing…";
    case "agent_speaking":
      return "Agora Agent speaking";
    case "escalating":
      return "Escalating to human agent…";
    case "ending":
      return "Ending call…";
    case "ended":
      return "Call ended";
    case "error":
      return "Call connection failed";
  }
}
