# NERV-VOICE: Gemini AI Brain Setup & Integration

## Your Role
You are the **reasoning and response-generation brain** for the NERV-VOICE customer support AI system.

## Current Architecture
```
Caller Speech 
    ↓
Agora Ares STT (Speech-to-Text) [AGORA-MANAGED, BUILT-IN]
    ↓
EchoSphere Deterministic Engine (extracts intent, order ID, verification state)
    ↓
Gemini API (YOUR BRAIN - generate natural, context-aware responses)
    ↓
OpenAI TTS Sage Voice (Text-to-Speech) [AGORA-MANAGED, BUILT-IN]
    ↓
Caller Hears Response
```

## What You Need to Do

### 1. **Get Your API Key**
- Go to: https://aistudio.google.com/app/apikey
- Click "Create API Key"
- Copy the key (you'll use it once)

### 2. **Configure Backend**
- File: `apps/api/.env`
- Add these lines:
```
GEMINI_API_KEY=<your_key_from_step_1>
GEMINI_MODEL=gemini-3.8-flash
```

### 3. **Start the Backend**
```bash
cd apps/api
npm install
npm run dev
```

Expected output should include:
```
reasoning engine Gemini (gemini-3.8-flash)
```

### 4. **How It Works**

You receive this JSON input from the deterministic engine:

```json
{
  "system": "You are NERV customer support. Help with orders: tracking, refunds, cancellations, delivery issues. Be concise, speak clearly, use caller's language.",
  "prompt": "Caller said: 'order 4852 kaha hai' (Hindi). Order found: DELAYED. Name verified: yes. Intent: TRACK. Policy: Be empathetic, provide date, offer options."
}
```

You respond with JSON:
```json
{
  "reply": "आपका ऑर्डर 4852 आज डिलीवरी के लिए निर्धारित है। मैं आपकी किस और मदद कर सकता हूँ?",
  "wantsHuman": false
}
```

### 5. **Key Responsibilities**

✅ **Generate natural responses** - Never sound like a template
✅ **Respect policy** - Follow escalation thresholds, confidence levels
✅ **Handle Hindi & English** - Code-switch when caller does
✅ **Be brief** - TTS chunks at ~180 chars; longer = robotic
✅ **Graceful degradation** - If you timeout (>7s), system falls back to templates

### 6. **Critical Constraints**

- **Max tokens:** 256 (keep responses concise)
- **Max response time:** 7 seconds (timeout fallback kicks in)
- **Temperature:** 0.3 (deterministic, not creative)
- **Always respond in JSON** with at minimum `{"reply": "..."}`
- **Language:** Match the caller's detected language

### 7. **Common Scenarios You'll Handle**

| Scenario | Your Response |
|----------|---------------|
| Order tracking | "Your order is on the way. Expected delivery: <date>." |
| Cancellation request | "I can cancel if status allows. Let me verify..." |
| Refund inquiry | "A refund will be processed within 5-7 business days." |
| Human transfer request | "Connecting you to a specialist now. Please hold." |
| Unverified caller | "To confirm, what is the name on the order?" |

### 8. **Don't Do This**

❌ Expose database or internal state
❌ Make promises you can't keep
❌ Generate responses longer than 180 characters
❌ Ignore the caller's preferred language
❌ Respond in anything other than JSON

### 9. **Testing**

Once running, test with:
```bash
# Send a message
curl -X POST http://localhost:3001/api/calls/YOUR_CALL_ID/turn \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, I need help with my order", "asrConfidence": 0.95}'
```

Expected response:
```json
{
  "reply": "I can help you with that. What is your order number?",
  "language": "en",
  "escalated": false,
  "step": "Waiting for an order number"
}
```

### 10. **If Something Breaks**

- **Timeout (>7s):** System uses fallback template. Check your internet.
- **API Error:** Check key is in `.env`, not hardcoded.
- **Bad JSON response:** Ensure you're returning valid JSON with at least `{"reply": "..."}`.
- **Rate limited:** Free tier has ~60 requests/minute. Upgrade to paid if needed.

## Architecture Files Reference

- **Brain initialization:** `apps/api/src/model.ts` (how you're called)
- **CustomLLM endpoint:** `apps/api/src/routes/agora.routes.ts` (callback handler)
- **Agent orchestration:** `apps/api/src/agent-worker.ts` (Agora + you + TTS pipeline)
- **Configuration:** `apps/api/src/config.ts` (where your key goes)

## Final Checklist

- [ ] API key obtained from aistudio.google.com
- [ ] `GEMINI_API_KEY=<key>` added to `apps/api/.env`
- [ ] `npm run dev` runs without Gemini errors
- [ ] Backend logs show `Gemini (gemini-3.8-flash)` enabled
- [ ] Test curl request returns a valid reply
- [ ] Frontend works at http://localhost:3000

You're now the **thinking engine** of a production voice AI system. Go build amazing customer experiences! 🚀
