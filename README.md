# NERV-VOICE

### Real-Time AI Voice Conversation Platform

NERV-VOICE is a real-time conversational voice platform that connects a browser-based caller to an AI voice agent through **Agora RTC**, with **Deepgram** handling speech recognition and text-to-speech, and **Gemini** providing the language-model intelligence.

The project is designed as a full-stack TypeScript monorepo with a React/Vite frontend, a Node/TypeScript API, shared packages, and persistent database support.

---

## ✨ What is NERV-VOICE?

NERV-VOICE turns a normal browser session into a real-time AI voice conversation.

The high-level flow is:

```text
┌──────────────────────┐
│   Browser / Caller   │
│   React + Agora RTC  │
└──────────┬───────────┘
           │
           │ Real-time audio
           ▼
┌──────────────────────┐
│      Agora RTC       │
│  Voice communication │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│    AI Voice Agent    │
│      / Worker        │
└──────────┬───────────┘
           │
      Speech → Text
           │
           ▼
┌──────────────────────┐
│      Deepgram STT    │
└──────────┬───────────┘
           │
           │ Text
           ▼
┌──────────────────────┐
│       Gemini         │
│    LLM / Reasoning   │
└──────────┬───────────┘
           │
           │ Response text
           ▼
┌──────────────────────┐
│      Deepgram TTS    │
└──────────┬───────────┘
           │
           │ Generated speech
           ▼
┌──────────────────────┐
│      Agora RTC       │
└──────────┬───────────┘
           │
           ▼
      Human caller
```

The API also exposes an OpenAI-compatible Custom LLM endpoint for the Agora conversational AI integration.

---

## 🚀 Features

* 🎙️ Real-time browser-based voice conversations
* ⚡ Agora RTC for low-latency audio communication
* 🧠 Gemini-powered conversational intelligence
* 🗣️ Deepgram speech-to-text
* 🔊 Deepgram text-to-speech
* 🔄 OpenAI-compatible Custom LLM interface for Agora
* 📡 API-driven call lifecycle
* 📲 Real-time signalling
* 🗄️ Database support for persistent application data
* 🔐 Environment-based secret management
* 🧩 TypeScript monorepo architecture
* 🧪 Type checking, linting and automated tests

---

# 🏗️ Architecture

NERV-VOICE is organized as a workspace-based monorepo.

```text
NERV-VOICE/
│
├── apps/
│   ├── api/              # Backend API and voice-agent infrastructure
│   └── caller/           # Real-time voice caller application
│
├── packages/
│   ├── core/             # Shared application/domain logic
│   └── db/               # Database layer, migrations and seed logic
│
├── public/               # Static frontend assets
├── src/                  # Main dashboard/frontend application
│
├── .env.example          # Environment variable template
├── GEMINI_SETUP.md       # Gemini configuration guide
├── VOICE_QA_CHECKLIST.md # Voice pipeline QA checklist
├── package.json          # Workspace configuration
├── tsconfig.json         # TypeScript configuration
└── vercel.json           # Deployment configuration
```

---

# 🧰 Tech Stack

| Layer          | Technology                                |
| -------------- | ----------------------------------------- |
| Frontend       | React                                     |
| Language       | TypeScript                                |
| Build Tool     | Vite                                      |
| Styling        | Tailwind CSS                              |
| Routing        | TanStack Router                           |
| State/Data     | TanStack Query                            |
| Voice / RTC    | Agora RTC                                 |
| Speech-to-Text | Deepgram                                  |
| Text-to-Speech | Deepgram                                  |
| LLM            | Google Gemini                             |
| Validation     | Zod                                       |
| Database       | PostgreSQL / Neon-compatible              |
| Testing        | Vitest                                    |
| Linting        | ESLint                                    |
| Deployment     | Vercel-compatible frontend/API deployment |

---

# 📋 Prerequisites

Before running NERV-VOICE locally, install:

* Node.js
* npm
* Git

You will also need accounts/API credentials for the external services used by the voice pipeline:

* Agora
* Deepgram
* Google Gemini
* PostgreSQL/Neon if using persistent storage

---

# ⚙️ Installation

Clone the repository:

