# ⚡ PayFlow — Payment Processing & Settlement Engine

> A production-inspired payment processing REST API built with **TypeScript, Node.js, Express, and PostgreSQL**.

PayFlow is a backend payment-processing system designed to model a merchant payment lifecycle from **payment creation and capture to settlement and refunds**.

The project focuses on real-world backend engineering concepts such as **idempotency, transactional database operations, authentication, partial refunds, webhook events, audit logging, settlement calculations, and analytics**.

---

## 🚀 Live Demo

| Resource                  | Link                                             |
| ------------------------- | ------------------------------------------------ |
| 🌐 Live API               | https://payflow-api-n3o5.onrender.com            |
| ❤️ Health Check           | https://payflow-api-n3o5.onrender.com/api/health |
| 📖 Swagger / OpenAPI Docs | https://payflow-api-n3o5.onrender.com/api/docs   |
| 💻 GitHub Repository      | https://github.com/yochna/payflow-api            |

### Current API Status

The deployed API is live and connected to PostgreSQL.

```json
{
  "success": true,
  "message": "PayFlow API running",
  "db": "connected"
}
```

---

# 🎯 What is PayFlow?

PayFlow simulates the core backend operations of a payment-processing platform.

A typical payment moves through the following lifecycle:

```text
                    ┌──────────────┐
                    │ Create       │
                    │ Payment     │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   CREATED    │
                    └──────┬───────┘
                           │
                     Capture Payment
                           │
                           ▼
                    ┌──────────────┐
                    │   CAPTURED   │
                    └──────┬───────┘
                           │
                  Automatic Settlement
                           │
                           ▼
                    ┌──────────────┐
                    │   SETTLED    │
                    └──────┬───────┘
                           │
                       Refund
                           │
                           ▼
                    ┌──────────────┐
                    │   REFUNDED   │
                    └──────────────┘
```

The system also handles failure scenarios, duplicate requests, webhook events, audit logs, authentication, and analytics.

---

# ✨ Key Features

### 💳 Payment Processing

* Create payments
* Capture payments
* Mark payments as failed
* Retrieve payment details
* Paginated payment listing

### 🔁 Idempotency

Prevents duplicate payment creation when a client retries the same request due to network failures or timeouts.

```text
Client Request
      │
      ▼
Idempotency Key
      │
      ├── New Key ──────► Create Payment
      │
      └── Existing Key ─► Prevent Duplicate
```

### 💰 Automatic Settlement

Captured payments automatically generate settlement calculations.

The current model uses:

* **2% platform fee**
* **18% GST on the platform fee**
* Remaining amount goes to the merchant

### ↩️ Partial & Full Refunds

Supports:

* Full refunds
* Partial refunds
* Remaining refundable amount tracking

### 🔔 Webhook Events

Payment state changes generate webhook events for merchant integrations.

Webhook delivery information can also be inspected and failed deliveries can be retried.

### 📝 Audit Logging

Important payment state changes are recorded with previous and updated values, providing a traceable history of payment operations.

### 📊 Analytics

Provides APIs for:

* Payment summary
* Success rate
* Payment volume
* Daily/weekly/monthly volume
* Payment method breakdown

### 🔐 Dual Authentication

PayFlow uses two authentication approaches:

| Client                    | Authentication |
| ------------------------- | -------------- |
| Dashboard / Merchant User | JWT            |
| API Integration           | API Key        |

### 🛡️ Security

The backend includes:

* Helmet.js
* bcrypt password hashing
* Express rate limiting
* JWT authentication
* API-key authentication

### 🗄️ Transactional Database Operations

PostgreSQL transactions are used for important operations to maintain consistency and roll back changes when an operation fails.

---

# 🏗️ Architecture

```text
                         ┌─────────────────────┐
                         │   Merchant / Client │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │    Express REST API │
                         └──────────┬──────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
       ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
       │   Payments  │       │   Refunds   │       │  Analytics  │
       └──────┬──────┘       └──────┬──────┘       └──────┬──────┘
              │                     │                     │
              └─────────────────────┼─────────────────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │     PostgreSQL      │
                         └──────────┬──────────┘
                                    │
                   ┌────────────────┼────────────────┐
                   │                │                │
                   ▼                ▼                ▼
             Settlements        Webhooks        Audit Logs
```

---

# 🔄 Payment Processing Flow

```text
                    Payment Request
                           │
                           ▼
                  Validate API Key
                           │
                           ▼
                  Check Idempotency
                           │
                           ▼
                    Create Payment
                           │
                           ▼
                       CREATED
                           │
                           ▼
                    Capture Payment
                           │
                           ▼
                       CAPTURED
                           │
                           ▼
                  Calculate Settlement
                           │
                           ▼
                       SETTLED
                           │
                           ▼
                    Webhook Event
                           │
                           ▼
                    Merchant System
```

---

# 💰 Settlement Calculation

For every captured payment, PayFlow calculates the platform fee and GST.

### Example

For a payment of:

```text
₹1000.00
```

