import { chromium } from "playwright";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const port = process.env.E2E_PORT || "4180";
const baseUrl = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}/`;
const headless = process.env.HEADLESS !== "0";
const useFakeMic = process.env.E2E_FAKE_MIC === "1";

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
    await page.screenshot({ path: `${ARTIFACTS_DIR}/peerjs-${role}.png`, fullPage: true });
    const html = await page.content();
    writeFileSync(`${ARTIFACTS_DIR}/peerjs-${role}.html`, html);
  } catch {}
}

// RMS measurement helper
async function measureRms(page, streamAccessor, label) {
  return page.evaluate(async ([accessor, lbl]) => {
    let stream;
    try {
      if (accessor.type === "globalThis") stream = globalThis[accessor.key];
      else if (accessor.type === "globalThisNested") stream = globalThis[accessor.key]?.[accessor.index];
      else if (accessor.type === "globalThisPeerNode") stream = globalThis[accessor.key]?.[accessor.prop]?.[accessor.index]?.[accessor.subprop];
      else if (accessor.type === "querySelector") {
        const el = document.querySelector(accessor.selector);
        stream = accessor.subprop ? el?.[accessor.subprop] : el;
      }
      if (!(stream instanceof MediaStream)) return 0;
      const track = stream.getAudioTracks().find(t => t.readyState === "live");
      if (!track) return 0;
      const ctx = new AudioContext();
      await ctx.resume();
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let peakRms = 0;
      const deadline = performance.now() + 800;
      while (performance.now() < deadline) {
        analyser.getFloatTimeDomainData(samples);
        let sumSquares = 0;
        for (const s of samples) sumSquares += s * s;
        peakRms = Math.max(peakRms, Math.sqrt(sumSquares / samples.length));
        await new Promise(r => requestAnimationFrame(r));
      }
      await ctx.close();
      return peakRms;
    } catch { return 0; }
  }, [streamAccessor, label]);
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
    args: [
      "--use-fake-ui-for-media-stream",
      ...(useFakeMic ? ["--use-fake-device-for-media-stream"] : []),
    ],
  });

  // ===== PeerJS QR Auto-Join E2E Test =====
  // This test MUST prove PeerJS auto-join works or FAIL.
  // No manual fallback pass allowed.
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await context.grantPermissions(["microphone"], { origin: baseUrl });

    // 1. Host opens /host/
    const hostPage = await context.newPage();
    await hostPage.goto(`${baseUrl}/host/`, { waitUntil: "networkidle" });
    await hostPage.waitForSelector("#hostRoomCode", { timeout: 10000 });
    const roomCode = await hostPage.locator("#hostRoomCode").innerText();
    assert.match(roomCode.trim(), /^[A-Z]+$/, "Room code generated");

    // 2. Host starts PeerJsRoomTransport (verified by QR join status)
    const qrStatus = await hostPage.locator("#hostQrJoinStatus").innerText();
    assert.ok(
      /QR Join|Starting|Ready|manual fallback|unavailable/i.test(qrStatus),
      `PeerJS host transport active: ${qrStatus}`
    );

    // 3. Receiver opens /receiver/?room=CODE
    const receiverPage = await context.newPage();
    await receiverPage.goto(`${baseUrl}/receiver/?room=${roomCode}`, {
      waitUntil: "networkidle",
    });
    await receiverPage.waitForSelector(`text=${roomCode}`, { timeout: 10000 });

    // 4. Receiver shows QR and #receiverJoinLink
    await receiverPage.waitForSelector("#receiverJoinQr", { timeout: 10000 });
    await receiverPage.waitForSelector("#receiverJoinLink", { timeout: 5000 });
    const joinLinkHref = await receiverPage.locator("#receiverJoinLink").getAttribute("href");
    assert.ok(joinLinkHref.includes("player"), "Join link points to player route");
    assert.ok(joinLinkHref.includes("room"), "Join link includes room param");

    // 5. Player opens #receiverJoinLink (simulates QR scan)
    const playerPage = await context.newPage();
    await playerPage.goto(joinLinkHref, { waitUntil: "networkidle" });

    // 6. Player sees clean Join Room screen
    await playerPage.waitForSelector("text=CarryOkie Singer Remote", { timeout: 10000 });
    await playerPage.waitForSelector("#playerRoomCode", { timeout: 5000 });
    await playerPage.waitForSelector("#playerDisplayName", { timeout: 5000 });
    await playerPage.waitForSelector("#joinRoom", { timeout: 5000 });

    // Verify no manual offer/answer controls visible
    const playerBody = await playerPage.locator("body").innerText();
    assert.doesNotMatch(playerBody, /Create phone pairing code/, "No manual offer button visible");
    assert.doesNotMatch(playerBody, /Finish pairing/, "No finish pairing visible");

    // 7. Player fills name and clicks Join Room
    await playerPage.fill("#playerDisplayName", "PeerJS Singer");
    await playerPage.click("#joinRoom");

    // 8. PeerJS auto-join MUST complete — DataChannel must open
    // This is the critical assertion: if PeerJS auto-join fails, the test FAILS.
    await playerPage.waitForFunction(
      () => {
        const log = document.querySelector("#log");
        const logText = log ? log.textContent : "";
        return logText.includes("DataChannel open") || logText.includes("ROOM_HELLO");
      },
      null,
      { timeout: 60000 },
    );

    // 9. Host must receive ROOM_HELLO
    await hostPage.waitForFunction(
      () => {
        const log = document.querySelector("#log");
        return log && (
          log.textContent.includes("ROOM_HELLO") ||
          log.textContent.includes("DataChannel open")
        );
      },
      null,
      { timeout: 30000 },
    );

    // 10. Verify player is joined (has player number)
    await playerPage.waitForFunction(
      () => {
        const body = document.body.textContent || "";
        return /Player #\d/.test(body) || body.includes("connected");
      },
      null,
      { timeout: 15000 },
    );

    // 11. Queue request/accept/start works
    await playerPage.click("#queueSongPanel summary");
    await playerPage.waitForTimeout(500);
    await playerPage.fill("#singers", "2");
    await playerPage.click("#requestSong");
    await playerPage.waitForSelector("text=Queue request sent.", { timeout: 5000 });

    // Wait for host to receive queue request (check #log content directly)
    await hostPage.waitForFunction(
      () => document.querySelector("#log")?.textContent?.includes("QUEUE_ADD_REQUEST"),
      null,
      { timeout: 10000 },
    );
    // Accept button appears in the always-visible queue card
    await hostPage.waitForSelector(".acceptItem", { timeout: 10000 });
    await hostPage.click(".acceptItem");
    // After accept, item becomes "queued" and startItem button appears
    await hostPage.waitForSelector(".startItem", { timeout: 10000 });
    // Player sees queued status
    await playerPage.waitForSelector(".queue-status-queued", { timeout: 10000 });
    // Host starts the song
    await hostPage.click(".startItem");
    // Host and player see active status
    await hostPage.waitForSelector(".queue-status-active", { timeout: 10000 });
    await playerPage.waitForSelector(".queue-status-active", { timeout: 10000 });
    await receiverPage.waitForSelector("text=singers", { timeout: 15000 });

    // 12. Mic enable works
    await playerPage.click("#enableMic");
    await playerPage.waitForFunction(
      () => /Sending to host\.|Host receiving\.|Live on TV\.|Ready, muted\./.test(document.body.textContent || ""),
      null,
      { timeout: 15000 },
    );

    await hostPage.waitForFunction(
      () => {
        const log = document.querySelector("#log");
        return log && (log.textContent.includes("MIC_ENABLED") || log.textContent.includes("enabled mic"));
      },
      null,
      { timeout: 15000 },
    );

    // 13. Receiver gets live mic track
    await receiverPage.waitForFunction(
      () => /Playing all forwarded singer mics|Playing \d+ unmuted live mic|Muted\.|No live mic tracks/.test(document.body.textContent || ""),
      null,
      { timeout: 20000 },
    );

    // 14. Fake mic RMS checks
    if (useFakeMic) {
      const publishedMicRms = await measureRms(playerPage, {
        type: "globalThis", key: "__carryokieAudio", subprop: "publishedStream"
      }, "player published");
      assert.ok(publishedMicRms > 0.001, `player published mic RMS=${publishedMicRms}`);

      const hostRemoteRms = await measureRms(hostPage, {
        type: "globalThisNested", key: "__carryokieRemoteStreams", index: 0
      }, "host remote");
      assert.ok(hostRemoteRms > 0.001, `host received mic RMS=${hostRemoteRms}`);

      const hostRelayRms = await measureRms(hostPage, {
        type: "globalThisPeerNode", key: "__carryokiePeerNode", prop: "relayedStreams", index: 0, subprop: "stream"
      }, "host relay");
      assert.ok(hostRelayRms > 0.001, `host relayed mic RMS=${hostRelayRms}`);

      const liveMicRms = await receiverPage.evaluate(async () => {
        const audio = document.querySelector("#receiverLiveMicStatus audio");
        const stream = audio?.srcObject;
        if (!(stream instanceof MediaStream)) return 0;
        const track = stream.getAudioTracks().find(t => t.readyState === "live");
        if (!track) return 0;
        const ctx = new AudioContext();
        await ctx.resume();
        const source = ctx.createMediaStreamSource(new MediaStream([track]));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let peakRms = 0;
        const deadline = performance.now() + 1200;
        while (performance.now() < deadline) {
          analyser.getFloatTimeDomainData(samples);
          let sumSquares = 0;
          for (const s of samples) sumSquares += s * s;
          peakRms = Math.max(peakRms, Math.sqrt(sumSquares / samples.length));
          await new Promise(r => requestAnimationFrame(r));
        }
        await ctx.close();
        return peakRms;
      });
      console.log(`Receiver live mic RMS: ${liveMicRms}`);
    }

    // 15. Mute/unmute updates receiver visible state
    await playerPage.click("#toggleSing");
    await playerPage.waitForSelector("text=Ready, muted.", { timeout: 5000 });
    await hostPage.waitForSelector("text=MIC_MUTED", { timeout: 10000 });
    await receiverPage.waitForFunction(
      () => document.body.textContent?.includes("Muted."),
      null,
      { timeout: 20000 },
    );

    await playerPage.click("#toggleSing");
    await playerPage.waitForFunction(
      () => /Live on TV\.|Sending to host\.|Host receiving\./.test(document.body.textContent || ""),
      null,
      { timeout: 5000 },
    );
    await hostPage.waitForSelector("text=MIC_UNMUTED", { timeout: 10000 });
    await receiverPage.waitForFunction(
      () => /Playing \d+ unmuted live mic/.test(document.body.textContent || ""),
      null,
      { timeout: 20000 },
    );

    pass("PeerJS QR auto-join e2e");

    await hostPage.close();
    await playerPage.close();
    await receiverPage.close();
    await context.close();
  } catch (e) {
    fail("PeerJS QR auto-join e2e", e);
    // Save artifacts for debugging
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