```bash
git clone https://github.com/Angshurpita/NERV-VOICE.git
cd NERV-VOICE
```

Install dependencies:

```bash
npm install
```

---

# 🔐 Environment Variables

Create your local environment configuration from the provided template:

```bash
cp .env.example .env
```

The exact variables required depend on which parts of the system you are running.

Typical configuration includes:

### Frontend

```env
VITE_API_URL=
VITE_AGORA_APP_ID=
```

### API / Server

```env
AUTH_SECRET=

PUBLIC_URL=
AGORA_LLM_URL=

AGORA_APP_ID=
AGORA_APP_CERTIFICATE=

AGORA_CUSTOMER_ID=
AGORA_CUSTOMER_SECRET=

DEEPGRAM_API_KEY=

GEMINI_API_KEY=
GEMINI_MODEL=

DATABASE_URL=
```

### Important

Never commit real credentials to GitHub.

Do **not** put server-side secrets into variables prefixed with `VITE_`.

For production, configure secrets through the deployment platform rather than committing them to the repository.

See [`GEMINI_SETUP.md`](./GEMINI_SETUP.md) for Gemini-specific configuration.

---

# 🖥️ Running Locally

## Run the main application

```bash
npm run dev
```

The main Vite development server runs on port `3000`.

## Run the API

```bash
npm run dev:api
```

## Run the caller application

```bash
npm run dev:caller
```

## Run the complete development environment

```bash
npm run dev:all
```

This starts the API, dashboard and caller applications together.

---

# 🗄️ Database

NERV-VOICE supports persistent database storage through the database package.

Run migrations with:

```bash
npm run db:migrate
```

Seed the database with:

```bash
npm run db:seed
```

For production deployments, configure a persistent PostgreSQL-compatible database through:

```env
DATABASE_URL=
```

Do not rely on in-memory state for production persistence.

---

# 🔊 Voice Pipeline

The voice pipeline is the core of NERV-VOICE.

A typical conversation follows:

```text
User speaks
     │
     ▼
Agora RTC
     │
     ▼
Speech recognition
(Deepgram STT)
     │
     ▼
Text request
     │
     ▼
Custom LLM endpoint
     │
     ▼
Gemini
     │
     ▼
AI response
     │
     ▼
Deepgram TTS
     │
     ▼
Generated audio
     │
     ▼
Agora RTC
     │
     ▼
User hears response
```

The Custom LLM integration follows an OpenAI-compatible interface so that the conversational agent can communicate with the application's LLM backend.

---

# 🔌 API

The backend provides APIs for managing the voice conversation lifecycle and integrating the real-time voice infrastructure.

The Agora conversational AI integration uses an OpenAI-compatible endpoint:

```text
POST /api/agora/openai/v1/chat/completions
```

The endpoint is intended for the server-side Agora integration and should be protected appropriately in production.

The API also handles operations such as:

* call creation
* call state
* agent lifecycle
* signalling
* conversation turns
* voice-agent integration

---

# 🔒 Security

NERV-VOICE uses environment variables for sensitive credentials.

Never expose or commit:

```text
AGORA_APP_CERTIFICATE
AGORA_CUSTOMER_SECRET
DEEPGRAM_API_KEY
GEMINI_API_KEY
AUTH_SECRET
DATABASE_URL
```

Recommended production practices:

* use HTTPS
* keep API secrets server-side
* configure production secrets through the hosting platform
* validate incoming API requests
* authenticate sensitive endpoints
* avoid logging credentials or access tokens
* use a persistent database in production
* restrict CORS to trusted origins where appropriate

---

# 🧪 Development & Testing

Run TypeScript checks:

```bash
npm run typecheck
```

Run linting:

```bash
npm run lint
```

Run tests:

```bash
npm test
```

Build the project:

```bash
npm run build
```

A recommended pre-deployment check is:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

---

# 🩺 Voice QA

The repository contains a dedicated voice QA checklist:

```text
VOICE_QA_CHECKLIST.md
```

Use this when validating:

* microphone permissions
* RTC connectivity
* agent startup
* speech recognition
* LLM responses
* speech synthesis
* call termination
* error recovery
* reconnect behavior