Platform fee:

```text
2% of ₹1000
= ₹20.00
```

GST:

```text
18% of ₹20
= ₹3.60
```

Merchant settlement:

```text
₹1000.00
- ₹20.00
- ₹3.60
----------------
₹976.40
```

### Final settlement

| Component           |      Amount |
| ------------------- | ----------: |
| Gross Payment       |    ₹1000.00 |
| Platform Fee        |      ₹20.00 |
| GST on Fee          |       ₹3.60 |
| Merchant Settlement | **₹976.40** |

---

# 📡 API Endpoints

## Authentication

| Method | Endpoint             | Auth   | Description              |
| ------ | -------------------- | ------ | ------------------------ |
| `POST` | `/api/auth/register` | Public | Register a merchant      |
| `POST` | `/api/auth/login`    | Public | Login and receive tokens |
| `POST` | `/api/auth/refresh`  | Public | Refresh access token     |

---

## Payments

| Method | Endpoint                    | Auth    | Description                       |
| ------ | --------------------------- | ------- | --------------------------------- |
| `POST` | `/api/payments/create`      | API Key | Create a payment with idempotency |
| `POST` | `/api/payments/capture/:id` | API Key | Capture payment and auto-settle   |
| `GET`  | `/api/payments`             | JWT     | Get paginated payments            |
| `GET`  | `/api/payments/:id`         | API Key | Get payment status                |
| `POST` | `/api/payments/:id/fail`    | API Key | Mark payment as failed            |

---

## Refunds

| Method | Endpoint           | Auth    | Description                   |
| ------ | ------------------ | ------- | ----------------------------- |
| `POST` | `/api/refunds`     | API Key | Create full or partial refund |
| `GET`  | `/api/refunds/:id` | API Key | Get refund status             |

---

## Settlements

| Method | Endpoint                   | Auth | Description            |
| ------ | -------------------------- | ---- | ---------------------- |
| `GET`  | `/api/settlements`         | JWT  | Get settlements        |
| `GET`  | `/api/settlements/summary` | JWT  | Get settlement summary |

---

## Analytics

| Method | Endpoint                         | Auth | Description              |
| ------ | -------------------------------- | ---- | ------------------------ |
| `GET`  | `/api/analytics/summary`         | JWT  | Dashboard summary        |
| `GET`  | `/api/analytics/success-rate`    | JWT  | Payment success rate     |
| `GET`  | `/api/analytics/volume`          | JWT  | Volume by day/week/month |
| `GET`  | `/api/analytics/payment-methods` | JWT  | Payment method breakdown |

---

## Webhooks

| Method | Endpoint                  | Auth | Description                |
| ------ | ------------------------- | ---- | -------------------------- |
| `GET`  | `/api/webhooks`           | JWT  | View webhook delivery logs |
| `POST` | `/api/webhooks/retry/:id` | JWT  | Retry a failed webhook     |

---

# 🛠️ Tech Stack

| Layer             | Technology         |
| ----------------- | ------------------ |
| Language          | TypeScript         |
| Runtime           | Node.js            |
| Framework         | Express.js         |
| Database          | PostgreSQL         |
| Authentication    | JWT + API Keys     |
| API Documentation | Swagger / OpenAPI  |
| Password Security | bcrypt             |
| HTTP Security     | Helmet.js          |
| Rate Limiting     | express-rate-limit |
| Deployment        | Render             |
| Database Hosting  | PostgreSQL         |

---

# 🔐 Authentication Model

PayFlow separates authentication based on the type of client.

### Dashboard Authentication

```text
Merchant
   │
   ▼
Login
   │
   ▼
JWT Access Token
   │
   ▼
Protected Dashboard APIs
```

### API Integration Authentication

```text
Merchant Application
        │
        ▼
     API Key
        │
        ▼
PayFlow API
        │
        ▼
Payment Operations
```

This separation allows interactive dashboard users and external merchant integrations to use different authentication mechanisms.

---

# 🔁 Idempotency

Payment APIs can receive duplicate requests when a client retries after a timeout or network failure.

PayFlow uses an idempotency key to ensure the same logical payment request is not processed multiple times.

```text
Request 1
Idempotency-Key: ABC123
        │
        ▼
   Create Payment
        │
        ▼
     Success


Request 2
Idempotency-Key: ABC123
        │
        ▼
Recognize Existing Request
        │
        ▼
Prevent Duplicate Processing
```

This is particularly important for payment-related APIs where duplicate processing can result in incorrect charges.

---

# ↩️ Refund Model

PayFlow supports both full and partial refunds.

Example:

```text
Original Payment
₹1000
   │
   ├── Refund ₹200
   │
   ▼
Remaining Refundable
₹800
```

A subsequent refund can use the remaining refundable amount.

The system prevents refunding more than the available refundable balance.

---

# 🔔 Webhook Model

Payment state changes can generate webhook events for merchant systems.

