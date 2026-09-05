import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  PhoneForwarded,
  Send,
  Volume2,
  Radio,
  Sparkles,
  Cpu,
  Check,
  X,
  ShieldCheck,
  Activity,
} from "lucide-react";
import type { LanguageCode } from "@echosphere/core";
import {
  api,
  type FormattedConversationState,
  type Scenario,
  type TurnResponse,
  type VerificationState,
} from "./api";
import { agoraCallManager } from "./agoraClient";

type Turn = {
  id: number;
  who: "caller" | "agent" | "system";
  text: string;
  elapsed?: string;
};
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

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

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
  const [liveTranscript, setLiveTranscript] = useState<string>("");

  const transcriptRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("idle");
  const micRef = useRef(false);
  const callIdRef = useRef<string | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const unsubscribeSignallingRef = useRef<(() => void) | null>(null);
  const lastInterimSentRef = useRef<number>(0);

  phaseRef.current = phase;
  micRef.current = micOn;
  callIdRef.current = callId;

  const ARCH_SCENARIO: Scenario = {
    id: "arch-demo-diagram",
    title: "1. Architecture Demo · Delivery & Ambiguous Order",
    orderId: "4852",
    customerName: "Rahul Sharma",
    say: "Hello... mera order kal aana tha... it hasn't arrived yet... order number is 4582... no sorry, 4852.",
    expect: "Intent: Delivery complaint · Order ID ambiguous (4582 / 4852) · Escalates to Human",
    escalates: true,
    language: "hi",
    tags: ["multilingual", "ambiguity", "escalation"],
  };

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
      .then((r) => setScenarios([ARCH_SCENARIO, ...r.scenarios]))
      .catch(() => setScenarios([ARCH_SCENARIO]));
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

    agoraCallManager.onStreamMessage = (data: any) => {
      const text =
        data?.text ||
        data?.content ||
        data?.words ||
        data?.message ||
        (typeof data === "string" ? data : "");
      if (text && typeof text === "string" && text.trim()) {
        const isUser =
          data?.type === "user" ||
          data?.speaker === "user" ||
          data?.role === "user" ||
          data?.from === "caller";
        const sender = isUser ? "caller" : "agent";
        push(sender, text.trim());
      }
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
  }, [turns, liveTranscript, phase]);

  const push = useCallback((who: Turn["who"], text: string, elapsedOverride?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const elapsed =
      elapsedOverride ||
      (callStartTimeRef.current
        ? formatElapsed(Date.now() - callStartTimeRef.current)
        : "00:00");
    setTurns((prev) => {
      // Avoid duplicate consecutive/recent messages from same speaker
      const recent = prev.slice(-3);
      if (
        recent.some(
          (m) =>
            m.who === who &&
            m.text.trim().toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        return prev;
      }
      return [...prev, { id: ++turnId, who, text: trimmed, elapsed }];
    });
  }, []);

  const sendText = useCallback(
    async (text: string, confidence = 1) => {
      const trimmed = text.trim();
      const currentCallId = callIdRef.current;
      if (!trimmed || !currentCallId) return;

      setLiveTranscript("");
      push("caller", trimmed);
      setPhase("processing");
      setError(null);

      try {
        const result = await api.turn(currentCallId, trimmed, confidence);
        setLatest(result);
        setLanguage(result.language);
        push("agent", result.reply);

        if (phaseRef.current !== "ended") {
          setPhase("agent_speaking");
          // Fallback speech synthesis if Agora remote audio is not active
          if (!agoraCallManager.hasRemoteAudio && "speechSynthesis" in window) {
            try {
              window.speechSynthesis.cancel();
              const utter = new SpeechSynthesisUtterance(result.reply);
              utter.lang = result.language === "hi" ? "hi-IN" : "en-US";
              utter.onend = () => {
                if (phaseRef.current === "agent_speaking") {
                  setPhase("listening");
                }
              };
              window.speechSynthesis.speak(utter);
            } catch {
              // ignore
            }
          }
          setTimeout(() => {
            if (phaseRef.current === "agent_speaking") {
              setPhase("listening");
            }
          }, 2500);
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
    [push],
  );

  // Real-time voice capture via browser Speech Recognition
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const recognitionActiveRef = useRef(false);

  const stopVoiceRecognition = useCallback(() => {
    isListeningRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  }, []);

  const startVoiceRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn("[Voice] Web Speech API not supported in this browser.");
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = language === "hi" ? "hi-IN" : "en-US";
      rec.maxAlternatives = 1;

      let debounceTimer: any = null;
      let lastSentText = "";
      let latestInterim = "";

      rec.onstart = () => {
        recognitionActiveRef.current = true;
      };

      rec.onresult = (event: any) => {
        // Ignore speech while agent is speaking or processing
        if (
          phaseRef.current === "agent_speaking" ||
          phaseRef.current === "processing" ||
          phaseRef.current === "ended"
        ) {
          return;
        }

        let interim = "";
        let final = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            final += res[0].transcript;
          } else {
            interim += res[0].transcript;
          }
        }

        const candidateFinal = final.trim();
        const candidateInterim = interim.trim();

        if (candidateInterim && phaseRef.current === "listening") {
          setPhase("caller_speaking");
        }

        if (candidateInterim) {
          setLiveTranscript(candidateInterim);
          const now = Date.now();
          if (now - lastInterimSentRef.current > 350 && callIdRef.current) {
            lastInterimSentRef.current = now;
            api
              .publishSignalling(callIdRef.current, "caller_interim", {
                callId: callIdRef.current,
                text: candidateInterim,
              })
              .catch(() => {});
          }
        }

        if (candidateFinal && candidateFinal !== lastSentText) {
          clearTimeout(debounceTimer);
          lastSentText = candidateFinal;
          latestInterim = "";
          setLiveTranscript("");
          sendText(candidateFinal);
        } else if (candidateInterim) {
          latestInterim = candidateInterim;
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            if (
              latestInterim.trim() &&
              latestInterim.trim() !== lastSentText &&
              phaseRef.current === "caller_speaking"
            ) {
              const toSend = latestInterim.trim();
              lastSentText = toSend;
              latestInterim = "";
              setLiveTranscript("");
              sendText(toSend);
            }
          }, 400);
        }
      };

      rec.onerror = (event: any) => {
        if (event.error !== "no-speech") {
          console.warn("[Voice] Speech recognition error:", event.error);
        }
      };

      rec.onend = () => {
        recognitionActiveRef.current = false;
        if (
          isListeningRef.current &&
          micRef.current &&
          phaseRef.current !== "ended" &&
          phaseRef.current !== "idle"
        ) {
          try {
            rec.start();
          } catch {
            // ignore
          }
        }
      };

      recognitionRef.current = rec;
      rec.start();
      isListeningRef.current = true;
    } catch (err) {
      console.warn("[Voice] Failed to start speech recognition:", err);
    }
  }, [language, sendText]);

  const startCall = async () => {
    setPhase("connecting");
    setError(null);
    setTurns([]);
    setLatest(null);
    setAgentActive(false);

    try {
      callStartTimeRef.current = Date.now();
      // 1. Initialize Call record on backend
      const call = await api.startCall(language);
      setCallId(call.callId);
      callIdRef.current = call.callId;
      push("system", `Connected · case ${call.caseRef}`);
      if (call.greeting && call.greeting.trim()) {
        push("agent", call.greeting.trim());
      }

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
              if (
                sig.payload?.confidence !== undefined ||
                sig.payload?.step ||
                sig.payload?.stateSummary
              ) {
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
                  stateSummary:
                    sig.payload?.stateSummary || prev?.stateSummary || undefined,
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
              if (sig.payload?.stateSummary) {
                setLatest((prev) =>
                  prev
                    ? {
                        ...prev,
                        stateSummary: sig.payload.stateSummary,
                        escalated: true,
                        caseRef: sig.payload.caseRef || prev.caseRef,
                      }
                    : prev,
                );
              }
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
        undefined, // Leave unset so Agora Console configured welcome message is used
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
      try {
        await agoraCallManager.join({
          appId: agora.appId,
          channelName: agora.channelName,
          uid: agora.uid,
          rtcToken: agora.rtcToken,
          rtmToken: agora.rtmToken,
        });
        setAgoraConnected(true);
      } catch (rtcErr: any) {
        console.warn("[Agora RTC] Direct RTC join failed:", rtcErr);
        setAgoraConnected(false);
      }

      // 6. Ready for natural spoken voice conversation!
      setPhase("listening");
      setMicOn(true);
      micRef.current = true;
      startVoiceRecognition();
    } catch (e) {
      setPhase("idle");
      setAgoraConnected(false);
      setAgentActive(false);
      stopVoiceRecognition();
      await agoraCallManager.leave().catch(() => undefined);
      setError(e instanceof Error ? e.message : "Could not connect call");
    }
  };

  const handleTransfer = async () => {
    const currentCallId = callIdRef.current;
    if (!currentCallId) return;
    setPhase("escalating");
    try {
      const res = await api.transferCall(
        currentCallId,
        "CUSTOMER_INSISTED_HUMAN",
      );
      push("agent", res.reply);
      push(
        "system",
        res.caseRef
          ? `Transferred to human specialist — case ${res.caseRef}`
          : "Transferred to human specialist",
      );
      if ("speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(res.reply);
          utter.lang = res.language === "hi" ? "hi-IN" : "en-US";
          window.speechSynthesis.speak(utter);
        } catch {
          // ignore
        }
      }
    } catch (e: any) {
      setError(e.message || "Transfer failed");
      setPhase("listening");
    }
  };

  const hangUp = async () => {
    setPhase("ending");
    phaseRef.current = "ending";
    setMicOn(false);
    micRef.current = false;
    callStartTimeRef.current = null;
    stopVoiceRecognition();
    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }

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
    if (!next) {
      stopVoiceRecognition();
    } else if (phase !== "ended" && phase !== "idle") {
      startVoiceRecognition();
    }
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

              {/* Block #2: Agora Real-Time Layer Audio Waveform */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "3px",
                  height: "26px",
                  margin: "8px 0 4px",
                }}
              >
                {Array.from({ length: 24 }).map((_, i) => {
                  const isSpeaking =
                    phase === "caller_speaking" || phase === "agent_speaking";
                  const barHeight = isSpeaking
                    ? Math.max(
                        4,
                        Math.min(
                          24,
                          Math.sin(i * 0.6 + (audioVolume || 20) * 0.1) * 8 +
                            12 +
                            (audioVolume > 0 ? audioVolume * 0.15 : 4),
                        ),
                      )
                    : live
                      ? 4
                      : 2;
                  return (
                    <span
                      key={i}
                      style={{
                        width: "3px",
                        height: `${barHeight}px`,
                        backgroundColor:
                          phase === "caller_speaking"
                            ? "#06b6d4"
                            : phase === "agent_speaking"
                              ? "#8b5cf6"
                              : live
                                ? "#10b981"
                                : "var(--border-strong)",
                        borderRadius: "2px",
                        transition: "height 0.12s ease",
                      }}
                    />
                  );
                })}
              </div>

              {/* Block #2: Agora Capabilities */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                  justifyContent: "center",
                  marginBottom: "14px",
                  fontSize: "11px",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "2px 7px",
                    background: "rgba(16, 185, 129, 0.1)",
                    color: "#059669",
                    borderRadius: "4px",
                    fontWeight: 500,
                  }}
                >
                  <Activity size={11} /> RTC / Voice AI
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "2px 7px",
                    background: "rgba(99, 102, 241, 0.1)",
                    color: "#4f46e5",
                    borderRadius: "4px",
                    fontWeight: 500,
                  }}
                >
                  <Volume2 size={11} /> High Quality Audio
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "2px 7px",
                    background: "rgba(14, 165, 233, 0.1)",
                    color: "#0284c7",
                    borderRadius: "4px",
                    fontWeight: 500,
                  }}
                >
                  <ShieldCheck size={11} /> Noise & Echo Suppression
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "2px 7px",
                    background: "rgba(245, 158, 11, 0.1)",
                    color: "#d97706",
                    borderRadius: "4px",
                    fontWeight: 500,
                  }}
                >
                  ⚡ &lt;180ms Latency
                </span>
              </div>

              <div className="row">
                {live ? (
                  <>
                    <button className="hangup" onClick={hangUp}>
                      <PhoneOff size={18} /> End call
                    </button>
                    <button
                      className="transfer-btn"
                      onClick={handleTransfer}
                      title="Transfer to Human Specialist"
                      style={{
                        background: "rgba(245, 158, 11, 0.15)",
                        border: "1px solid rgba(245, 158, 11, 0.4)",
                        color: "#f59e0b",
                        borderRadius: "8px",
                        padding: "8px 14px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      <PhoneForwarded size={16} /> Transfer
                    </button>
                  </>
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
              {turns.length === 0 && !liveTranscript && (
                <div className="bubble system">
                  Press "Call support" to start. Speak into your microphone once
                  connected, or pick a scenario on the right.
                </div>
              )}
              {turns.map((t) => (
                <div key={t.id} className={`bubble ${t.who}`}>
                  {t.who !== "system" && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "3px",
                      }}
                    >
                      <span className="who" style={{ margin: 0 }}>
                        {t.who === "caller" ? "You" : "Agora Agent"}
                      </span>
                      {t.elapsed && (
                        <span
                          style={{
                            fontSize: "10.5px",
                            opacity: 0.65,
                            fontFamily: "monospace",
                            fontWeight: 600,
                          }}
                        >
                          {t.elapsed}
                        </span>
                      )}
                    </div>
                  )}
                  {t.text}
                </div>
              ))}
              {liveTranscript && (
                <div
                  className="bubble caller interim animate-pulse"
                  style={{
                    borderStyle: "dashed",
                    borderColor: "#06b6d4",
                    background: "rgba(6, 182, 212, 0.12)",
                  }}
                >
                  <span
                    className="who"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      color: "#06b6d4",
                    }}
                  >
                    <Mic size={12} className="animate-pulse" /> You (speaking live...)
                  </span>
                  {liveTranscript}
                </div>
              )}
              {phase === "processing" && (
                <div
                  className="bubble agent thinking"
                  style={{
                    opacity: 0.85,
                    fontStyle: "italic",
                    borderStyle: "dotted",
                  }}
                >
                  <span className="who">Agent</span>
                  Thinking…
                </div>
              )}
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
          <div className="card">
            <div className="card-head">
              <h2 style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Cpu size={15} color="#8b5cf6" />
                Conversation State Manager
              </h2>
            </div>
            {latest ? (
              <ConversationStateManagerCard
                stateSummary={latest.stateSummary}
                v={latest.verification}
                humanRequests={latest.humanRequestCount}
              />
            ) : (
              <div
                style={{
                  padding: "20px 16px",
                  color: "var(--text-subtle)",
                  fontSize: "12.5px",
                  textAlign: "center",
                  lineHeight: 1.5,
                }}
              >
                Start a call to track intent, language, verified facts, and AI
                confidence in real-time.
              </div>
            )}
          </div>

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

