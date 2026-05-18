import { spawn } from "node:child_process";

const port = process.env.E2E_PORT || "4180";
const baseUrl = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}/`;
const server = spawn("npx", ["vite", "preview", "--port", port, "--host", "127.0.0.1"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
});

let ready = false;
const deadline = Date.now() + 30_000;

server.stdout.on("data", (chunk) => {
  if (!ready) process.stdout.write(chunk);
});
server.stderr.on("data", (chunk) => process.stderr.write(chunk));

function stopServer() {
  if (!server.killed) server.kill("SIGTERM");
}

async function waitForServer() {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        ready = true;
        return;
      }
    } catch {
      // Vite preview not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`E2E server did not become ready at ${baseUrl}`);
}

try {
  await waitForServer();
  const test = spawn("npx", ["tsx", "scripts/e2e_real_browser.test.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      E2E_BASE_URL: baseUrl,
      HEADLESS: process.env.HEADLESS || "1",
      KEEP_BROWSER_OPEN: process.env.KEEP_BROWSER_OPEN || "0",
    },
  });
  const code = await new Promise((resolve) => test.on("exit", resolve));
  if (code !== 0) process.exitCode = code ?? 1;
} finally {
  stopServer();
}
