/**
 * RelayPay Voice Support Agent — Frontend JS
 * ==========================================
 * Handles VAPI Web SDK integration, pre-call form validation,
 * call lifecycle events, transcript display, identity correction,
 * post-call summary parsing, and survey submission.
 */

import VapiModule from "https://cdn.jsdelivr.net/npm/@vapi-ai/web/+esm";
const Vapi = VapiModule.default ?? VapiModule;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const VAPI_PUBLIC_KEY  = "13e8a70b-2915-4829-a3bf-20058808ee3f";
const ASSISTANT_ID     = "0e2c5327-5f95-4883-a530-3661c48541f7";
const SURVEY_WEBHOOK        = "/api/proxy?path=relaypay-submit-survey";
const CALL_SUMMARY_WEBHOOK  = "/api/proxy?path=relaypay-call-summary";

// Authentication is now handled by the Vercel API proxy for security.
// Ensure WEBHOOK_SECRET is set in your Vercel Project Environment Variables.
const WEBHOOK_SECRET = ""; 

// Sentry DSN for error monitoring. Leave empty to disable.
// Get yours free at https://sentry.io — paste the DSN string here.
const SENTRY_DSN = "";

// Initialise Sentry if a DSN is configured.
if (SENTRY_DSN) {
  import("https://browser.sentry-cdn.com/7.99.0/bundle.min.js").then(() => {
    window.Sentry && window.Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.1 });
  }).catch(() => {});
}

// Helper: fetch with a timeout (ms). Rejects with AbortError on timeout.
function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// Helper: build headers for browser-initiated webhook calls.
function webhookHeaders(extra = {}) {
  // Use a simple JSON header. Authentication is now handled via URL parameter to avoid CORS preflight.
  return { "Content-Type": "application/json", ...extra };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let vapiClient    = null;
let callActive    = false;
let userData      = { name: "", email: "" };
let currentCallId = "";
let callStartedAt = "";  // ISO timestamp recorded when call-start fires

// Transcript log for post-call summary parsing
const transcriptLog = [];  // [{ speaker, text }]

// Whether the call actually connected (call-start fired)
let callConnected = false;

// Survey state
let surveyRating   = 0;
let surveyAnswered = "";

// ESC reference captured from tool-call result (not parsed from speech)
let lastEscReference = "";

// Whether caller identity has been injected into the active call via system message
let identityInjected = false;

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  vapiClient = new Vapi(VAPI_PUBLIC_KEY);
  registerVapiEvents();

  const consent = document.getElementById("consentCheck");
  const btn     = document.getElementById("btnStart");
  consent.addEventListener("change", () => {
    btn.disabled = !consent.checked;
  });
  btn.disabled = true;
});

// ---------------------------------------------------------------------------
// Expose functions to HTML onclick handlers (required for ES modules)
// ---------------------------------------------------------------------------
window.handleStart = function () {
  if (!validateForm()) return;
  userData.name  = document.getElementById("fullName").value.trim();
  userData.email = document.getElementById("email").value.trim().toLowerCase();
  showCallView();
  startCall();
};

window.handleEnd = function () {
  if (vapiClient && callActive) {
    vapiClient.stop();
  }
};

// Reload the page to start a fresh call — simplest reliable reset
window.handleNewCall = function () {
  window.location.reload();
};

window.handleViewSummary = function () {
  document.getElementById("btnSummary").disabled = true;
  document.getElementById("btnSummary").textContent = "Loading...";
  fetchAndShowSummary();
};

window.handleRetry = function () {
  // Reset call state
  callConnected    = false;
  callActive       = false;
  currentCallId    = "";
  callStartedAt    = "";
  lastEscReference = "";
  identityInjected = false;
  transcriptLog.length = 0;

  // Reset UI
  document.getElementById("btnEnd").style.display    = "";
  document.getElementById("btnRetry").style.display  = "none";
  document.getElementById("identityToggle").style.display = "";
  document.getElementById("identityPanel").classList.remove("open");
  document.getElementById("errorNotice").classList.remove("visible");
  document.getElementById("errorNotice").textContent = "";

  // Clear transcript
  const t = document.getElementById("transcript");
  t.innerHTML = '<span class="transcript-placeholder">Your conversation will appear here.</span>';

  // Restart the call (name/email already captured)
  setStatus("active", "Reconnecting...");
  startCall();
};