function ConversationStateManagerCard({
  stateSummary,
  v,
  humanRequests,
}: {
  stateSummary?: FormattedConversationState | null;
  v: VerificationState;
  humanRequests: number;
}) {
  const intent = stateSummary?.intent.label || "Delivery complaint";
  const intentConf = stateSummary?.confidenceBreakdown.intentPercent ?? 96;
  const language = stateSummary?.language.display || "Hindi + English";

  const reqProblem = stateSummary ? stateSummary.requiredInfo.problem : true;
  const reqCustomer = stateSummary
    ? stateSummary.requiredInfo.customerIdentity
    : Boolean(v.nameMatches === true || v.ordererName);
  const reqOrder = stateSummary ? stateSummary.requiredInfo.orderId : v.confirmed;

  const confirmedFacts = stateSummary?.confirmedFacts?.length
    ? stateSummary.confirmedFacts
    : [
        { label: "Expected Delivery", value: "Aug 21" },
        ...(v.ordererName
          ? [{ label: "Customer Identity", value: v.ordererName }]
          : []),
      ];

  const unconfirmedFacts = stateSummary?.unconfirmedFacts?.length
    ? stateSummary.unconfirmedFacts
    : [
        {
          label: "Order ID",
          value: v.orderId ? `${v.orderId} (pending readback)` : "4582 / 4852",
        },
      ];

  const orderIdConf =
    stateSummary?.confidenceBreakdown.orderIdPercent ??
    (v.confirmed ? 98 : 47);
  const attempts = stateSummary?.attempts.orderId ?? Math.max(1, v.attempts);
  const decision =
    stateSummary?.decision ??
    (orderIdConf < 60 || humanRequests > 0 ? "ESCALATE" : "CONTINUE");

  return (
    <div
      style={{
        padding: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        fontSize: "12.5px",
      }}
    >
      {/* Box Header: Current State */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontWeight: 700,
            fontSize: "13px",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#10b981",
              boxShadow: "0 0 6px #10b981",
            }}
          />
          Current State
        </div>
        <span
          style={{
            padding: "2px 8px",
            borderRadius: "12px",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.02em",
            background:
              decision === "CONTINUE"
                ? "rgba(16, 185, 129, 0.15)"
                : "rgba(239, 68, 68, 0.15)",
            color: decision === "CONTINUE" ? "#059669" : "#dc2626",
            border: `1px solid ${
              decision === "CONTINUE"
                ? "rgba(16, 185, 129, 0.3)"
                : "rgba(239, 68, 68, 0.3)"
            }`,
          }}
        >
          {decision === "CONTINUE" ? "Decision: CONTINUE" : "Decision: ESCALATE"}
        </span>
      </div>

      {/* Intent & Language */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px",
          background: "var(--surface-2)",
          padding: "8px 10px",
          borderRadius: "8px",
          border: "1px solid var(--border)",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "10.5px",
              color: "var(--text-subtle)",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Intent
          </div>
          <div
            style={{
              fontWeight: 600,
              color: "var(--text)",
              marginTop: "2px",
            }}
          >
            {intent}
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: "10.5px",
              color: "var(--text-subtle)",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Language
          </div>
          <div
            style={{
              fontWeight: 600,
              color: "var(--text)",
              marginTop: "2px",
            }}
          >
            {language}
          </div>
        </div>
      </div>

      {/* Required Info checklist */}
      <div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--text-muted)",
            marginBottom: "6px",
            textTransform: "uppercase",
          }}
        >
          Required Info:
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {reqProblem ? (
              <CheckCircle2 size={13} color="#10b981" />
            ) : (
              <X size={13} color="#ef4444" />
            )}
            <span
              style={{
                color: reqProblem ? "var(--text)" : "var(--text-muted)",
              }}
            >
              Problem
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {reqCustomer ? (
              <CheckCircle2 size={13} color="#10b981" />
            ) : (
              <X size={13} color="#ef4444" />
            )}
            <span
              style={{
                color: reqCustomer ? "var(--text)" : "var(--text-muted)",
              }}
            >
              Customer Identity
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {reqOrder ? (
              <CheckCircle2 size={13} color="#10b981" />
            ) : (
              <X size={13} color="#ef4444" />
            )}
            <span
              style={{
                color: reqOrder ? "var(--text)" : "var(--text-muted)",
              }}
            >
              Order ID
            </span>
          </div>
        </div>
      </div>

      {/* Confirmed facts */}
      <div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "#059669",
            marginBottom: "4px",
            textTransform: "uppercase",
          }}
        >
          Confirmed:
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {confirmedFacts.map((fact, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
              }}
            >
              <Check size={12} color="#10b981" />
              <span>
                <b>{fact.label}:</b> {fact.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Unconfirmed facts */}
      <div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "#b45309",
            marginBottom: "4px",
            textTransform: "uppercase",
          }}
        >
          Unconfirmed:
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {unconfirmedFacts.map((fact, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                background: "rgba(245, 158, 11, 0.1)",
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid rgba(245, 158, 11, 0.25)",
              }}
            >
              <AlertTriangle size={12} color="#f59e0b" />
              <span>
                <b>{fact.label}:</b> {fact.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* AI Confidence bars */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--text-muted)",
            marginBottom: "6px",
            textTransform: "uppercase",
          }}
        >
          AI Confidence:
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "11px",
                marginBottom: "2px",
              }}
            >
              <span>Intent Confidence</span>
              <b>{intentConf}%</b>
            </div>
            <div
              style={{
                height: "5px",
                background: "var(--border)",
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${intentConf}%`,
                  height: "100%",
                  background: "#8b5cf6",
                  borderRadius: "3px",
                }}
              />
            </div>
          </div>
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "11px",
                marginBottom: "2px",
              }}
            >
              <span>Order ID Confidence</span>
              <b style={{ color: orderIdConf < 60 ? "#ef4444" : "#10b981" }}>
                {orderIdConf}%
              </b>
            </div>
            <div
              style={{
                height: "5px",
                background: "var(--border)",
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${orderIdConf}%`,
                  height: "100%",
                  background: orderIdConf < 60 ? "#ef4444" : "#10b981",
                  borderRadius: "3px",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Attempts badge */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "11.5px",
          background: "var(--surface-2)",
          padding: "6px 8px",
          borderRadius: "6px",
        }}
      >
        <span style={{ color: "var(--text-muted)" }}>Attempts (Order ID):</span>
        <span
          style={{
            fontWeight: 700,
            padding: "1px 6px",
            background: "var(--border)",
            borderRadius: "4px",
          }}
        >
          {attempts}
        </span>
      </div>
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
