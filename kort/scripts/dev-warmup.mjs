const apiUrl = process.env.KORT_API_HEALTH_URL ?? "http://127.0.0.1:8000/health";
const webUrl = process.env.KORT_WEB_URL ?? "http://127.0.0.1:3000/";
const timeoutMs = 60_000;
const pollMs = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, timeout = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout ${timeout}ms`)), timeout);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(url, label, accept) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url);
      if (accept(response.status)) {
        console.log(`[warmup] ${label} ready: ${response.status} ${url}`);
        return true;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error?.message ?? String(error);
    }
    await sleep(pollMs);
  }
  console.warn(`[warmup] ${label} did not become ready after ${Math.round(timeoutMs / 1000)}s: ${lastError}`);
  return false;
}

const apiReady = await waitFor(apiUrl, "api", (status) => status >= 200 && status < 300);
const webReady = await waitFor(webUrl, "web", (status) => status >= 200 && status < 500);

if (apiReady && webReady) {
  console.log("[warmup] dev server is warm. Open http://localhost:3000");
} else {
  console.warn("[warmup] dev server started, but one side did not answer during warmup.");
}
