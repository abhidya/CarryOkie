import type { Player, Room } from "../state.ts";
import { escapeHtml } from "./dom.ts";

function singerNames(room: Room, singerNumbers: number[]): string {
  const labels = singerNumbers.map(
    (singerNumber) =>
      room.players.find(
        (roomPlayer) => roomPlayer.playerNumber === singerNumber,
      )?.displayName || `#${singerNumber}`,
  );
  return labels.join(", ");
}

export function queueHtml(
  room: Room | null | undefined,
  mode: "host" | "phone" = "host",
  songTitle: (songId: string) => string,
  player?: Player | null,
): string {
  if (!room?.queue?.length) return '<p class="subtle">No songs queued yet.</p>';
  return `<ul class="queue-items">${room.queue
    .map((queueItem) => {
      const queueId = escapeHtml(queueItem.queueItemId);
      const status = escapeHtml(queueItem.status);
      const requestedBy =
        room.players.find(
          (roomPlayer) => roomPlayer.playerId === queueItem.requestedByPlayerId,
        )?.displayName || "Guest";
      const hostControls = `${queueItem.status === "queued" ? `<button class="startItem" data-queue-id="${queueId}" title="Start on TV">Start now</button>` : ""} <button class="moveUpItem" data-queue-id="${queueId}" title="Move earlier">↑</button> <button class="moveDownItem" data-queue-id="${queueId}" title="Move later">↓</button> <button class="removeItem" data-queue-id="${queueId}" title="Remove">Remove</button>`;
      const phoneControls = !["active", "ended"].includes(queueItem.status)
        ? `<button class="queueSelf" data-action="join" data-queue-id="${queueId}">Add me</button> <button class="queueSelf" data-action="leave" data-queue-id="${queueId}">Leave</button> ${queueItem.requestedByPlayerId === player?.playerId ? `<button class="startSelf" data-queue-id="${queueId}">Start on TV</button> <button class="queueSelf" data-action="remove" data-queue-id="${queueId}">Cancel request</button>` : ""}`
        : "";
      return `<li class="queue-item"><div class="queue-top"><strong>${escapeHtml(songTitle(queueItem.songId))}</strong><span class="queue-status queue-status-${status}">${status}</span></div><p class="subtle">Singers: ${escapeHtml(singerNames(room, queueItem.singerNumbers))} · requested by ${escapeHtml(requestedBy)}</p><div class="button-row queue-actions">${mode === "host" ? hostControls : phoneControls}</div></li>`;
    })
    .join("")}</ul>`;
}
