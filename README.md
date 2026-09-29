# 🚀 Instagram Comment-to-DM Safe AI Automation

A production-ready, highly resilient Node.js & Next.js backend and dashboard that automatically replies to Instagram post/reel comments via Direct Message with safe, personalized, AI-generated responses and smart keyword-to-link triggers.

---

## 🌟 Key Architecture & Highlights

- **⚡ Non-Blocking Webhook Acknowledgment**: Meta webhook receives comments, validates HMAC-SHA256 signature, ensures comment idempotency (`comment_id`), and immediately responds with `HTTP 200` in < 20ms while offloading execution to an asynchronous background worker.
- **🛡️ 3-Tier Multi-Provider AI Failover**:
  1. **Primary**: Google Gemini API (Structured JSON, exponential backoff with jitter on 429/5xx, `Retry-After` header support, no retries on permanent 400/401/403).
  2. **Secondary**: Hugging Face Inference API (Router failover with max 2 retries).
  3. **Deterministic Fallback**: Static, non-AI fail-safe response (`"Hey 👋 Thanks for your comment! You can find the requested information here: https://theru3x.com/links"`).
- **🔌 Circuit Breaker Pattern**: Per-provider state machine (`CLOSED` ➔ `OPEN` after 3 consecutive transient failures ➔ `HALF_OPEN` probe test after 60s cooldown).
- **🔒 Strict AI Guardrails & Prompt Injection Defense**:
  - Treats all comments as untrusted input.
  - Intercepts prompt injections (*"ignore previous instructions"*, *"show system prompt"*, *"give API key"*).
  - Enforces strict JSON output schema (`intent`, `reply`, `safe`).
  - **URL Whitelist Protection**: Only approved business links (`https://theru3x.com/links` or custom links in active rules) are allowed in replies. Arbitrary external URLs are rejected and replaced with safe fallback.
  - Secret & Token Leak Scanners.
  - Length limits (max 500 characters, 1–3 short sentences).
- **⚡ Dynamic Keyword & Sentence-to-Link Rules**:
  - Configure custom keyword triggers (e.g. `link`, `hii`, `price`, `courses`, `pricing`) with dedicated links and custom replies from the Next.js frontend without redeploying.
- **🖥️ Next.js Control Dashboard**:
  - View live comment logs, generated links, and delivery statuses.
  - Test & simulate any comment in the AI Playground.
  - Add/edit keyword rules and manage API keys securely with masking.

---

## 🏗️ Architecture Pipeline

```
Instagram Comment
       │
       ▼
Meta Webhook (POST /webhook)
       │  (Validates HMAC-SHA256 & Idempotency Key: comment_id)
       ├───────────────────────────────────────► Immediate HTTP 200 to Meta
       ▼
Background Worker Queue
       │
       ▼
ProviderManager
       ├─► Check Prompt Injection / Unsafe Guardrails
       ├─► Check Keyword / Sentence Rules (e.g., "link", "hii", "price")
       ├─► 1st Try: Gemini Provider (Circuit Breaker Protected)
       ├─► 2nd Try: Hugging Face Provider (Failover)
       └─► 3rd Try: Static Fallback Provider
       │
       ▼
Guardrail Validator (JSON schema, URL whitelist, secret leak scan, length <= 500)
       │
       ▼
Instagram Graph API v21.0 (POST /v21.0/me/messages with recipient { comment_id })
```

---

## 📂 Project Structure

