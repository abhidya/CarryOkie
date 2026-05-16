import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL || "http://localhost:4174/";
const headed = process.env.HEADLESS !== "1";

const browser = await chromium.launch({
  headless: !headed,
  slowMo: headed ? 150 : 0,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
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
  return page.locator("#log").innerText().catch(() => "");
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
    () => document.querySelector("#log")?.textContent?.includes("DataChannel open"),
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
  await player.waitForSelector("text=queued:", { timeout: 10000 });
  await host.click(".startItem");
  await host.waitForSelector("text=active:", { timeout: 10000 });
  await player.waitForSelector("text=active:", { timeout: 10000 });
  await receiver.waitForSelector("text=singers Real E2E", { timeout: 15000 });

  await player.click("#enableMic");
  await player.waitForSelector("text=Mic live.", { timeout: 15000 });
  await host.waitForFunction(
    () => document.querySelector("#log")?.textContent?.includes("enabled mic"),
    null,
    { timeout: 15000 },
  );
  await receiver.waitForFunction(
    () =>
      /Playing all forwarded singer mics|Playing \d+ live mic|Tap receiver once to start all live mic audio/.test(
        document.body.textContent || "",
      ),
    null,
    { timeout: 20000 },
  );

  const receiverText = await receiver.locator("#liveMics").innerText();
  assert.match(receiverText, /Live mics/);
  assert.doesNotMatch(receiverText, /Waiting for host tab audio/);
  await player.click("#toggleSing");
  await player.waitForSelector("text=Mic muted.", { timeout: 5000 });
  await host.waitForSelector("text=MIC_MUTED", { timeout: 10000 });
  await player.click("#toggleSing");
  await player.waitForSelector("text=Mic live.", { timeout: 5000 });
  await host.waitForSelector("text=MIC_UNMUTED", { timeout: 10000 });
  await player.locator("#remoteGain").fill("1.5");
  await player.locator("#backingGain").fill("0.5");
  await player.locator("#masterGain").fill("1.2");
  await player.click("#muteMic");
  await player.waitForSelector("text=Mic muted.", { timeout: 5000 });

  console.log(`PASS headed real-browser E2E room ${roomCode}`);
  console.log(`PASS player-host DataChannel opened`);
  console.log(`PASS queue request accepted and started`);
  console.log(`PASS autotune preset, gain controls, mute/unmute exercised`);
  console.log(`PASS mic enabled and receiver live-mic bridge reached receiver`);
} catch (error) {
  console.error("Host log:\n" + (await pageLog(host)));
  console.error("Player log:\n" + (await pageLog(player)));
  console.error("Receiver body:\n" + (await receiver.locator("body").innerText().catch(() => "")));
  console.error("Console logs:", JSON.stringify(logs, null, 2));
  throw error;
} finally {
  if (process.env.KEEP_BROWSER_OPEN === "1") {
    console.log("Browser left open. Close it manually when done.");
  } else {
    await browser.close();
  }
}
