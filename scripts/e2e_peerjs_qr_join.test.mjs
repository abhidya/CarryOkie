import { chromium } from "playwright";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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


function makeFakeMicWav(path) {
  const sampleRate = 48000;
  const seconds = 4;
  const samples = sampleRate * seconds;
  const bytesPerSample = 2;
  const dataSize = samples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i++) {
    const tone = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    buffer.writeInt16LE(Math.round(tone * 12000), 44 + i * bytesPerSample);
  }
  writeFileSync(path, buffer);
}

// Artifact helpers
const ARTIFACTS_DIR = "artifacts";
try { mkdirSync(ARTIFACTS_DIR, { recursive: true }); } catch {}
const fakeMicWavPath = resolve(ARTIFACTS_DIR, "fake-mic.wav");
if (useFakeMic) makeFakeMicWav(fakeMicWavPath);

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
      if (accessor.type === "globalThis") stream = accessor.subprop ? globalThis[accessor.key]?.[accessor.subprop] : globalThis[accessor.key];
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


const FORBIDDEN_MANUAL_SELECTORS = [
  "#playerManualFallbackToggle",
  "#manualPairingToggle",
  "#makeOffer",
  "#answerOffer",
  "#importAnswer",
];

async function installManualFallbackClickGuard(context) {
  await context.addInitScript((selectors) => {
    globalThis.__carryokieManualFallbackClicks = [];
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        for (const selector of selectors) {
          if (target.closest(selector)) {
            globalThis.__carryokieManualFallbackClicks.push(selector);
          }
        }
      },
      true,
    );
  }, FORBIDDEN_MANUAL_SELECTORS);
}

async function assertNoManualFallbackClicks(pages) {
  for (const page of pages) {
    const clicked = await page.evaluate(
      () => globalThis.__carryokieManualFallbackClicks || [],
    );
    assert.deepStrictEqual(clicked, [], `Manual fallback controls clicked: ${clicked.join(", ")}`);
  }
}

async function assertManualFallbackClosedAndHidden(page, role) {
  for (const selector of ["#playerManualFallbackToggle", "#manualPairingToggle"]) {
    if (await page.locator(selector).count()) {
      assert.strictEqual(
        await page.locator(selector).getAttribute("open"),
        null,
        `${role} manual fallback panel is closed: ${selector}`,
      );
    }
  }

  for (const selector of ["#makeOffer", "#answerOffer", "#importAnswer"]) {
    if (await page.locator(selector).count()) {
      assert.strictEqual(
        await page.locator(selector).first().isVisible(),
        false,
        `${role} manual fallback control hidden: ${selector}`,
      );
    }
  }

  const visibleText = await page.locator("body").innerText();
  assert.doesNotMatch(
    visibleText,
    /Create phone pairing code|Finish pairing|Paste host answer|Import answer|Create host answer|Player creates a join code/i,
    `${role} does not expose manual fallback copy in happy path`,
  );
}

async function waitForPeerJsReady(page) {
  await page.waitForFunction(() => {
    const text = document.querySelector("#hostQrJoinStatus")?.textContent || "";
    if (/manual fallback|unavailable|failed/i.test(text)) {
      throw new Error(`PeerJS QR join is not ready: ${text}`);
    }
    return /QR Join Ready|Automatic join ready|ready/i.test(text);
  }, null, { timeout: 30000 });
}

