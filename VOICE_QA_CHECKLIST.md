# Voice pipeline — root causes & manual QA checklist

## Root causes confirmed in code

**1. Real calls never reached EchoSphere.** `agent-worker.startSession()` only wired
the `CustomLLM` provider when `AGORA_LLM_URL`/`PUBLIC_URL` resolved to a public
address; otherwise it silently built the agent with Agora's managed OpenAI
preset. The call still connected and still answered the caller, so nothing
looked broken — but `chatCompletionHandler` was never invoked, which is why no
`CUSTOM_LLM_REQUEST_RECEIVED` line ever appeared, no transcript rows were
written and no escalation could happen. The URL check only threw in production,
so every local/preview deployment ran in this mode by default.

Now: the resolved URL and the selected mode are logged on
`AGORA_AGENT_START_REQUESTED` / `AGORA_AGENT_STARTED`, the misconfiguration is
reported in `describeConfig()` and `/api/agora/status`, and a session with an
unreachable endpoint is refused instead of started. `AGORA_ALLOW_MANAGED_LLM_FALLBACK=true`
re-enables the managed preset explicitly, as a transport-only demo mode.

**2. Natural human requests escalated on the first ask.** `handleTurn()` matched
`^(transfer|human agent|…)$` and transferred immediately, bypassing
`detectHumanRequest()` and the retention ladder. Because the regex is anchored,
it only fired for one-word utterances — so text-simulator testers saw an instant
transfer while real callers ("can I speak to a human please") fell through to
the engine. That branch is gone; all human requests now go through
`runTurn()` and hand over after `HUMAN_REQUESTS_BEFORE_HANDOVER` (3) asks.

**3. Diagnostics described a stack that is not running.** `config.ts`,
`/api/agora/status`, `/api/agora/openai/health` and the worker docstrings all
reported Deepgram STT + Deepgram Aura TTS, and the worker imported
`DeepgramSTT`/`DeepgramTTS` while actually constructing `AresSTT` and
`OpenAITTS({ voice: "sage" })`. Diagnostics now report Agora Ares ASR and
OpenAI TTS with the configured voice.

**ASR confidence.** Agora's CustomLLM callback is a plain OpenAI chat-completion
body and `agora-agents` exposes no per-utterance confidence anywhere in its
types, so there is no real value to forward. The hardcoded `0.95` is replaced by
an optional read of `asr_confidence` / `metadata.confidence` / `x-asr-confidence`;
when absent, confidence is left undefined rather than faked (a constant high
value silently disabled the read-back gating in `@echosphere/core`).

## Manual QA checklist

Prerequisites: `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `AGORA_CUSTOMER_ID`,
`AGORA_CUSTOMER_SECRET`, `GEMINI_API_KEY`, `AUTH_SECRET`, `DATABASE_URL` (Neon).

- [ ] Expose the API publicly (`cloudflared tunnel --url http://localhost:3001`
      or the deployed domain) and set `PUBLIC_URL` (or `AGORA_LLM_URL`).
- [ ] `curl $PUBLIC_URL/api/agora/openai/health` → `sttProvider: agora_ares`,
      `ttsProvider: openai`, `ttsVoice: sage`, `llmReachable: true`.
- [ ] `curl $PUBLIC_URL/health` → persistence `postgres` (not `memory`).
      Memory persistence loses every call between serverless invocations.
- [ ] `curl $PUBLIC_URL/api/agora/status` → `llmBridgeReachable: true`,
      `llmBridgeIssue: null`.
- [ ] Start the caller app, enter a name and phone number, press **Call support**.
      API logs show `AGORA_AGENT_START_REQUESTED` with `llmMode: custom_llm`.
- [ ] Agora Console inspector shows the agent using **Custom LLM**, not the
      managed OpenAI model.
- [ ] Speak one sentence. API logs show `CUSTOM_LLM_REQUEST_RECEIVED` followed by
      `ECHOSPHERE_TURN_STARTED`/`_COMPLETED`. If not, the agent is on the managed
      model — stop and fix configuration first.
- [ ] Ask for a human in three natural, differently-phrased sentences
      ("can I speak to a human", "I don't want the bot, get me a real person",
      "just connect me to an agent"). The first two get retention responses; the
      third hands over.
- [ ] Dashboard shows a new escalation with reason `CUSTOMER_INSISTED_HUMAN` and
      a matching ticket; the call row is `escalated`.
- [ ] `GET /api/calls/:id/transcript` returns both caller and agent lines for
      the whole call, including after a redeploy (Postgres persistence).
- [ ] Unset `PUBLIC_URL`/`AGORA_LLM_URL` (or point them at localhost) and start a
      call: the agent start fails with an explanatory error instead of
      connecting to Agora's managed model.
- [ ] `POST /api/agora/openai/v1/chat/completions` without an
      `Authorization: Bearer $AUTH_SECRET` header → 401.
- [ ] `npx vitest run` at the repo root: all suites pass.
