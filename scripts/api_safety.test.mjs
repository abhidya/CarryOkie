import assert from "node:assert/strict";
import fs from "node:fs";

// Test 1: navigator.mediaDevices null check
const signalingCode = fs.readFileSync("src/signaling.ts", "utf8");
assert.match(
  signalingCode,
  /if \(!navigator\.mediaDevices\)[\s\S]*?throw/,
  "Must check navigator.mediaDevices exists before getUserMedia",
);

// Test 2: clipboard API has error handling
assert.match(
  signalingCode,
  /navigator\.clipboard\.writeText[\s\S]*?catch[\s\S]*?{[\s\S]*?}/,
  "Clipboard writeText must have try/catch",
);

// Test 3: audio.ts has mediaDevices check
const audioCode = fs.readFileSync("src/audio.ts", "utf8");
assert.match(
  audioCode,
  /if \(!navigator\.mediaDevices\)[\s\S]*?throw/,
  "Audio requestMic must check navigator.mediaDevices exists",
);

assert.match(
  audioCode,
  /if \(!navigator\.mediaDevices\.getUserMedia\)[\s\S]*?throw/,
  "Audio requestMic must check getUserMedia method exists",
);

console.log("PASS All media/clipboard safety checks verified");