async function waitForReceiverUnmutedLiveMic(page) {
  try {
    await page.waitForFunction(
      () => {
        const text = document.querySelector("#receiverLiveMicStatus")?.textContent || "";
        return /Playing \d+ unmuted live mic/i.test(text);
      },
      null,
      { timeout: 20000 },
    );
  } catch (error) {
    const text = await page.locator("#receiverLiveMicStatus").innerText().catch(() => "");
    assert.doesNotMatch(text, /No live mic tracks|Waiting for singer mic|Muted\./i, `Receiver live mic rejected state: ${text}`);
    throw error;
  }
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
      ...(useFakeMic
        ? [
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-audio-capture=${fakeMicWavPath}`,
          ]
        : []),
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
    await installManualFallbackClickGuard(context);
    await context.grantPermissions(["microphone"], { origin: baseUrl });

    // 1. Host opens /host/
    const hostPage = await context.newPage();
    await hostPage.goto(`${baseUrl}/host/`, { waitUntil: "networkidle" });
    await hostPage.waitForSelector("#hostRoomCode", { timeout: 10000 });
    const roomCode = await hostPage.locator("#hostRoomCode").innerText();
    assert.match(roomCode.trim(), /^[A-Z]+$/, "Room code generated");

    // 2. Host starts PeerJsRoomTransport (verified by strict ready status)
    await waitForPeerJsReady(hostPage);
    await assertManualFallbackClosedAndHidden(hostPage, "host");

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
    assert.ok(joinLinkHref.endsWith(`?room=${roomCode.trim()}`), `Join link matches receiver room: ${joinLinkHref}`);
    await receiverPage.click("#startReceiverAudio");

    // 5. Player opens #receiverJoinLink (simulates QR scan)
    const playerPage = await context.newPage();
    await playerPage.goto(joinLinkHref, { waitUntil: "networkidle" });

    // 6. Player sees clean Join Room screen
    await playerPage.waitForSelector("text=CarryOkie Singer Remote", { timeout: 10000 });
    await playerPage.waitForSelector("#playerRoomCode", { timeout: 5000 });
    await playerPage.waitForSelector("#playerDisplayName", { timeout: 5000 });
    await playerPage.waitForSelector("#joinRoom", { timeout: 5000 });

    // Verify no manual offer/answer controls visible or used before join.
    await assertManualFallbackClosedAndHidden(playerPage, "player");
    await assertNoManualFallbackClicks([hostPage, receiverPage, playerPage]);

    // 7. Player fills name and clicks Join Room
    await playerPage.fill("#playerDisplayName", "PeerJS Singer");
    await playerPage.click("#joinRoom");

    await assertManualFallbackClosedAndHidden(playerPage, "player");

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

    await assertNoManualFallbackClicks([hostPage, receiverPage, playerPage]);

    // 10. Verify player is joined (has player number)
    await playerPage.waitForFunction(
      () => {
        const body = document.body.textContent || "";
        return /Player #\d/.test(body) || body.includes("connected");
      },
      null,
      { timeout: 15000 },
    );

    // 11. Queue request/start works without host approval
    await playerPage.waitForSelector("#singers", { state: "visible", timeout: 5000 });
    await playerPage.fill("#singers", "2");
    await playerPage.click("#requestSong");
    await playerPage.waitForFunction(
      () => /starts without host approval|Host approval not required/i.test(document.querySelector("#log")?.textContent || ""),
      null,
      { timeout: 5000 },
    );

    // Wait for host to receive queue request (check #log content directly)
    await hostPage.waitForFunction(
      () => document.querySelector("#log")?.textContent?.includes("QUEUE_ADD_REQUEST"),
      null,
      { timeout: 10000 },
    );
    assert.equal(await hostPage.locator(".acceptItem").count(), 0, "host approval button must not block song queue");
    // First queued song starts automatically on an idle TV; no host click.
    await hostPage.waitForFunction(
      () => document.querySelector(".queue-status-active"),
      null,
      { timeout: 10000 },
    );
    // Host and player see active status
    await hostPage.waitForSelector(".queue-status-active", { timeout: 10000 });
    await playerPage.waitForFunction(
      () => document.querySelector(".queue-status-active"),
      null,
      { timeout: 10000 },
    );
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

    // 13. Direct receiver route is established; host relay may still exist as fallback.
    await hostPage.waitForFunction(
      () => /Direct receiver peer ready/.test(document.querySelector("#log")?.textContent || ""),
      null,
      { timeout: 30000 },
    );
    await playerPage.waitForFunction(
      () => /Direct receiver audio offer sent/.test(document.querySelector("#log")?.textContent || ""),
      null,
      { timeout: 30000 },
    );
    const playerLogAfterDirectOffer = await playerPage.locator("#log").innerText();
    assert.doesNotMatch(
      playerLogAfterDirectOffer,
      /Direct receiver audio route failed/i,
      "direct singer-to-receiver route must not fail before falling back",
    );

    // 14. Receiver gets an active, unmuted live mic track.
    await waitForReceiverUnmutedLiveMic(receiverPage);

    // 15. Fake mic RMS checks
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
        async function sampleReceiverLiveMicRms() {
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
        }
        let peak = 0;
        const deadline = performance.now() + 10000;
        while (performance.now() < deadline && peak <= 0.001) {
          peak = Math.max(peak, await sampleReceiverLiveMicRms());
          if (peak <= 0.001) await new Promise(r => setTimeout(r, 250));
        }
        return peak;
      });
      console.log(`Receiver live mic RMS: ${liveMicRms}`);
      assert.ok(
        liveMicRms > 0.001,
        `receiver live mic RMS=${liveMicRms}`,
      );
    }

    // 16. Mute/unmute updates receiver visible state
    await playerPage.click("#toggleSing");
    await playerPage.waitForSelector("text=Ready, muted.", { timeout: 5000 });
    await hostPage.waitForFunction(
      () => document.querySelector("#log")?.textContent?.includes("MIC_MUTED"),
      null,
      { timeout: 10000 },
    );
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
    await hostPage.waitForFunction(
      () => document.querySelector("#log")?.textContent?.includes("MIC_UNMUTED"),
      null,
      { timeout: 10000 },
    );
    await receiverPage.waitForFunction(
      () => /Playing \d+ unmuted live mic/.test(document.body.textContent || ""),
      null,
      { timeout: 20000 },
    );

    await assertNoManualFallbackClicks([hostPage, receiverPage, playerPage]);

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
  fail("PeerJS QR setup", e);
} finally {
  if (browser) await browser.close();
  stopServer();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
