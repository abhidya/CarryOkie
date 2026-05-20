import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:4180/";
const headed = process.env.HEADLESS !== "1";
const keepBrowserOpen = process.env.KEEP_BROWSER_OPEN === "1";
const useDeterministicFakeMic =
  process.env.E2E_FAKE_MIC === "1" ||
  (!headed && process.env.E2E_REAL_MIC !== "1");
function makeSineWaveWav({
  seconds = 60,
  sampleRate = 48000,
  frequency = 440,
} = {}) {
  const sampleCount = seconds * sampleRate;
  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < sampleCount; i++) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0x3fff,
    );
    buffer.writeInt16LE(sample, 44 + i * 2);
  }
  const dir = mkdtempSync(join(tmpdir(), "carryokie-e2e-audio-"));
  const wavPath = join(dir, "mic-tone.wav");
  writeFileSync(wavPath, buffer);
  return wavPath;
}
const fakeMicAudioPath = useDeterministicFakeMic ? makeSineWaveWav() : null;
const browser = await chromium.launch({
  headless: !headed,
  slowMo: headed ? 150 : 0,
  args: [
    "--use-fake-ui-for-media-stream",
    ...(useDeterministicFakeMic
      ? [
          "--use-fake-device-for-media-stream",
          `--use-file-for-fake-audio-capture=${fakeMicAudioPath}`,
        ]
      : []),
  ],
});
const context = await browser.newContext();
await context.grantPermissions(["microphone"], { origin: baseUrl });

const host = await context.newPage();
const player = await context.newPage();
const receiver = await context.newPage();
const logs = { host: [], player: [], receiver: [] };
host.on("console", (msg) => logs.host.push(`${msg.type()}: ${msg.text()}`));
player.on("console", (msg) => logs.player.push(`${msg.type()}: ${msg.text()}`));
receiver.on("console", (msg) =>
  logs.receiver.push(`${msg.type()}: ${msg.text()}`),
);

async function pageLog(page) {
  return page
    .locator("#log")
    .innerText()
    .catch(() => "");
}

