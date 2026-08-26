# ⚡ PayFlow — Payment Processing & Settlement Engine

A production-grade payment processing REST API built with **TypeScript, Node.js, Express, and PostgreSQL**. Implements real-world fintech patterns including idempotency keys, automatic settlement splitting, partial refunds, webhook events, and comprehensive analytics.

🔗 **Live API:** https://payflow-api-n3o5.onrender.com
📖 **API Docs:** https://payflow-api-n3o5.onrender.com/api/docs

---

## 📁 Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict) |
| Backend | Node.js, Express.js |
| Database | PostgreSQL |
| Auth | JWT (dashboard) + API Key (integration) |
| API Docs | Swagger / OpenAPI |
| Security | Helmet.js, bcrypt, express-rate-limit |
| Deployment | Render + Railway (PostgreSQL) |

---

## ✨ Key Features

- **Idempotency Keys** — prevent duplicate payments on network retry
- **Auto Settlement** — 2% platform fee + 18% GST calculated on capture
- **Partial Refunds** — track remaining refundable amount per payment
- **Webhook Events** — merchants notified on payment state changes
- **Audit Logging** — every state change recorded with old/new values
- **Analytics Dashboard** — success rates, volume trends, payment method breakdown
- **Dual Auth** — JWT for dashboard, API keys for merchant integration
- **PostgreSQL Transactions** — atomic operations with rollback on failure

---

## 📡 API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Register merchant |
| POST | `/api/auth/login` | Public | Login + get tokens |
| POST | `/api/auth/refresh` | Public | Refresh access token |
| POST | `/api/payments/create` | API Key | Create payment with idempotency |
| POST | `/api/payments/capture/:id` | API Key | Capture + auto-settle |
| GET | `/api/payments` | JWT | All payments (paginated) |
| GET | `/api/payments/:id` | API Key | Single payment status |
| POST | `/api/payments/:id/fail` | API Key | Mark payment as failed |
| POST | `/api/refunds` | API Key | Full or partial refund |
| GET | `/api/refunds/:id` | API Key | Refund status |
| GET | `/api/settlements` | JWT | All settlements |
| GET | `/api/settlements/summary` | JWT | Daily settlement report |
| GET | `/api/analytics/summary` | JWT | Dashboard summary |
| GET | `/api/analytics/success-rate` | JWT | Payment success rate |
| GET | `/api/analytics/volume` | JWT | Volume by day/week/month |
| GET | `/api/analytics/payment-methods` | JWT | Breakdown by method |
| GET | `/api/webhooks` | JWT | Webhook delivery logs |
| POST | `/api/webhooks/retry/:id` | JWT | Retry failed webhook |

---
## 💰 Settlement Math

On every captured payment:

Gross Amount: ₹1000.00
Platform Fee: ₹20.00 (2%)
GST on Fee: ₹3.60 (18% of platform fee)
Net to Merchant: ₹976.40


---

## ⚙️ Setup & Run Locally

```bash
git clone https://github.com/yochna/payflow-api.git
cd payflow-api
npm install

# Create .env
cp .env.example .env
# Fill in DB credentials and JWT secrets

# Create database and run schema
psql -U postgres -c "CREATE DATABASE payflow;"
psql -U postgres -d payflow -f schema.sql

# Run development server
npm run dev
```

---

## 👩‍💻 Developer

**B. Yochna Rao**
- GitHub: [github.com/yochna](https://github.com/yochna)
- Email: YochnaRao12@gmail.com

