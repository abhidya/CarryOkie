export function $(
  selector: string,
  root: ParentNode = document,
): Element | null {
  return root.querySelector(selector);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

export function localHttpWarning(locationLike: Location = location): string {
  const hostname = locationLike.hostname;
  return locationLike.protocol === "http:" &&
    hostname !== "localhost" &&
    hostname !== "127.0.0.1"
    ? '<p class="warn">Phone browser is on local HTTP. If offer creation, camera QR, or protected video fails, use the GitHub Pages HTTPS URL for the full flow.</p>'
    : "";
}

export function commonChrome(root: Element, title: string): void {
  root.innerHTML = `<main class="shell"><header class="page-hero"><div><p class="eyebrow">CarryOkie</p><h1>${title}</h1>${localHttpWarning()}</div><div class="mini-stage" aria-hidden="true"><span></span><span></span><span></span></div></header><section id="main"></section><section class="activity-card"><h2>Log</h2><div id="log" class="log"></div></section></main>`;
}

export function hostShell(root: Element): void {
  root.innerHTML = `<main id="appShell" class="shell host-shell"><header class="page-hero"><div><p class="eyebrow">CarryOkie</p><h1>Host Control Room</h1><p class="hint">Open the TV Stage first, cast that tab, then run the queue.</p></div><div class="mini-stage" aria-hidden="true"><span></span><span></span><span></span></div></header><div id="hostShowControl"><div id="hostTopStatus" class="card"></div><div id="hostActions" class="button-row host-actions"></div><div id="hostPanels"></div><details id="manualPairingToggle" class="card"><summary>Manual Pairing Fallback</summary><div id="manualPairingPanel"></div></details><details id="diagnosticsToggle" class="card"><summary>Diagnostics</summary><div id="diagnosticsPanel"><pre id="audioPipelineStatus"></pre><div id="log" class="log"></div></div></details></div></main>`;
}

export function playerShell(root: Element): void {
  root.innerHTML = `<div id="playerSingerRemote"><header class="page-hero"><div><p class="eyebrow">CarryOkie</p><h1>CarryOkie Singer Remote</h1></div><div class="mini-stage" aria-hidden="true"><span></span><span></span><span></span></div></header><section id="main"></section><details id="playerManualFallbackToggle" class="card"><summary>Manual Pairing Fallback</summary><div id="playerManualFallbackPanel"></div></details><details id="diagnosticsToggle" class="card"><summary>Diagnostics</summary><div id="diagnosticsPanel"><pre id="audioPipelineStatus"></pre><div id="log" class="log"></div></div></details></div>`;
}

export function receiverShell(root: Element): void {
  root.innerHTML = `<div id="receiverTvStage"><header class="page-hero"><div><p class="eyebrow">CarryOkie</p><h1>CarryOkie TV Stage</h1></div></header><section id="main"></section><details id="receiverDiagnosticsToggle" class="card"><summary>Diagnostics</summary><div id="receiverDiagnosticsPanel"><pre id="audioPipelineStatus"></pre><div id="log" class="log"></div></div></details></div>`;
}

export function logToPage(message: unknown): void {
  const logContainer = $("#log");
  if (!logContainer) return;
  logContainer.prepend(
    Object.assign(document.createElement("div"), {
      textContent: `${new Date().toLocaleTimeString()} ${String(message)}`,
    }),
  );
}
