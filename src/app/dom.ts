export function $(selector: string, root: ParentNode = document): Element | null {
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
  root.innerHTML = `<main class="shell"><header><h1>${title}</h1>${localHttpWarning()}</header><section id="main"></section><section><h2>Log</h2><div id="log" class="log"></div></section></main>`;
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
