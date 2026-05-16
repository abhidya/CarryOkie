import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";
import {
  decodeSignalPayload,
  encodeSignalPayload,
  stripSdpForManual,
} from "../src/signaling.ts";

const browserTypes = { chromium, firefox, webkit };

async function assertBrowserParses(page, description, label) {
  const error = await page.evaluate(async (desc) => {
    const pc = new RTCPeerConnection();
    try {
      await pc.setRemoteDescription(desc);
      return null;
    } catch (error) {
      return error.message;
    } finally {
      pc.close();
    }
  }, description);
  assert.equal(error, null, `${label}: ${error}`);
}

async function makeBrowserOffer(page) {
  return page.evaluate(async () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pc.createDataChannel("room-rpc", { ordered: true });
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    await new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      let idleTimer;
      const done = () => {
        pc.removeEventListener("icegatheringstatechange", onState);
        pc.removeEventListener("icecandidate", onCandidate);
        clearTimeout(timer);
        clearTimeout(idleTimer);
        resolve();
      };
      const onState = () => {
        if (pc.iceGatheringState === "complete") done();
      };
      const onCandidate = (event) => {
        if (!event.candidate) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(done, 1000);
      };
      const timer = setTimeout(done, 4000);
      pc.addEventListener("icegatheringstatechange", onState);
      pc.addEventListener("icecandidate", onCandidate);
    });
    const description = {
      type: pc.localDescription.type,
      sdp: pc.localDescription.sdp,
    };
    pc.close();
    return description;
  });
}

const safariLikeSdp = [
  "v=0",
  "o=- 5978264318933655984 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=msid-semantic: WMS",
  "m=application 57887 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 69.14.212.122",
  "a=candidate:349684117 1 udp 2113937151 3caaae27-0354-403d-85f5-05dddf7cee8a.local 57887 typ host generation 0 network-id 1 network-cost 999",
  "a=candidate:2574640704 1 udp 1677729535 69.14.212.122 57887 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999",
  "a=ice-ufrag:vprj",
  "a=ice-pwd:cvm1zbggLQoUUFHNH/RjNHpt",
  "a=fingerprint:sha-256 24:74:42:E9:D4:B8:4A:FE:91:28:F0:0B:BF:F8:6E:80:09:8E:C5:15:4C:84:0F:CD:BE:52:7C:CE:8F:69:B2:4B",
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "a=max-message-size:262144",
].join("\r\n");

const stripped = stripSdpForManual(safariLikeSdp);
assert.match(stripped, /typ srflx raddr 0\.0\.0\.0 rport 0/);

for (const [browserName, browserType] of Object.entries(browserTypes)) {
  const browser = await browserType.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await assertBrowserParses(
      page,
      { type: "offer", sdp: stripped },
      `${browserName} parses stripped Safari-like SDP`,
    );
    const generatedOffer = await makeBrowserOffer(page);
    const encoded = await encodeSignalPayload({
      kind: "offer",
      fromPeerId: `${browserName}-player`,
      toPeerId: "host",
      description: generatedOffer,
    });
    const decoded = await decodeSignalPayload(encoded.url);
    await assertBrowserParses(
      page,
      decoded.description,
      `${browserName} parses browser-generated stripped offer`,
    );
  } finally {
    await browser.close();
  }
}

console.log("PASS browsers parse stripped manual SDP");