For a real production voice system, functional voice testing is just as important as a successful TypeScript build.

---

# 🚢 Deployment

NERV-VOICE consists of multiple application components, so deployment should be treated as a system rather than simply deploying the React frontend.

At minimum, production configuration must provide:

```text
Frontend
   │
   ├── Public HTTPS URL
   │
   ▼
API
   │
   ├── Agora credentials
   ├── Deepgram credentials
   ├── Gemini credentials
   ├── Database connection
   └── Public Custom LLM endpoint
```

The Agora Cloud Agent must be able to reach the application's Custom LLM endpoint over the public internet.

Therefore, production configuration must not use:

```text
localhost
127.0.0.1
```

for the public LLM callback.

Configure the production API URL through:

```env
VITE_API_URL=
```

and configure the public server URL through:

```env
PUBLIC_URL=
```

If the API and frontend are deployed separately, ensure the frontend points to the deployed API rather than a local development server.

---

# 🧠 Gemini Configuration

Gemini is used as the language-model layer of the conversational pipeline.

Configure:

```env
GEMINI_API_KEY=
GEMINI_MODEL=
```

The model should be explicitly configured for the environment rather than relying on an unverified model name.

See:

```text
GEMINI_SETUP.md
```

for project-specific setup instructions.

---

# 📁 Project Commands

| Command              | Purpose                         |
| -------------------- | ------------------------------- |
| `npm run dev`        | Start the main frontend         |
| `npm run dev:api`    | Start the API                   |
| `npm run dev:caller` | Start the caller                |
| `npm run dev:all`    | Start API, dashboard and caller |
| `npm run build`      | Build the frontend              |
| `npm run typecheck`  | Run TypeScript checks           |
| `npm run lint`       | Run ESLint                      |
| `npm test`           | Run tests                       |
| `npm run db:migrate` | Run database migrations         |
| `npm run db:seed`    | Seed the database               |

---

# 🧩 Troubleshooting

## The caller cannot connect

Check:

1. `VITE_API_URL`
2. Agora App ID
3. Agora credentials
4. browser microphone permissions
5. API availability
6. browser console
7. API logs

---

## The AI agent cannot start

Check:

```env
PUBLIC_URL=
AGORA_LLM_URL=
AUTH_SECRET=
AGORA_APP_ID=
AGORA_APP_CERTIFICATE=
AGORA_CUSTOMER_ID=
AGORA_CUSTOMER_SECRET=
```

The public Custom LLM endpoint must be reachable by Agora.

---

## The AI hears the user but does not respond

Check:

```env
DEEPGRAM_API_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=
```

Then inspect API logs for:

* STT failures
* Gemini API errors
* Custom LLM authentication failures
* malformed LLM responses
* TTS failures

---

## The application works locally but fails in production

The most common causes are:

* incorrect `VITE_API_URL`
* missing production environment variables
* localhost/private URL used as the Custom LLM endpoint
* missing database configuration
* serverless/in-memory state assumptions
* CORS configuration
* Agora Cloud Agent unable to reach the API

---

# 🛣️ Roadmap

Potential future improvements include:

* [ ] Production-grade distributed signalling
* [ ] Improved authentication and authorization
* [ ] Persistent conversation history
* [ ] Voice analytics and call metrics
* [ ] Improved agent observability
* [ ] Automatic retry/recovery for external voice services
* [ ] Rate limiting
* [ ] Conversation transcripts
* [ ] Multi-agent support
* [ ] Additional LLM providers
* [ ] Automated end-to-end voice testing
* [ ] Production monitoring and alerting

---

# 🤝 Contributing

Contributions are welcome.

Before submitting a change:

1. Create a branch.
2. Make the change.
3. Run type checking.
4. Run linting.
5. Run tests.
6. Run the production build.
7. Verify that no secrets or `.env` files are included.
8. Open a pull request with a clear description of the change.

---

# 📄 License

Add the project's intended license here before publishing NERV-VOICE as an open-source project.

---

# 👤 Author

**Angshurpita**

GitHub: [@Angshurpita](https://github.com/Angshurpita)

---

## NERV-VOICE

**Real-time voice. AI intelligence. Natural conversation.**