// Identity correction panel
window.toggleIdentityPanel = function () {
  const panel = document.getElementById("identityPanel");
  panel.classList.toggle("open");
  // Pre-fill with current userData
  if (panel.classList.contains("open")) {
    document.getElementById("correctedName").value  = userData.name;
    document.getElementById("correctedEmail").value = userData.email;
  }
};

window.updateIdentity = function (field) {
  if (field === "name") {
    const val = document.getElementById("correctedName").value.trim();
    if (!val) return;
    userData.name = val;
    injectIdentityCorrection();
  } else {
    const val = document.getElementById("correctedEmail").value.trim().toLowerCase();
    if (!val) return;
    userData.email = val;
    injectIdentityCorrection();
  }
};

// Survey callbacks
window.setRating = function (val) {
  surveyRating = val;
  document.querySelectorAll("#starRating button").forEach((btn, i) => {
    btn.classList.toggle("active", i < val);
  });
};

window.setAnswered = function (val) {
  surveyAnswered = val;
  document.querySelectorAll(".answer-opt").forEach(btn => {
    btn.classList.toggle("selected", btn.textContent.toLowerCase() === val);
  });
};

window.submitSurvey = async function () {
  const btn      = document.getElementById("btnSurvey");
  const feedback = document.getElementById("surveyFeedback").value.trim();

  // Validation — require at least a star rating and an answered selection.
  const validationEl = document.getElementById("surveyValidation");
  if (surveyRating === 0 || surveyAnswered === "") {
    validationEl.textContent = "Please select a star rating and whether your question was answered.";
    validationEl.style.display = "block";
    return;
  }
  validationEl.style.display = "none";

  btn.disabled = true;
  btn.textContent = "Submitting...";

  try {
    await fetchWithTimeout(`${SURVEY_WEBHOOK}`, {
      method: "POST",
      headers: webhookHeaders(),
      body: JSON.stringify({
        call_id:    currentCallId,
        user_name:  userData.name,
        user_email: userData.email,
        rating:     surveyRating,
        answered:   surveyAnswered,
        feedback:   feedback || null,
      }),
    }, 15000);
  } catch (err) {
    // Survey failure is non-critical — always show thanks.
    // Capture to Sentry if configured.
    if (window.Sentry) window.Sentry.captureException(err);
  }

  document.getElementById("surveyForm").style.display  = "none";
  document.getElementById("surveyThanks").classList.add("visible");
};

// ---------------------------------------------------------------------------
// Form validation
// ---------------------------------------------------------------------------
function validateForm() {
  let valid = true;

  const nameInput  = document.getElementById("fullName");
  const emailInput = document.getElementById("email");
  const nameError  = document.getElementById("nameError");
  const emailError = document.getElementById("emailError");

  nameInput.classList.remove("error");
  emailInput.classList.remove("error");
  nameError.classList.remove("visible");
  emailError.classList.remove("visible");

  if (!nameInput.value.trim()) {
    nameInput.classList.add("error");
    nameError.classList.add("visible");
    valid = false;
  }

  // Requires TLD of at least 2 alpha characters — rejects a@b.c and similar
  const emailRegex = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  if (!emailRegex.test(emailInput.value.trim())) {
    emailInput.classList.add("error");
    emailError.classList.add("visible");
    valid = false;
  }

  if (!document.getElementById("consentCheck").checked) {
    valid = false;
  }

  return valid;
}

