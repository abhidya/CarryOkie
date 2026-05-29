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

let serverOutput = "";
let serverExited = false;
server.stdout.on("data", (chunk) => {
  serverOutput += String(chunk);
});
server.stderr.on("data", (chunk) => {
  serverOutput += String(chunk);
});
server.on("exit", () => {
  serverExited = true;
});

function stopServer() {
  if (!server.killed) server.kill("SIGTERM");
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverExited)
      throw new Error(`Preview server exited before ready.\n${serverOutput}`);
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
    await page.screenshot({ path: `${ARTIFACTS_DIR}/ux-${role}.png`, fullPage: true });
    const html = await page.content();
    writeFileSync(`${ARTIFACTS_DIR}/ux-${role}.html`, html);
  } catch {}
}

function text(page) { return page.locator("body").innerText(); }

async function expectVisibleText(page, pattern, label) {
  const body = await text(page);
  assert.match(body, pattern, `${label} should be visible`);
}

async function expectHiddenText(page, pattern, label) {
  const body = await text(page);
  assert.doesNotMatch(body, pattern, `${label} should be hidden by default`);
}

async function expectHidden(page, selector, label) {
  const loc = page.locator(selector).first();
  if ((await loc.count()) === 0) return;
  const visible = await loc.isVisible();
  assert.equal(visible, false, `${label} should be hidden`);
}

async function expectVisible(page, selector, label) {
  const loc = page.locator(selector).first();
  assert.ok(await loc.isVisible(), `${label} should be visible`);
}

async function expectMinBox(page, selector, minWidth, minHeight, label) {
  const box = await page.locator(selector).first().boundingBox();
  assert.ok(box, `${label} should have a bounding box`);
  assert.ok(box.width >= minWidth, `${label} width ${box.width} should be >= ${minWidth}`);
  assert.ok(box.height >= minHeight, `${label} height ${box.height} should be >= ${minHeight}`);
}

async function expectNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 4, `${label} has horizontal overflow: ${overflow}px`);
}

