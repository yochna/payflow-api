import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import app from "../src/app";

const api = request(app);

let accessToken = "";
let apiKey = "";
let apiSecret = "";

let webhookServer: Server;
let webhookPort: number;
let receivedRawBody = "";
let receivedSignature: string | null = null;

interface WebhookEventRow {
  event_type: string;
  status: string;
  attempts: number;
}

interface SettlementRow {
  id: number;
  payment_id: string;
  status: string;
  net_amount: number;
}

interface MethodRow {
  payment_method: string;
}

describe("health", () => {
  it("reports the API and database as up", async () => {
    const res = await api.get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await api.get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe("auth", () => {
  const email = `qa_${Date.now()}@payflow.test`;

  it("registers a merchant and returns credentials", async () => {
    const res = await api.post("/api/auth/register").send({
      name: "QA Merchant",
      email,
      password: "test123",
      settlement_account: "SA-001",
      webhook_url: `http://127.0.0.1:${webhookPort}/webhook`,
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const merchant = res.body.data.merchant;
    expect(merchant.api_key).toMatch(/^pk_/);
    expect(merchant.api_secret).toMatch(/^sk_/);

    accessToken = res.body.data.accessToken;
    apiKey = merchant.api_key;
    apiSecret = merchant.api_secret;
  });

  it("rejects duplicate registration", async () => {
    const res = await api.post("/api/auth/register").send({
      name: "QA Merchant",
      email,
      password: "test123",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already registered/i);
  });

  it("logs in and returns fresh tokens", async () => {
    const res = await api.post("/api/auth/login").send({
      email,
      password: "test123",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.merchant.api_key).toBeTruthy();
  });

  it("rejects a bad password", async () => {
    const res = await api.post("/api/auth/login").send({ email, password: "wrong" });
    expect(res.status).toBe(400);
  });

  it("/me returns the merchant without leaking secrets", async () => {
    const res = await api.get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(email);
    expect(res.body.data).not.toHaveProperty("password");
    expect(res.body.data).not.toHaveProperty("api_secret");
  });

  it("rejects /me without a token", async () => {
    const res = await api.get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("payments", () => {
  it("rejects payment creation without an API key", async () => {
    const res = await api.post("/api/payments/create").send({ amount: 100 });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid payment payloads", async () => {
    const missing = await api
      .post("/api/payments/create")
      .set("x-api-key", apiKey)
      .send({ payment_method: "upi" });
    expect(missing.status).toBe(400);

    const zeroAmount = await api
      .post("/api/payments/create")
      .set("x-api-key", apiKey)
      .send({ amount: 0, payment_method: "upi" });
    expect(zeroAmount.status).toBe(400);

    const badMethod = await api
      .post("/api/payments/create")
      .set("x-api-key", apiKey)
      .send({ amount: 100, payment_method: "crypto" });
    expect(badMethod.status).toBe(400);
  });

  it("creates a payment and returns the same one for a repeated idempotency key", async () => {
    const idemKey = `idem_${Date.now()}`;

    const first = await api.post("/api/payments/create").set("x-api-key", apiKey).send({
      amount: 1000,
      payment_method: "upi",
      customer_name: "Akhil",
      customer_email: "akhil@test.com",
      idempotency_key: idemKey,
    });
    expect(first.status).toBe(201);
    expect(first.body.data.status).toBe("created");

    const second = await api
      .post("/api/payments/create")
      .set("x-api-key", apiKey)
      .send({ amount: 1000, payment_method: "upi", idempotency_key: idemKey });
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it("can list payments with JWT auth and default pagination", async () => {
    const res = await api.get("/api/payments").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.totalPayments).toBeGreaterThanOrEqual(1);
  });

  it("marks a payment as failed", async () => {
    const created = await api
      .post("/api/payments/create")
      .set("x-api-key", apiKey)
      .send({ amount: 50, payment_method: "wallet" });
    const id = created.body.data.id;

    const failed = await api
      .post(`/api/payments/${id}/fail`)
      .set("x-api-key", apiKey)
      .send({ failure_reason: "Insufficient funds" });
    expect(failed.status).toBe(200);
    expect(failed.body.data.status).toBe("failed");
  });
});

describe("capture, settlement & webhooks", () => {
  let paymentId: number;
  let settlementId: number;

  it("captures a payment, creates a settlement and delivers a signed webhook", async () => {
    const created = await api
      .post("/api/payments/create")
      .set("x-api-key", apiKey)
      .send({ amount: 1000, payment_method: "card" });
    paymentId = created.body.data.id;

    const res = await api.post(`/api/payments/capture/${paymentId}`).set("x-api-key", apiKey);

    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe("captured");

    // 2% platform fee + 18% GST on the fee.
    expect(res.body.data.settlement.grossAmount).toBe(1000);
    expect(res.body.data.settlement.platformFee).toBe(20);
    expect(res.body.data.settlement.taxAmount).toBe(3.6);
    expect(res.body.data.settlement.netAmount).toBe(976.4);
    expect(res.body.data.settlement.status).toBe("pending");

    // The webhook must have been delivered to our receiver with an HMAC header.
    expect(receivedRawBody).toBeTruthy();

    const expectedSignature = crypto
      .createHmac("sha256", apiSecret)
      .update(receivedRawBody)
      .digest("hex");
    expect(receivedSignature).toBe(`sha256=${expectedSignature}`);
  });

  it("refuses to capture a payment twice", async () => {
    const res = await api.post(`/api/payments/capture/${paymentId}`).set("x-api-key", apiKey);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot be captured/i);
  });

  it("exposes the delivered webhook event in the log", async () => {
    const res = await api.get("/api/webhooks").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const event = res.body.data.find((w: WebhookEventRow) => w.event_type === "payment.captured");
    expect(event).toBeTruthy();
    expect(event.status).toBe("delivered");
    expect(event.attempts).toBeGreaterThan(0);
  });

  it("marks a pending settlement as settled", async () => {
    const list = await api.get("/api/settlements").set("Authorization", `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    const pending = list.body.data.find(
      (s: SettlementRow) => s.payment_id === paymentId && s.status === "pending"
    );
    expect(pending).toBeTruthy();
    settlementId = pending.id;
    expect(Number(pending.net_amount)).toBe(976.4);

    const res = await api
      .post(`/api/settlements/${settlementId}/settle`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("settled");
    expect(res.body.data.settled_at).toBeTruthy();
  });

  it("rejects settling an already-settled settlement", async () => {
    const res = await api
      .post(`/api/settlements/${settlementId}/settle`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });

  it("returns the settlement summary", async () => {
    const res = await api
      .get("/api/settlements/summary")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Number(res.body.data.overall.total_settlements)).toBeGreaterThanOrEqual(1);
    expect(Number(res.body.data.overall.total_net)).toBeGreaterThan(0);
  });
});

describe("refunds", () => {
  it("applies a partial refund and tracks the remaining balance", async () => {
    const created = await api
      .post("/api/payments/create")
      .set("x-api-key", apiKey)
      .send({ amount: 1000, payment_method: "upi" });
    const paymentId = created.body.data.id;

    await api.post(`/api/payments/capture/${paymentId}`).set("x-api-key", apiKey);

    const partial = await api
      .post("/api/refunds")
      .set("x-api-key", apiKey)
      .send({ payment_id: paymentId, amount: 200, reason: "Partial return" });
    expect(partial.status).toBe(201);
    expect(partial.body.data.payment_status).toBe("partially_refunded");
    expect(partial.body.data.remaining_refundable).toBe(800);

    const over = await api
      .post("/api/refunds")
      .set("x-api-key", apiKey)
      .send({ payment_id: paymentId, amount: 900 });
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/exceeds/i);

    const full = await api
      .post("/api/refunds")
      .set("x-api-key", apiKey)
      .send({ payment_id: paymentId, amount: 800 });
    expect(full.status).toBe(201);
    expect(full.body.data.payment_status).toBe("refunded");
  });

  it("refuses to refill a fully refunded payment", async () => {
    const created = await api
      .post("/api/payments/create")
      .set("x-api-key", apiKey)
      .send({ amount: 500, payment_method: "card" });
    const paymentId = created.body.data.id;

    await api.post(`/api/payments/capture/${paymentId}`).set("x-api-key", apiKey);

    await api
      .post("/api/refunds")
      .set("x-api-key", apiKey)
      .send({ payment_id: paymentId, amount: 500 });

    const extra = await api
      .post("/api/refunds")
      .set("x-api-key", apiKey)
      .send({ payment_id: paymentId, amount: 100 });
    expect(extra.status).toBe(400);
  });

  it("lists refunds for the merchant", async () => {
    const res = await api.get("/api/refunds").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.totalRefunds).toBeGreaterThanOrEqual(1);
  });
});

describe("analytics", () => {
  it("returns a summary for today", async () => {
    const res = await api
      .get("/api/analytics/summary")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Number(res.body.data.today.today_payments)).toBeGreaterThanOrEqual(1);
    expect(res.body.data.top_payment_method).toBeTruthy();
  });

  it("returns a success rate", async () => {
    const res = await api
      .get("/api/analytics/success-rate")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Number(res.body.data.success_rate)).toBeGreaterThan(0);
  });

  it("returns volume grouped by day", async () => {
    const res = await api
      .get("/api/analytics/volume?group_by=day")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("returns a payment-method breakdown", async () => {
    const res = await api
      .get("/api/analytics/payment-methods")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((m: MethodRow) => m.payment_method === "upi")).toBe(true);
  });
});

describe("webhook retry", () => {
  let retryToken = "";
  let retryApiKey = "";
  let deadPaymentId = "";

  it("registers a merchant with a dead webhook endpoint", async () => {
    const deadPort = await getClosedPort();
    const res = await api.post("/api/auth/register").send({
      name: "Dead Endpoint Merchant",
      email: `dead_${Date.now()}@payflow.test`,
      password: "test123",
      webhook_url: `http://127.0.0.1:${deadPort}/webhook`,
    });
    expect(res.status).toBe(201);
    retryToken = res.body.data.accessToken;
    retryApiKey = res.body.data.merchant.api_key;

    const created = await api
      .post("/api/payments/create")
      .set("x-api-key", retryApiKey)
      .send({ amount: 500, payment_method: "upi", idempotency_key: `dead_${Date.now()}` });
    expect(created.status).toBe(201);
    deadPaymentId = created.body.data.id;
  });

  it("records a failed delivery to the dead endpoint", async () => {
    const res = await api
      .post(`/api/payments/capture/${deadPaymentId}`)
      .set("x-api-key", retryApiKey);
    expect(res.status).toBe(200);

    const events = await api.get("/api/webhooks").set("Authorization", `Bearer ${retryToken}`);
    const ev = events.body.data.find((e: WebhookEventRow) => e.event_type === "payment.captured");
    expect(ev).toBeTruthy();
    expect(ev.status).toBe("failed");
  });

  it("retries the failed webhook and records another attempt", async () => {
    const events = await api.get("/api/webhooks").set("Authorization", `Bearer ${retryToken}`);
    const ev = events.body.data.find((e: WebhookEventRow) => e.event_type === "payment.captured");

    const res = await api
      .post(`/api/webhooks/retry/${ev.id}`)
      .set("Authorization", `Bearer ${retryToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.delivered).toBe(false);
    expect(res.body.data.attempts).toBeGreaterThan(ev.attempts);
  });

  it("rejects retrying a webhook from another merchant", async () => {
    const events = await api.get("/api/webhooks").set("Authorization", `Bearer ${retryToken}`);
    const ev = events.body.data.find((e: WebhookEventRow) => e.event_type === "payment.captured");

    const res = await api
      .post(`/api/webhooks/retry/${ev.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });
});

// Find a port with nothing listening on it so webhook delivery fails fast.
async function getClosedPort(): Promise<number> {
  const server = await new Promise<Server>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

beforeAll(async () => {
  // Local receiver that simulates a merchant's webhook endpoint.
  webhookServer = createServer((req, res) => {
    req.on("data", (chunk) => (receivedRawBody += chunk));
    req.on("end", () => {
      receivedSignature = req.headers["x-payflow-signature"] as string;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"received":true}');
    });
  });

  await new Promise<void>((resolve) => webhookServer.listen(0, resolve));
  webhookPort = (webhookServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    webhookServer.close((err) => (err ? reject(err) : resolve()))
  );
});
