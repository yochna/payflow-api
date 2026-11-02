(() => {
  "use strict";

  const STORAGE_KEY = "payflow.sandbox.v1";
  const state = {
    apiKey: "",
    merchant: null,
    payment: null,
    lastResponse: "",
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    statusDot: $("statusDot"),
    statusText: $("statusText"),
    statusRetry: $("statusRetry"),
    merchantState: $("merchantState"),
    merchantMeta: $("merchantMeta"),
    merchantName: $("merchantName"),
    merchantKey: $("merchantKey"),
    btnRegister: $("btnRegister"),
    btnReset: $("btnReset"),
    form: $("paymentForm"),
    amount: $("amount"),
    method: $("method"),
    idemKey: $("idemKey"),
    btnCreate: $("btnCreate"),
    btnReplay: $("btnReplay"),
    btnCapture: $("btnCapture"),
    btnRefund: $("btnRefund"),
    paymentState: $("paymentState"),
    settlementMeta: $("settlementMeta"),
    settleGross: $("settleGross"),
    settleFee: $("settleFee"),
    settleTax: $("settleTax"),
    settleNet: $("settleNet"),
    tlCreated: $("tlCreated"),
    tlCaptured: $("tlCaptured"),
    tlRefunded: $("tlRefunded"),
    responseLabel: $("responseLabel"),
    responseStatus: $("responseStatus"),
    responseBody: $("responseBody"),
    copyResponse: $("copyResponse"),
    copyQuickstart: $("copyQuickstart"),
    qsCode: $("qsCode"),
    navToggle: $("navToggle"),
    navLinks: $("navLinks"),
  };

  const randomId = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now()}${Math.random().toString(36).slice(2)}`;

  const inr = (value) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(Number(value || 0));

  const errorMessage = (err) => (err instanceof Error ? err.message : "Something went wrong");

  async function apiFetch(path, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(path, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function readJson(res) {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { success: false, message: text || `HTTP ${res.status}` };
    }
  }

  const SECRET_KEYS = new Set(["api_secret", "password", "accessToken", "refreshToken"]);

  function redact(value) {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [
        key,
        SECRET_KEYS.has(key) ? "••••••redacted" : redact(val),
      ])
    );
  }

  function setStatus(kind, message, retryVisible = false) {
    els.statusDot.className = `dot ${kind}`;
    els.statusText.textContent = message;
    els.statusRetry.hidden = !retryVisible;
  }

  function setResponse(label, status, payload) {
    els.responseLabel.textContent = label;
    const code = Number(status);
    els.responseStatus.textContent = Number.isFinite(code) ? String(code) : "NETWORK";
    els.responseStatus.className = `http-badge ${
      code >= 200 && code < 300 ? "ok" : code >= 400 && code < 500 ? "warn" : "err"
    }`;
    const text =
      typeof payload === "string" ? payload : `${label}\n\n${JSON.stringify(payload, null, 2)}`;
    els.responseBody.textContent = text;
    state.lastResponse = text;
  }

  function setTimeline() {
    const payment = state.payment;
    const status = payment ? payment.status : "created";
    const created = Boolean(payment);
    const captured = ["captured", "partially_refunded", "refunded"].includes(status);
    const refunded = ["partially_refunded", "refunded"].includes(status);

    els.tlCreated.className = `tl-step ${created ? "done" : ""}`;
    els.tlCaptured.className = `tl-step ${captured ? "done" : ""}`;
    els.tlRefunded.className = `tl-step ${refunded ? "done" : ""}`;

    els.tlCreated.querySelector(".badge").textContent = created ? "DONE" : "WAITING";
    els.tlCaptured.querySelector(".badge").textContent = captured
      ? captured && !refunded
        ? "DONE"
        : status === "refunded"
          ? "REFUNDED"
          : "DONE"
      : "WAITING";
    els.tlRefunded.querySelector(".badge").textContent = refunded
      ? status === "refunded"
        ? "FULL"
        : "PARTIAL"
      : "WAITING";
  }

  function render() {
    const { merchant, payment } = state;

    if (merchant) {
      els.merchantState.textContent = "Sandbox merchant ready.";
      els.merchantMeta.hidden = false;
      els.merchantName.textContent = merchant.name;
      els.merchantKey.textContent = `${merchant.api_key.slice(0, 7)}…${merchant.api_key.slice(-4)}`;
      els.btnRegister.hidden = true;
      els.btnReset.hidden = false;
      els.btnCreate.disabled = false;
      els.btnReplay.disabled = false;
      if (!els.idemKey.value) {
        els.idemKey.value = `order-${Date.now()}`;
      }
    } else {
      els.merchantState.textContent = "No sandbox merchant yet.";
      els.merchantMeta.hidden = true;
      els.btnRegister.hidden = false;
      els.btnReset.hidden = true;
      els.btnCreate.disabled = true;
      els.btnReplay.disabled = true;
    }

    if (payment) {
      els.paymentState.textContent = `Payment #${payment.id} — ${payment.status.replace(/_/g, " ")}`;
      els.btnCapture.disabled = payment.status !== "created";
      els.btnRefund.disabled = !["captured", "partially_refunded"].includes(payment.status);
    } else {
      els.paymentState.textContent = "Create a payment first.";
      els.btnCapture.disabled = true;
      els.btnRefund.disabled = true;
    }

    setTimeline();
  }

  function persist() {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ apiKey: state.apiKey, merchant: state.merchant, payment: state.payment })
      );
    } catch {
      /* storage can be unavailable in private mode */
    }
  }

  function restore() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      state.apiKey = saved.apiKey || "";
      state.merchant = saved.merchant || null;
      state.payment = saved.payment || null;
    } catch {
      /* ignore corrupt state */
    }
  }

  function busy(button, label) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "";
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    button.appendChild(spinner);
    button.appendChild(document.createTextNode(label));
    return () => {
      button.textContent = original;
      button.disabled = false;
    };
  }

  function showError(label, err) {
    const isNetwork = err && (err.name === "AbortError" || err instanceof TypeError);
    const message = isNetwork
      ? "Network timeout. The free Render instance may be cold-starting — wait about 30 seconds and retry."
      : errorMessage(err);
    setResponse(label, isNetwork ? "NETWORK" : "ERROR", {
      success: false,
      message,
    });
    setStatus("down", isNetwork ? "API unreachable — waking up" : "API error", isNetwork);
  }

  async function register() {
    const done = busy(els.btnRegister, "Creating…");
    try {
      const email = `sandbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@payflow.dev`;
      const res = await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Sandbox Merchant",
          email,
          password: randomId(),
        }),
      });
      const body = await readJson(res);
      setResponse("POST /api/auth/register", res.status, redact(body));
      if (!res.ok || !body.data) {
        throw new Error(body.message || "Could not create sandbox merchant");
      }
      state.apiKey = body.data.merchant.api_key;
      state.merchant = {
        name: body.data.merchant.name,
        api_key: body.data.merchant.api_key,
      };
      state.payment = null;
      els.idemKey.value = `order-${Date.now()}`;
      persist();
      render();
      setStatus("ok", "Merchant created — sandbox ready");
    } catch (err) {
      showError("POST /api/auth/register", err);
    } finally {
      done();
      els.btnRegister.disabled = false;
      els.btnRegister.hidden = Boolean(state.merchant);
    }
  }

  async function createPayment(replay = false) {
    if (!state.merchant) return;
    const key = (els.idemKey.value || "").trim() || `order-${Date.now()}`;
    els.idemKey.value = key;
    const button = replay ? els.btnReplay : els.btnCreate;
    const done = busy(button, replay ? "Replaying…" : "Creating…");

    try {
      const res = await apiFetch("/api/payments/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": state.apiKey,
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          amount: Number(els.amount.value),
          payment_method: els.method.value,
          customer_name: "Sandbox Customer",
          idempotency_key: key,
        }),
      });
      const body = await readJson(res);
      const replayed = res.headers.get("idempotent-replayed") === "true";
      setResponse(
        `${replay ? "Replay" : "POST"} /api/payments/create${replayed ? " · idempotent replay" : ""}`,
        res.status,
        body
      );
      if (!res.ok || !body.data) {
        throw new Error(body.message || "Payment creation failed");
      }
      state.payment = body.data;
      persist();
      render();
      if (replayed) {
        setStatus("ok", `Replay returned payment #${body.data.id} — no duplicate charge`);
      } else {
        setStatus("ok", `Payment #${body.data.id} created`);
      }
    } catch (err) {
      showError("POST /api/payments/create", err);
    } finally {
      done();
      render();
    }
  }

  async function capture() {
    if (!state.payment) return;
    const done = busy(els.btnCapture, "Capturing…");
    try {
      const res = await apiFetch(`/api/payments/capture/${state.payment.id}`, {
        method: "POST",
        headers: { "x-api-key": state.apiKey },
      });
      const body = await readJson(res);
      setResponse(`POST /api/payments/capture/${state.payment.id}`, res.status, body);
      if (!res.ok || !body.data) {
        throw new Error(body.message || "Capture failed");
      }
      state.payment = body.data.payment;
      persist();
      const settlement = body.data.settlement;
      els.settlementMeta.hidden = false;
      els.settleGross.textContent = inr(settlement.grossAmount);
      els.settleFee.textContent = inr(settlement.platformFee);
      els.settleTax.textContent = inr(settlement.taxAmount);
      els.settleNet.textContent = inr(settlement.netAmount);
      render();
      setStatus("ok", `Payment #${state.payment.id} captured — settlement pending`);
    } catch (err) {
      showError(`POST /api/payments/capture/${state.payment.id}`, err);
    } finally {
      done();
      render();
    }
  }

  async function refund() {
    if (!state.payment) return;
    const done = busy(els.btnRefund, "Refunding…");
    try {
      const res = await apiFetch("/api/refunds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": state.apiKey,
        },
        body: JSON.stringify({
          payment_id: state.payment.id,
          amount: Math.min(200, Number(state.payment.amount)),
          reason: "Sandbox refund",
        }),
      });
      const body = await readJson(res);
      setResponse("POST /api/refunds", res.status, body);
      if (!res.ok || !body.data) {
        throw new Error(body.message || "Refund failed");
      }
      state.payment = {
        ...state.payment,
        status: body.data.payment_status,
      };
      persist();
      render();
      setStatus("ok", `Refund processed — payment ${body.data.payment_status.replace(/_/g, " ")}`);
    } catch (err) {
      showError("POST /api/refunds", err);
    } finally {
      done();
      render();
    }
  }

  function resetSandbox() {
    state.apiKey = "";
    state.merchant = null;
    state.payment = null;
    els.settlementMeta.hidden = true;
    els.btnCapture.disabled = true;
    els.btnRefund.disabled = true;
    els.idemKey.value = "";
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setResponse("API response", "—", "Create a sandbox merchant to begin.");
    render();
    setStatus("ok", "Sandbox reset");
  }

  async function checkHealth() {
    setStatus("", "Checking API status…");
    els.statusRetry.hidden = true;
    try {
      const res = await apiFetch("/api/health", { cache: "no-store" }, 20000);
      const body = await readJson(res);
      if (res.ok && body.db === "connected") {
        setStatus(
          "ok",
          `Operational — DB ${body.dbLatencyMs ?? "?"} ms · up ${body.uptimeSeconds ?? "?"}s`
        );
      } else {
        setStatus("down", "Degraded — database unreachable", true);
      }
    } catch {
      setStatus("down", "API unreachable — free instance may be waking. Retry.", true);
    }
  }

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      const original = button.textContent;
      button.textContent = "Copied ✓";
      setTimeout(() => (button.textContent = original), 1600);
    } catch {
      button.textContent = "Copy failed";
    }
  }

  // events
  els.btnRegister.addEventListener("click", register);
  els.btnReset.addEventListener("click", resetSandbox);
  els.btnCapture.addEventListener("click", capture);
  els.btnRefund.addEventListener("click", refund);
  els.btnReplay.addEventListener("click", () => createPayment(true));
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    createPayment(false);
  });
  els.statusRetry.addEventListener("click", checkHealth);
  els.copyResponse.addEventListener("click", () =>
    copyText(state.lastResponse || els.responseBody.textContent, els.copyResponse)
  );
  els.copyQuickstart.addEventListener("click", () =>
    copyText(els.qsCode.textContent, els.copyQuickstart)
  );
  els.navToggle.addEventListener("click", () => {
    const open = els.navLinks.classList.toggle("open");
    els.navToggle.setAttribute("aria-expanded", String(open));
  });
  els.navLinks.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      els.navLinks.classList.remove("open");
      els.navToggle.setAttribute("aria-expanded", "false");
    }
  });

  restore();
  if (state.payment) {
    els.settlementMeta.hidden = false;
    els.settleGross.textContent = inr(state.payment.amount);
    els.settleFee.textContent = inr(Number(state.payment.amount) * 0.02);
    els.settleTax.textContent = inr(Number(state.payment.amount) * 0.02 * 0.18);
    els.settleNet.textContent = inr(Number(state.payment.amount) * 0.9764);
  }
  render();
  checkHealth();
})();
