import { escapeHtml } from "./dom.ts";

export interface LyricLine {
  startMs: number;
  text: string;
}

export function lyricView(lines: LyricLine[] = [], positionMs: number): string {
  const activeLine =
    lines.findLast?.((line) => positionMs >= line.startMs) ||
    lines.filter((line) => positionMs >= line.startMs).pop() ||
    lines[0];
  return `<div>${lines
    .map(
      (line) =>
        `<p class="${line === activeLine ? "active" : ""}">${escapeHtml(line.text)}</p>`,
    )
    .join("")}</div>`;
}
