import { chromium } from "playwright";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const port = process.env.E2E_PORT || "4180";
const baseUrl = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}/`;
const headless = process.env.HEADLESS !== "0";

const server = spawn(
  "npx",
  ["vite", "preview", "--port", port, "--host", "127.0.0.1"],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
);

server.stdout.on("data", () => {});
server.stderr.on("data", () => {});

function stopServer() {
  if (!server.killed) server.kill("SIGTERM");
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server not ready at ${baseUrl}`);
}

// Artifact helpers
const ARTIFACTS_DIR = "artifacts";
try { mkdirSync(ARTIFACTS_DIR, { recursive: true }); } catch {}

async function saveArtifacts(page, role) {
  try {
    await page.screenshot({ path: `${ARTIFACTS_DIR}/manual-${role}.png`, fullPage: true });
    const html = await page.content();
    writeFileSync(`${ARTIFACTS_DIR}/manual-${role}.html`, html);
  } catch {}
}

let browser;
let passed = 0;
let failed = 0;

function pass(name) {
  passed++;
  console.log(`PASS ${name}`);
}

function fail(name, err) {
  failed++;
  console.error(`FAIL ${name}: ${err.message}`);
}

try {
  await waitForServer();
  browser = await chromium.launch({
    headless,
    args: ["--use-fake-ui-for-media-stream"],
  });

  // ===== Manual Fallback E2E Test =====
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await context.grantPermissions(["microphone"], { origin: baseUrl });

    // Open host
    const hostPage = await context.newPage();
    await hostPage.goto(`${baseUrl}/host/`, { waitUntil: "networkidle" });
    await hostPage.waitForSelector("#hostRoomCode", { timeout: 10000 });
    const roomCode = await hostPage.locator("#hostRoomCode").innerText();

    // Open player
    const playerPage = await context.newPage();
    await playerPage.goto(`${baseUrl}/player/?room=${roomCode}`, { waitUntil: "networkidle" });
    await playerPage.waitForSelector("#joinRoom", { timeout: 10000 });

    // Player opens manual fallback toggle
    await playerPage.click("#playerManualFallbackToggle summary");
    await playerPage.waitForSelector("#makeOffer", { timeout: 5000 });

    // Player clicks #makeOffer
    await playerPage.click("#makeOffer");
    await playerPage.waitForSelector("#offerOut [data-single-qr] svg", { timeout: 10000 });
    const offer = await playerPage.locator("#offerOut textarea").first().inputValue();
    assert.match(offer, /#signal=ck1\./, "Manual offer generated");

    // Host opens manual pairing toggle
    await hostPage.click("#manualPairingToggle summary");
    await hostPage.waitForSelector("#manualPairingPanel #offer", { timeout: 5000 });

    // Host pastes offer and clicks #answerOffer
    await hostPage.fill("#offer", offer);
    await hostPage.click("#answerOffer");
    await hostPage.waitForSelector("#answerOut [data-single-qr] svg", { timeout: 10000 });
    const answer = await hostPage.locator("#answerOut textarea").first().inputValue();
    assert.match(answer, /#signal=ck1\./, "Manual answer generated");

    // Player imports answer (answer textarea is in the manual fallback panel)
    await playerPage.fill("#answer", answer);
    await playerPage.click("#importAnswer");

    // DataChannel opens
    await playerPage.waitForFunction(
      () => document.querySelector("#log")?.textContent?.includes("DataChannel open"),
      null,
      { timeout: 15000 },
    );

    // Host receives ROOM_HELLO
    await hostPage.waitForFunction(
      () => document.querySelector("#log")?.textContent?.includes("ROOM_HELLO"),
      null,
      { timeout: 15000 },
    );

    pass("Manual fallback still works");

    await hostPage.close();
    await playerPage.close();
    await context.close();
  } catch (e) {
    fail("Manual fallback still works", e);
    try {
      const pages = browser.contexts()[0]?.pages() || [];
      for (let i = 0; i < pages.length; i++) {
        await saveArtifacts(pages[i], `page-${i}`);
      }
    } catch {}
    try { await browser.contexts()[0]?.close(); } catch {}
  }

} catch (e) {
  console.error(`Setup failed: ${e.message}`);
} finally {
  if (browser) await browser.close();
  stopServer();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