// ---------------------------------------------------------------------------
// VAPI call lifecycle
// ---------------------------------------------------------------------------
function startCall() {
  setStatus("active", "Connecting...");

  vapiClient.start(ASSISTANT_ID, {
    // variableValues substitutes {{customer_name}} and {{customer_email}} in the system prompt
    // so the agent knows the caller's identity before it speaks a single word.
    variableValues: {
      customer_name:  userData.name,
      customer_email: userData.email,
    },
    metadata: {
      customer: {
        name:  userData.name,
        email: userData.email,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// VAPI event handlers
// ---------------------------------------------------------------------------
function registerVapiEvents() {
  vapiClient.on("call-start", (call) => {
    callActive    = true;
    callConnected = true;
    callStartedAt = new Date().toISOString();
    // Try multiple paths — VAPI SDK structure varies by version
    currentCallId = (call && (call.id || call.callId || (call.call && call.call.id))) || "";
    setStatus("active", "Connected — listening");
    clearTranscriptPlaceholder();
    // Hide retry button in case this is a retry attempt
    document.getElementById("btnEnd").style.display   = "";
    document.getElementById("btnRetry").style.display = "none";
    document.getElementById("errorNotice").classList.remove("visible");

    // Identity is injected via variableValues in startCall() which substitutes
    // {{customer_name}} and {{customer_email}} in the system prompt before the
    // LLM generates its first word. No runtime send needed here — sending a
    // system message during TTS playback cuts off the agent's first sentence.
  });

  vapiClient.on("call-end", () => {
    callActive = false;
    if (callConnected) {
      // Normal end — show status and a button to view summary
      setStatus("", "Call ended");
      appendTranscript("System", "Call ended. Thank you for contacting RelayPay.");
      document.getElementById("btnEnd").style.display         = "none";
      document.getElementById("btnSummary").style.display     = "";
    } else {
      // Call never connected — keep error UI visible, don't show summary
      setStatus("", "Call did not connect");
    }
  });

  vapiClient.on("speech-start", () => {
    setStatus("speaking", "Agent speaking...");
  });

  vapiClient.on("speech-end", () => {
    if (callActive) setStatus("active", "Listening...");
    // Inject caller identity on first speech-end (agent has finished its opening line).
    // Using speech-end rather than call-start avoids interrupting TTS audio.
    if (!identityInjected && callActive && userData.name) {
      identityInjected = true;
      vapiClient.send({
        type: "add-message",
        message: {
          role: "system",
          content: `Caller pre-filled form details: name is "${userData.name}", email is "${userData.email}". When you reach the identity confirmation step during escalation, present these values to the caller and ask them to confirm or correct them.`,
        },
      });
    }
  });

  vapiClient.on("message", (message) => {
    // Capture real VAPI call ID from any message that carries it
    if (!currentCallId) {
      const id = message?.call?.id || message?.callId || message?.call_id;
      if (id) currentCallId = id;
    }

    if (message.type === "transcript") {
      if (message.role === "assistant" && message.transcriptType === "final") {
        appendTranscript("Agent", message.transcript);
      }
      if (message.role === "user" && message.transcriptType === "final") {
        appendTranscript("You", message.transcript);
      }
    }

    // Capture ESC reference from log_escalation tool result (reliable source vs. speech parsing).
    // VAPI Web SDK emits tool results inside transcript messages as role="tool",
    // and also as separate tool-calls-result events — check both.
    if (
      message.type === "tool-calls-result" ||
      message.type === "tool-call-result" ||
      message.type === "tool-calls" ||
      (message.type === "transcript" && message.role === "tool")
    ) {
      const results =
        message.toolCallResults ||
        message.results ||
        (message.toolCalls && message.toolCalls.map(tc => tc.result)) ||
        [];
      results.forEach(r => {
        const text = String(r.result || r || "");
        const escMatch = text.match(/ESC-[A-Z0-9]{4,8}/);
        if (escMatch) lastEscReference = escMatch[0];
      });
    }

    // Fallback: scan any assistant transcript for ESC reference
    // (covers cases where the agent reads it out in a structured way)
    if (message.type === "transcript" && message.role === "assistant" && message.transcriptType === "final") {
      const escMatch = message.transcript.match(/ESC-[A-Z0-9]{4,8}/i);
      if (escMatch && !lastEscReference) lastEscReference = escMatch[0].toUpperCase();
    }
  });

  vapiClient.on("error", (error) => {
    console.error("VAPI error:", error);
    // Report unexpected errors to Sentry (if configured).
    if (window.Sentry && error) window.Sentry.captureException(
      error instanceof Error ? error : new Error(String(error?.message || error))
    );
    // VAPI fires an error event for WebRTC closing even on clean agent-initiated
    // hangups. Delay 600ms so call-end (which fires first) can set callActive=false.
    // After the delay, if call-end already ran (callActive=false, callConnected=true)
    // we know it was a clean end and skip the error banner.
    setTimeout(() => {
      if (!callActive && callConnected) return;
      callActive = false;
      showErrorRetry("We couldn't connect to the support line. Please try again.");
    }, 600);
  });
}

// ---------------------------------------------------------------------------
// Identity correction
// ---------------------------------------------------------------------------
function injectIdentityCorrection() {
  if (!vapiClient || !callActive) return;
  vapiClient.send({
    type: "add-message",
    message: {
      role:    "system",
      content: `Caller correction: their name is "${userData.name}" and email is "${userData.email}". Use these exact values for any booking or escalation.`,
    },
  });
  const fb = document.getElementById("identityFeedback");
  fb.classList.add("visible");
  setTimeout(() => fb.classList.remove("visible"), 3000);
}

// ---------------------------------------------------------------------------
// Post-call summary
// ---------------------------------------------------------------------------
async function fetchAndShowSummary() {
  document.getElementById("callView").style.display = "none";
  document.getElementById("summaryView").classList.add("visible");

  const container = document.getElementById("summaryItems");
  container.innerHTML = '<div class="summary-empty">Fetching your call summary...</div>';

  // Fetch ESC reference from call_summary webhook, with one auto-retry if the
  // call_ended webhook hasn't written to call_logs yet (found: false / retry: true).
  let escRef = lastEscReference;

  const fetchSummary = async () => {
    try {
      const params = new URLSearchParams();
      if (currentCallId) params.set("call_id", currentCallId);
      if (userData.email) params.set("email", userData.email);
      if (callStartedAt) params.set("started_after", callStartedAt);
      params.set("token", WEBHOOK_SECRET);
      const res = await fetchWithTimeout(
        `${CALL_SUMMARY_WEBHOOK}?${params}`,
        { headers: webhookHeaders() },
        15000
      );
      if (res.ok) return await res.json();
    } catch (err) {
      if (window.Sentry && err.name !== "AbortError") window.Sentry.captureException(err);
    }
    return null;
  };

  let data = await fetchSummary();

  // If call_ended hasn't finished yet, wait 10 s and retry once
  if (!data || data.found === false) {
    container.innerHTML = '<div class="summary-empty">Still processing — checking again in a moment...</div>';
    await new Promise(r => setTimeout(r, 10000));
    data = await fetchSummary();
  }

  if (data && data.escalation_ref) escRef = data.escalation_ref;
  // Sync currentCallId with the real call_id returned by the webhook
  // so the survey submission uses the correct ID even when VAPI didn't provide it.
  if (data && data.call_id) currentCallId = data.call_id;

  const items = [];

  if (escRef) {
    items.push({ label: "Reference number", value: escRef, cls: "ref" });
    const email = (data && data.user_email) || userData.email;
    if (email) {
      items.push({ label: "Confirmation sent to", value: email });
    }
    items.push({
      label: "Next step",
      value: "A confirmation email is on its way. Our team will call you at the booked time.",
      cls: "muted"
    });
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="summary-empty">No callback was booked during this call. <a href="mailto:support@relaypay.io" style="color:var(--blue-accent)">Email us</a> if you need further help.</div>';
  } else {
    container.innerHTML = items.map(item =>
      `<div class="summary-item">
        <div class="summary-label">${item.label}</div>
        <div class="summary-value${item.cls ? ' ' + item.cls : ''}">${item.value}</div>
      </div>`
    ).join("");
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function showCallView() {
  document.getElementById("formView").style.display = "none";
  document.getElementById("callView").classList.add("visible");
}

function setStatus(state, text) {
  document.getElementById("statusDot").className  = "status-dot " + state;
  document.getElementById("statusText").textContent = text;
}

function clearTranscriptPlaceholder() {
  const placeholder = document.getElementById("transcript").querySelector(".transcript-placeholder");
  if (placeholder) placeholder.remove();
}

function showErrorRetry(message) {
  setStatus("", "Connection failed");
  const notice = document.getElementById("errorNotice");
  notice.textContent = message;
  notice.classList.add("visible");
  document.getElementById("btnEnd").style.display    = "none";
  document.getElementById("btnRetry").style.display  = "";
  document.getElementById("identityToggle").style.display = "none";
  document.getElementById("identityPanel").classList.remove("open");
}

function appendTranscript(speaker, text) {
  // Add to transcript log for summary parsing
  transcriptLog.push({ speaker, text });

  const t      = document.getElementById("transcript");
  const entry  = document.createElement("p");
  entry.className = "transcript-entry";

  const strong = document.createElement("strong");
  strong.textContent = speaker + ": ";
  const span = document.createElement("span");
  span.textContent = text;

  entry.appendChild(strong);
  entry.appendChild(span);
  t.appendChild(entry);
  t.scrollTop = t.scrollHeight;
}