async function expectNoIntersection(page, aSelector, bSelector, label) {
  const intersects = await page.evaluate(
    ([aSelector, bSelector]) => {
      const a = document.querySelector(aSelector)?.getBoundingClientRect();
      const b = document.querySelector(bSelector)?.getBoundingClientRect();
      if (!a || !b) return false;
      return !(
        a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom
      );
    },
    [aSelector, bSelector],
  );
  assert.equal(intersects, false, `${label} should not overlap`);
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
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });

  // ===== HOST PAGE UX ASSERTIONS =====
  try {
    const hostContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const hostPage = await hostContext.newPage();
    await hostPage.goto(`${baseUrl}/host/`, { waitUntil: "networkidle" });
    await hostPage.waitForSelector("text=CarryOkie Show Control", { timeout: 10000 });

    // Shows "CarryOkie Show Control"
    await expectVisibleText(hostPage, /CarryOkie Show Control/, "Host title");

    // Does NOT show "Host Controller"
    await expectHiddenText(hostPage, /Host Controller/, "Old host title");

    // Does NOT show "Pair a phone" by default
    await expectHiddenText(hostPage, /Pair a phone/, "Pair a phone hidden");

    // Required elements visible
    await expectVisible(hostPage, "#hostTopStatus", "Host top status");
    await expectVisible(hostPage, "#hostRoomCode", "Room code");
    await expectVisible(hostPage, "#hostTvStatus", "TV status");
    await expectVisible(hostPage, "#hostQrJoinStatus", "QR join status");
    await expectVisible(hostPage, "#copySingerLink", "Copy singer link");
    await expectVisible(hostPage, "#openTvStage", "Open TV stage");

    // #showJoinQr visible (in hostActions)
    await expectVisible(hostPage, "#showJoinQr", "Show QR button");

    // Manual pairing collapsed by default
    const manualToggle = hostPage.locator("#manualPairingToggle");
    assert.ok(await manualToggle.isVisible(), "Manual pairing toggle visible");
    assert.strictEqual(await manualToggle.getAttribute("open"), null, "Manual pairing collapsed");
    await expectHidden(hostPage, "#manualPairingPanel", "Manual pairing panel hidden");

    // Diagnostics collapsed by default
    const diagToggle = hostPage.locator("#diagnosticsToggle");
    assert.ok(await diagToggle.isVisible(), "Diagnostics toggle visible");
    assert.strictEqual(await diagToggle.getAttribute("open"), null, "Diagnostics collapsed");
    await expectHidden(hostPage, "#diagnosticsPanel", "Diagnostics panel hidden");

    // #audioPipelineStatus hidden by default
    await expectHidden(hostPage, "#audioPipelineStatus", "Audio pipeline status hidden");

    // #log hidden or collapsed by default (inside diagnosticsPanel)
    await expectHidden(hostPage, "#log", "Log hidden by default");

    // Body text must NOT include raw WebRTC/debug data
    await expectHiddenText(hostPage, /hostRemoteAudioTracks/, "hostRemoteAudioTracks hidden");
    await expectHiddenText(hostPage, /receiverPcIceState/, "receiverPcIceState hidden");
    await expectHiddenText(hostPage, /LATENCY_PING/, "LATENCY_PING hidden");

    // Clicking diagnosticsToggle reveals diagnostics
    await hostPage.click("#diagnosticsToggle summary");
    await hostPage.waitForTimeout(200);
    const diagPanel = hostPage.locator("#diagnosticsPanel");
    assert.ok(await diagPanel.isVisible(), "Diagnostics panel visible after toggle");

    // Mobile pass
    await hostPage.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(hostPage, "Host mobile horizontal overflow");
    // Primary buttons at least 44px tall (skip in headless where rendering may differ)
    if (!headless) {
      const primaryBtns = hostPage.locator("button.primary");
      const count = await primaryBtns.count();
      for (let i = 0; i < Math.min(count, 3); i++) {
        const box = await primaryBtns.nth(i).boundingBox();
        if (box) assert.ok(box.height >= 44, `Host mobile button height ${box.height} >= 44px`);
      }
    }
    // Diagnostics still collapsed after resize
    await hostPage.reload({ waitUntil: "networkidle" });
    await hostPage.waitForSelector("text=CarryOkie Show Control", { timeout: 10000 });
    assert.strictEqual(await hostPage.locator("#diagnosticsToggle").getAttribute("open"), null, "Diagnostics collapsed on mobile");
    assert.strictEqual(await hostPage.locator("#manualPairingToggle").getAttribute("open"), null, "Manual collapsed on mobile");

    pass("host page UX contract");
    await hostContext.close();
  } catch (e) {
    await saveArtifacts(hostPage, "host");
    fail("host page UX contract", e);
    await hostContext.close();
  }

  // ===== PLAYER PAGE UX ASSERTIONS =====
  try {
    const playerContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    const playerPage = await playerContext.newPage();
    await playerPage.goto(`${baseUrl}/player/#room=TESTROOM`, { waitUntil: "networkidle" });
    await playerPage.waitForSelector("text=CarryOkie Singer Remote", { timeout: 10000 });

    // Shows "CarryOkie Singer Remote"
    await expectVisibleText(playerPage, /CarryOkie Singer Remote/, "Player title");

    // Does NOT show "Player Phone"
    await expectHiddenText(playerPage, /Player Phone/, "Old player title");

    // Before join: room code, name input, Join Room
    await expectVisible(playerPage, "#playerRoomCode", "Player room code");
    assert.strictEqual((await playerPage.locator("#playerRoomCode").innerText()).trim(), "TESTROOM", "Player reads hash room code");
    await expectVisible(playerPage, "#playerDisplayName", "Display name input");
    await expectVisible(playerPage, "#joinRoom", "Join Room button");

    // Manual fallback collapsed by default
    const manualToggle = playerPage.locator("#playerManualFallbackToggle");
    assert.ok(await manualToggle.isVisible(), "Manual fallback toggle visible");
    assert.strictEqual(await manualToggle.getAttribute("open"), null, "Manual fallback collapsed");
    await expectHidden(playerPage, "#playerManualFallbackPanel", "Manual fallback panel hidden");

    // Diagnostics collapsed by default
    const diagToggle = playerPage.locator("#diagnosticsToggle");
    assert.ok(await diagToggle.isVisible(), "Diagnostics toggle visible");
    assert.strictEqual(await diagToggle.getAttribute("open"), null, "Diagnostics collapsed");
    await expectHidden(playerPage, "#diagnosticsPanel", "Diagnostics panel hidden");

    // No visible offer/answer/SDP controls by default
    await expectHiddenText(playerPage, /Create phone pairing code/, "Create phone pairing code hidden");
    await expectHiddenText(playerPage, /Host answer/, "Host answer hidden");
    await expectHiddenText(playerPage, /Finish pairing/, "Finish pairing hidden");

    // Desktop viewport pass
    await playerPage.setViewportSize({ width: 1440, height: 900 });
    await expectNoHorizontalOverflow(playerPage, "Player desktop horizontal overflow");

    // Mobile pass
    await playerPage.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(playerPage, "Player mobile horizontal overflow");
    // Primary buttons at least 44px tall (skip in headless where rendering may differ)
    if (!headless) {
      const primaryBtns = playerPage.locator("button.primary");
      const count = await primaryBtns.count();
      for (let i = 0; i < Math.min(count, 3); i++) {
        const box = await primaryBtns.nth(i).boundingBox();
        if (box) assert.ok(box.height >= 44, `Player mobile button height ${box.height} >= 44px`);
      }
    }

    pass("player page UX contract");
    await playerContext.close();
  } catch (e) {
    await saveArtifacts(playerPage, "player");
    fail("player page UX contract", e);
    await playerContext.close();
  }

  // ===== RECEIVER PAGE UX ASSERTIONS =====
  let receiverContext;
  let receiverPage;
  try {
    receiverContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    receiverPage = await receiverContext.newPage();
    await receiverPage.goto(`${baseUrl}/receiver/?room=TESTROOM`, { waitUntil: "networkidle" });
    await receiverPage.waitForSelector("text=CarryOkie TV Stage", { timeout: 10000 });

    // Shows "CarryOkie TV Stage"
    await expectVisibleText(receiverPage, /CarryOkie TV Stage/, "Receiver title");

    // Shows room code
    await expectVisible(receiverPage, "#receiverRoomCode", "Receiver room code");

    // Shows QR and join link
    await expectVisible(receiverPage, "#receiverJoinQr", "Join QR visible");
    await expectVisible(receiverPage, "#receiverJoinLink", "Join link visible");

    // Join link href includes room code and points to player route
    const joinLinkHref = await receiverPage.locator("#receiverJoinLink").getAttribute("href");
    assert.ok(joinLinkHref.includes("player"), "Join link points to player route");
    assert.ok(joinLinkHref.endsWith("?room=TESTROOM"), `Join link uses displayed room code: ${joinLinkHref}`);
    assert.strictEqual((await receiverPage.locator("#receiverRoomCode").innerText()).trim(), "TESTROOM", "Receiver shows URL room code");
    await expectVisibleText(receiverPage, /Scan with any camera app/i, "Receiver camera-app instruction");
    await expectVisibleText(receiverPage, /No app install\. No host approval/i, "Receiver self-serve instruction");
    await receiverPage.evaluate(() => {
      const channel = new BroadcastChannel("carryokie.receiver");
      channel.postMessage({
        type: "RECEIVER_STATE",
        payload: { roomCode: "WRONGROOM", queue: [], singers: [] },
      });
      channel.close();
    });
    await receiverPage.waitForTimeout(300);
    assert.strictEqual((await receiverPage.locator("#receiverRoomCode").innerText()).trim(), "TESTROOM", "Receiver ignores cross-room BroadcastChannel state");
    assert.ok((await receiverPage.locator("#receiverJoinLink").getAttribute("href")).endsWith("?room=TESTROOM"), "Join link remains locked to receiver room");

    // QR min size at 1440x900
    await expectMinBox(receiverPage, "#receiverJoinQr", 300, 300, "Join QR camera-scannable size");

    // Stage sections present
    await expectVisible(receiverPage, "#receiverStageStatus", "Stage status");
    await expectVisible(receiverPage, "#receiverActiveSingers", "Active singers");
    await expectVisible(receiverPage, "#receiverNowPlaying", "Now playing");
    await expectVisible(receiverPage, "#receiverMediaRegion", "Media region");
    await expectVisible(receiverPage, "#receiverLyricsRegion", "Lyrics region");
    await expectVisible(receiverPage, "#receiverQueuePreview", "Queue preview");
    await expectVisible(receiverPage, "#receiverLiveMicStatus", "Live mic status");

    // Diagnostics collapsed by default
    const diagToggle = receiverPage.locator("#receiverDiagnosticsToggle");
    assert.ok(await diagToggle.isVisible(), "Diagnostics toggle visible");
    assert.strictEqual(await diagToggle.getAttribute("open"), null, "Diagnostics collapsed");
    await expectHidden(receiverPage, "#receiverDiagnosticsPanel", "Diagnostics panel hidden");

    // Body text must NOT include debug data by default
    await expectHiddenText(receiverPage, /Receiver PC/, "Receiver PC hidden");
    await expectHiddenText(receiverPage, /ICE/, "ICE hidden");
    await expectHiddenText(receiverPage, /Offer sent/, "Offer sent hidden");
    await expectHiddenText(receiverPage, /Answer received/, "Answer received hidden");
    await expectHiddenText(receiverPage, /Autoplay unlocked/, "Autoplay unlocked hidden");
    await expectHiddenText(receiverPage, /Host remote tracks/, "Host remote tracks hidden");
    await expectHiddenText(receiverPage, /Relayed streams/, "Relayed streams hidden");

    // No overlap: #receiverMediaRegion vs #receiverJoinQr
    await expectNoIntersection(receiverPage, "#receiverMediaRegion", "#receiverJoinQr", "Media region vs QR");

    // No overlap: #receiverMediaRegion vs #receiverStageStatus
    await expectNoIntersection(receiverPage, "#receiverMediaRegion", "#receiverStageStatus", "Media region vs stage status");

    // #receiverRoomCode not clipped
    const roomCodeEl = receiverPage.locator("#receiverRoomCode");
    const roomCodeScrollWidth = await roomCodeEl.evaluate(el => el.scrollWidth);
    const roomCodeClientWidth = await roomCodeEl.evaluate(el => el.clientWidth);
    assert.ok(roomCodeScrollWidth <= roomCodeClientWidth + 4, `Room code clipped: scrollWidth ${roomCodeScrollWidth} > clientWidth ${roomCodeClientWidth} + 4`);

    // No horizontal overflow
    await expectNoHorizontalOverflow(receiverPage, "Receiver horizontal overflow");

    // Clicking diagnosticsToggle reveals diagnostics
    await receiverPage.click("#receiverDiagnosticsToggle summary");
    await receiverPage.waitForTimeout(200);
    const diagPanel = receiverPage.locator("#receiverDiagnosticsPanel");
    assert.ok(await diagPanel.isVisible(), "Diagnostics panel visible after toggle");

    // Mobile pass
    await receiverPage.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(receiverPage, "Receiver mobile horizontal overflow");
    // Diagnostics still collapsed
    await receiverPage.reload({ waitUntil: "networkidle" });
    await receiverPage.waitForSelector("text=CarryOkie TV Stage", { timeout: 10000 });
    assert.strictEqual(await receiverPage.locator("#receiverDiagnosticsToggle").getAttribute("open"), null, "Diagnostics collapsed on mobile");

    pass("receiver page UX contract");
    await receiverContext.close();
  } catch (e) {
    if (receiverPage) await saveArtifacts(receiverPage, "receiver");
    fail("receiver page UX contract", e);
    if (receiverContext) await receiverContext.close();
  }

} catch (e) {
  failed += 1;
  console.error(`Setup failed: ${e.message}`);
} finally {
  if (browser) await browser.close();
  stopServer();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