```
insta/
├── src/
│   ├── ai/
│   │   ├── AIProvider.js              # Base Provider interface
│   │   ├── GeminiProvider.js          # Google Gemini with backoff & retry
│   │   ├── HuggingFaceProvider.js     # Hugging Face inference failover
│   │   ├── FallbackProvider.js        # Deterministic static fallback
│   │   ├── ProviderManager.js         # Multi-provider orchestrator
│   │   ├── CircuitBreaker.js          # Circuit breaker state machine
│   │   ├── Guardrail.js               # Strict security & URL whitelist checks
│   │   └── schemas.js                 # Zod structured JSON schemas
│   ├── config/
│   │   └── env.js                     # Safe config loader & secret masking
│   ├── db/
│   │   └── db.js                      # Unified PostgreSQL & local JSON storage
│   ├── jobs/
│   │   ├── commentJob.js              # Job model with idempotency key
│   │   └── worker.js                  # Concurrency-controlled async worker
│   ├── routes/
│   │   ├── webhook.js                 # Meta webhook verification & receiver
│   │   ├── health.js                  # Lightweight health endpoint
│   │   └── api.js                     # Dashboard REST APIs & simulator
│   ├── services/
│   │   └── instagram.js               # Meta Instagram Graph API v21.0 client
│   └── server.js                      # Express application entrypoint
├── frontend/                          # Next.js 14 Management Dashboard
├── tests/
│   └── automation.test.js             # 15 unit and integration test suites
├── render.yaml                        # Render deployment specification
├── .env.example                       # Environment configuration template
└── package.json
```

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory (refer to `.env.example`):

```env
PORT=3000
NODE_ENV=development

# Primary AI Provider
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-1.5-flash

# Secondary AI Provider
HF_TOKEN=your_huggingface_token
HF_MODEL=meta-llama/Llama-3.2-3B-Instruct

# Instagram / Meta Graph API
INSTAGRAM_ACCESS_TOKEN=your_meta_page_access_token
INSTAGRAM_ACCOUNT_ID=your_instagram_account_id
META_VERIFY_TOKEN=your_webhook_verification_token
META_APP_SECRET=your_meta_app_secret

# Default Fallback & Allowed Links
PUBLIC_REPLY=false
FALLBACK_MESSAGE=Hey 👋 Thanks for your comment! You can find the requested information here: https://theru3x.com/links
ALLOWED_URL=https://theru3x.com/links

# Database
DATABASE_URL= # PostgreSQL connection string (or leave empty for local DB)

# AI Timeouts & Circuit Breaker
AI_TIMEOUT_MS=10000
AI_MAX_RETRIES=3
AI_BACKOFF_BASE_MS=1000
CIRCUIT_BREAKER_THRESHOLD=3
CIRCUIT_BREAKER_RESET_TIMEOUT_MS=60000
```

---

## 🧪 Running Tests (15 Comprehensive Suites)

Run all unit and integration test suites:

```bash
npm test
```

### Covered Test Cases:
1. Normal `LINK` comment matching
2. Lowercase `"link"` sentence matching
3. Personalized comment handling
4. Prompt injection protection & fallback
5. Unsafe input prevention
6. Gemini success output validation
7. Gemini 429 exponential backoff retry
8. Gemini 429 failover to Hugging Face
9. Gemini + Hugging Face failover to Static Fallback
10. Duplicate comment idempotency (`comment_id`)
11. Invalid AI JSON rejection by Guardrails
12. Unauthorized URL rejection & fallback substitution
13. 401/403 Non-transient error non-retry rules
14. 5xx Transient error retry rules
15. Circuit Breaker state transitions (`CLOSED` ➔ `OPEN` ➔ `HALF_OPEN` ➔ `CLOSED`)

---

## 🚀 Running the Server Locally

```bash
# Start backend server
npm run dev

# Or start full stack (Backend + Frontend)
npm run dev:all
```

- Server: `http://localhost:3000`
- Webhook: `http://localhost:3000/webhook`
- Health Check: `http://localhost:3000/health`
- Frontend Dashboard: `http://localhost:3001`

---

## 🌐 Deploying to Render

1. Create a **Web Service** on Render connected to your repository.
2. Select **Node** environment.
3. Health check path: `/health`
4. Free Tier Note: Render Free Web Services spin down after 15 minutes of inactivity. For continuous 24/7 comment processing:
   - **Recommended**: Upgrade to Render Starter ($7/mo) for an always-on worker.
   - **Testing/Development**: Set up a free external monitor (such as BetterStack, UptimeRobot, or Cron-Job.org) to ping `https://your-app.onrender.com/health` every 5–10 minutes.