try {
  await host.goto(`${baseUrl}/host/`, { waitUntil: "networkidle" });
  await host.waitForSelector("text=Host room");
  const roomText = await host.locator(".room-spotlight h2").innerText();
  const roomCode = roomText.replace(/^Room\s+/, "").trim();
  assert.match(roomCode, /^[A-Z]+$/);

  await receiver.goto(`${baseUrl}/receiver/?room=${roomCode}`, {
    waitUntil: "networkidle",
  });
  await receiver.locator("body").click();
  await receiver.click("#startReceiverAudio");
  await receiver.waitForSelector(`text=${roomCode}`);

  await player.goto(`${baseUrl}/player/?room=${roomCode}`, {
    waitUntil: "networkidle",
  });
  await player.fill("#displayName", "Real E2E");
  await player.click("#makeOffer");
  await player.waitForSelector("#offerOut [data-single-qr] svg", {
    timeout: 10000,
  });
  const offer = await player.locator("#offerOut textarea").first().inputValue();
  assert.match(offer, /#signal=ck1\./);

  await host.fill("#offer", offer);
  await host.click("#answerOffer");
  await host.waitForSelector("#answerOut [data-single-qr] svg", {
    timeout: 10000,
  });
  const answer = await host.locator("#answerOut textarea").first().inputValue();
  assert.match(answer, /#signal=ck1\./);

  await player.fill("#answer", answer);
  await player.click("#importAnswer");
  await player.waitForSelector("text=CarryOkie phone", { timeout: 15000 });
  await player.waitForFunction(
    () =>
      document.querySelector("#log")?.textContent?.includes("DataChannel open"),
    null,
    { timeout: 15000 },
  );
  await host.waitForFunction(
    () => document.querySelector("#log")?.textContent?.includes("ROOM_HELLO"),
    null,
    { timeout: 15000 },
  );

  await player.selectOption("#voicePreset", "autotune");
  await player.waitForSelector("text=Mic filter: Autotune-style polish", {
    timeout: 5000,
  });
  await player.fill("#singers", "2");
  await player.click("#requestSong");
  await player.waitForSelector("text=Queue request sent.", { timeout: 5000 });
  await host.waitForSelector("text=QUEUE_ADD_REQUEST", { timeout: 10000 });
  await host.waitForSelector(".acceptItem", { timeout: 10000 });
  await host.click(".acceptItem");
  await host.waitForSelector(".startItem", { timeout: 10000 });
  await player.waitForSelector(".queue-status-queued", { timeout: 10000 });
  await host.click(".startItem");
  await host.waitForSelector(".queue-status-active", { timeout: 10000 });
  await player.waitForSelector(".queue-status-active", { timeout: 10000 });
  await receiver.waitForSelector("text=singers Real E2E", { timeout: 15000 });

  await player.click("#enableMic");
  await player.waitForFunction(
    () =>
      /Mic live\.|Mic ready\. Hold to sing\.|Mic publishing\./.test(
        document.body.textContent || "",
      ),
    null,
    { timeout: 15000 },
  );
  await host.waitForFunction(
    () => document.querySelector("#log")?.textContent?.includes("enabled mic"),
    null,
    { timeout: 15000 },
  );
  await receiver.waitForFunction(
    () =>
      /Playing all forwarded singer mics|Playing \d+ unmuted live mic|Mic track connected, but singer is muted\.|Tap receiver once to start|Press 'Start receiver audio'/.test(
        document.body.textContent || "",
      ),
    null,
    { timeout: 20000 },
  );
  await receiver.waitForFunction(
    () =>
      /Playing \d+ unmuted live mic|Playing all forwarded singer mics|Mic track connected, but singer is muted\.|No live mic tracks connected\./.test(
        document.body.textContent || "",
      ),
    null,
    { timeout: 20000 },
  );

  const receiverText = await receiver.locator("#liveMics").innerText();
  assert.match(receiverText, /Live mics/);
  assert.doesNotMatch(receiverText, /Waiting for host tab audio/);
  if (useDeterministicFakeMic) {
    const publishedMicRms = await player.evaluate(async () => {
      const stream = globalThis.__carryokieAudio?.publishedStream;
      if (!(stream instanceof MediaStream)) return 0;
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let peakRms = 0;
      const deadline = performance.now() + 800;
      while (performance.now() < deadline) {
        analyser.getFloatTimeDomainData(samples);
        let sumSquares = 0;
        for (const sample of samples) sumSquares += sample * sample;
        peakRms = Math.max(peakRms, Math.sqrt(sumSquares / samples.length));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      await context.close();
      return peakRms;
    });
    assert.ok(
      publishedMicRms > 0.001,
      `player published mic should contain non-silent samples; rms=${publishedMicRms}`,
    );
    const hostRemoteRms = await host.evaluate(async () => {
      const stream = globalThis.__carryokieRemoteStreams?.[0];
      if (!(stream instanceof MediaStream)) return 0;
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let peakRms = 0;
      const deadline = performance.now() + 800;
      while (performance.now() < deadline) {
        analyser.getFloatTimeDomainData(samples);
        let sumSquares = 0;
        for (const sample of samples) sumSquares += sample * sample;
        peakRms = Math.max(peakRms, Math.sqrt(sumSquares / samples.length));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      await context.close();
      return peakRms;
    });
    assert.ok(
      hostRemoteRms > 0.001,
      `host received mic should contain non-silent samples; rms=${hostRemoteRms}`,
    );
    const hostRelayRms = await host.evaluate(async () => {
      const stream =
        globalThis.__carryokiePeerNode?.relayedStreams?.[0]?.stream;
      if (!(stream instanceof MediaStream)) return 0;
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let peakRms = 0;
      const deadline = performance.now() + 800;
      while (performance.now() < deadline) {
        analyser.getFloatTimeDomainData(samples);
        let sumSquares = 0;
        for (const sample of samples) sumSquares += sample * sample;
        peakRms = Math.max(peakRms, Math.sqrt(sumSquares / samples.length));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      await context.close();
      return peakRms;
    });
    assert.ok(
      hostRelayRms > 0.001,
      `host relayed mic should contain non-silent samples; rms=${hostRelayRms}`,
    );
  }
  await player.click("#toggleSing");
  await player.waitForSelector("text=Mic muted.", { timeout: 5000 });
  await host.waitForSelector("text=MIC_MUTED", { timeout: 10000 });
  await receiver.waitForFunction(
    () =>
      document.body.textContent?.includes(
        "Mic track connected, but singer is muted.",
      ),
    null,
    { timeout: 20000 },
  );
  await player.click("#toggleSing");
  await player.waitForSelector("text=Mic live.", { timeout: 5000 });
  await host.waitForSelector("text=MIC_UNMUTED", { timeout: 10000 });
  await receiver.waitForFunction(
    () => /Playing \d+ unmuted live mic/.test(document.body.textContent || ""),
    null,
    { timeout: 20000 },
  );
  await receiver.waitForFunction(
    () => {
      const audio = document.querySelector("#liveMics audio");
      const stream = audio?.srcObject;
      return (
        audio &&
        audio.muted === false &&
        audio.volume > 0 &&
        stream instanceof MediaStream &&
        stream.getAudioTracks().some((track) => track.readyState === "live") &&
        /Unmuted: 1 · Muted: 0/.test(document.body.textContent || "")
      );
    },
    null,
    { timeout: 10000 },
  );
  if (useDeterministicFakeMic) {
    const liveMicRms = await receiver.evaluate(async () => {
      const audio = document.querySelector("#liveMics audio");
      const stream = audio?.srcObject;
      if (!(stream instanceof MediaStream)) return 0;
      const track = stream
        .getAudioTracks()
        .find((candidate) => candidate.readyState === "live");
      if (!track) return 0;
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let peakRms = 0;
      const deadline = performance.now() + 1200;
      while (performance.now() < deadline) {
        analyser.getFloatTimeDomainData(samples);
        let sumSquares = 0;
        for (const sample of samples) sumSquares += sample * sample;
        peakRms = Math.max(peakRms, Math.sqrt(sumSquares / samples.length));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      await context.close();
      return peakRms;
    });
    assert.ok(
      liveMicRms > 0.001,
      `receiver live mic audio should contain non-silent samples; rms=${liveMicRms}`,
    );
  }
  await player.click("text=Advanced audio");
  await player.locator("#remoteGain").fill("1.5");
  await player.locator("#backingGain").fill("0.5");
  await player.locator("#masterGain").fill("1.2");
  await player.click("#muteMic");
  await player.waitForSelector("text=Mic muted.", { timeout: 5000 });
  await receiver.waitForFunction(
    () =>
      /Mic track connected, but singer is muted\./.test(
        document.body.textContent || "",
      ) && /Unmuted: 0 · Muted: 1/.test(document.body.textContent || ""),
    null,
    { timeout: 20000 },
  );
  await player.click("#enableMic");
  await player.waitForSelector("text=Mic live.", { timeout: 5000 });
  await receiver.waitForFunction(
    () =>
      /Playing \d+ unmuted live mic/.test(document.body.textContent || "") &&
      /Unmuted: 1 · Muted: 0/.test(document.body.textContent || ""),
    null,
    { timeout: 20000 },
  );

  console.log(`PASS real-browser E2E room ${roomCode}`);
  console.log(`PASS player-host DataChannel opened`);
  console.log(`PASS queue request accepted and started`);
  console.log(`PASS autotune preset, gain controls, mute/unmute exercised`);
  console.log(
    `PASS mic enabled and receiver live-mic bridge routed audio track`,
  );
} catch (error) {
  console.error("Host log:\n" + (await pageLog(host)));
  console.error("Player log:\n" + (await pageLog(player)));
  console.error(
    "Receiver body:\n" +
      (await receiver
        .locator("body")
        .innerText()
        .catch(() => "")),
  );
  console.error("Console logs:", JSON.stringify(logs, null, 2));
  throw error;
} finally {
  if (keepBrowserOpen) {
    console.log("Browser left open. Close it manually when done.");
  } else {
    await browser.close();
  }
}