```text
Payment State Change
        │
        ▼
   Create Event
        │
        ▼
 Store Webhook Log
        │
        ▼
Deliver to Merchant
        │
        ├── Success
        │
        └── Failure
              │
              ▼
        Retry Available
```

Webhook delivery records allow the status of events to be inspected and failed events to be retried.

---

# 📝 Audit Logging

Important state changes are recorded in audit logs.

Conceptually:

```text
Payment State Change

OLD STATE
   ↓
CREATED
   ↓
NEW STATE
   ↓
CAPTURED

       +
Timestamp
       +
Related Payment
```

This provides traceability for important payment operations.

---

# 📊 Analytics

PayFlow provides analytics APIs for monitoring payment activity.

Available analytics include:

* Overall payment summary
* Payment success rate
* Transaction volume
* Daily volume
* Weekly volume
* Monthly volume
* Payment-method breakdown

Example:

```text
Analytics
   │
   ├── Total Payments
   ├── Successful Payments
   ├── Failed Payments
   ├── Success Rate
   ├── Total Volume
   └── Payment Methods
```

---

# 🗄️ Database

PayFlow uses PostgreSQL for persistent storage.

The database schema is available in:

```text
schema.sql
```

Database transactions are used for operations where multiple database changes need to remain consistent.

If one part of a transactional operation fails, the transaction can be rolled back instead of leaving partially completed data.

---

# 📁 Project Structure

```text
payflow-api/
│
├── src/
│   └── Application source code
│
├── schema.sql
│   └── PostgreSQL database schema
│
├── package.json
│   └── Dependencies and scripts
│
├── package-lock.json
│
├── tsconfig.json
│   └── TypeScript configuration
│
├── .gitignore
│
└── README.md
```

---

# ⚙️ Setup & Run Locally

## 1. Clone the repository

```bash
git clone https://github.com/yochna/payflow-api.git
cd payflow-api
```

## 2. Install dependencies

```bash
npm install
```

## 3. Configure environment variables

Create a `.env` file and configure your database credentials and JWT secrets.

Example:

```env
PORT=5001

DATABASE_URL=your_postgresql_connection_string

JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret
```

> Do not commit `.env` or production secrets to GitHub.

## 4. Create the database

```bash
psql -U postgres -c "CREATE DATABASE payflow;"
```

## 5. Run the database schema

```bash
psql -U postgres -d payflow -f schema.sql
```

## 6. Start the development server

```bash
npm run dev
```

The API will be available at:

```text
http://localhost:5001
```

Swagger documentation:

```text
http://localhost:5001/api/docs
```

---

# 🧪 Testing the API

The easiest way to explore PayFlow is through Swagger.

Open:

```text
https://payflow-api-n3o5.onrender.com/api/docs
```

Recommended testing flow:

```text
1. Register merchant
       ↓
2. Login
       ↓
3. Obtain authentication credentials
       ↓
4. Create payment
       ↓
5. Capture payment
       ↓
6. Verify settlement
       ↓
7. Create refund
       ↓
8. Check webhook events
       ↓
9. Check analytics
```

---

# 🌐 Deployment

The application is deployed as a live REST API.

```text
Client
  │
  ▼
Render
  │
  ▼
PayFlow API
  │
  ▼
PostgreSQL
```

Health endpoint:

```text
GET /api/health
```

Current health response:

```json
{
  "success": true,
  "message": "PayFlow API running",
  "db": "connected"
}
```

---

# 🔒 Security Considerations

The project includes several backend security mechanisms:

* JWT-based authentication
* API-key authentication
* bcrypt password hashing
* Helmet security middleware
* Express rate limiting
* Environment-based secrets
* Database transactions
* Input validation at API boundaries

> **Important:** PayFlow is an educational/portfolio implementation and is not intended to process real financial transactions or replace a regulated payment processor.

---

# 🎓 What This Project Demonstrates

PayFlow was designed to demonstrate practical backend engineering concepts including:

* REST API development
* TypeScript backend development
* PostgreSQL database design
* Authentication and authorization
* API-key based integrations
* Idempotent API design
* Payment state management
* Transactional database operations
* Refund processing
* Settlement calculations
* Webhook-based communication
* Audit logging
* Analytics APIs
* API documentation with OpenAPI
* Cloud deployment

---

# 🚧 Future Improvements

Potential future improvements include:

* Automated unit and integration test coverage
* Webhook signature verification
* Automatic webhook retry scheduling
* Improved observability and structured logging
* Redis-based caching
* Background job processing
* Message queue integration
* Docker-based deployment
* Integration with a sandbox payment provider
* More advanced monitoring and alerting

---

# 👩‍💻 Developer

### B. Yochna Rao

GitHub:
https://github.com/yochna

Project Repository:
https://github.com/yochna/payflow-api

---

## ⭐ Project Summary

**PayFlow is a production-inspired payment processing and settlement backend that demonstrates how a payment system can manage the complete transaction lifecycle while addressing real-world backend concerns such as idempotency, authentication, refunds, settlement calculations, transactions, webhooks, audit logging, and analytics.**

---
