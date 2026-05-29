import qrcode from "qrcode-generator";

// Standards-valid, no-service QR generation for CarryOkie join/manual payloads.
// Version 10-L preserves the previous 57x57 matrix and keeps enough capacity for
// local signaling chunks while producing QR codes camera apps can actually decode.
const VERSION = 10;
const ECC_LEVEL = "L";
export const QR_MAX_TEXT_BYTES = 260;

function assertCapacity(text: string): void {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > QR_MAX_TEXT_BYTES)
    throw new Error(
      `QR chunk too large (${bytes} bytes). Use smaller chunks.`,
    );
}

function makeQr(text: string): ReturnType<typeof qrcode> {
  assertCapacity(text);
  const qr = qrcode(VERSION, ECC_LEVEL);
  qr.addData(text, "Byte");
  qr.make();
  return qr;
}

function escapeAttr(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      })[character]!,
  );
}

export function qrMatrix(text: string): boolean[][] {
  const qr = makeQr(text);
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, row) =>
    Array.from({ length: n }, (_, col) => qr.isDark(row, col)),
  );
}

export function qrSvg(
  text: string,
  {
    scale = 4,
    quiet = 4,
    title = "CarryOkie QR",
  }: { scale?: number; quiet?: number; title?: string } = {},
): string {
  const qr = makeQr(text);
  const moduleCount = qr.getModuleCount();
  const size = moduleCount + quiet * 2;
  const rects: string[] = [];
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col))
        rects.push(
          `<rect x="${col + quiet}" y="${row + quiet}" width="1" height="1"/>`,
        );
    }
  }
  const pixelSize = size * scale;
  return `<svg class="qr" data-qr="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${pixelSize}" height="${pixelSize}" role="img" aria-label="${escapeAttr(title)}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects.join("")}</g></svg>`;
}
