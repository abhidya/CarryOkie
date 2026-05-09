import type { Player, Room } from "../state.ts";
import { escapeHtml } from "./dom.ts";

function singerNames(room: Room, singerNumbers: number[]): string {
  const labels = singerNumbers.map(
    (singerNumber) =>
      room.players.find((roomPlayer) => roomPlayer.playerNumber === singerNumber)
        ?.displayName || `#${singerNumber}`,
  );
  return labels.length ? labels.join(", ") : "Unassigned";
}

export function queueHtml(
  room: Room | null | undefined,
  mode: "host" | "phone" = "host",
  songTitle: (songId: string) => string,
  player?: Player | null,
): string {
  if (!room?.queue?.length) return "<p>Queue is empty.</p>";
  return `<ul>${room.queue
    .map((queueItem) => {
      const queueId = escapeHtml(queueItem.queueItemId);
      const requestedBy =
        room.players.find(
          (roomPlayer) => roomPlayer.playerId === queueItem.requestedByPlayerId,
        )?.displayName || "Guest";
      const hostControls = `${["requested", "rejected"].includes(queueItem.status) ? `<button class="acceptItem" data-queue-id="${queueId}" title="Accept/requeue">Accept</button>` : ""} ${queueItem.status === "queued" ? `<button class="startItem" data-queue-id="${queueId}" title="Start on TV">Start</button>` : ""} ${queueItem.status === "requested" ? `<button class="rejectItem" data-queue-id="${queueId}" title="Reject">Reject</button>` : ""} <button class="removeItem" data-queue-id="${queueId}" title="Remove">Remove</button>`;
      const phoneControls = !["active", "ended"].includes(queueItem.status)
        ? `<button class="queueSelf" data-action="join" data-queue-id="${queueId}">Add me as singer</button> <button class="queueSelf" data-action="leave" data-queue-id="${queueId}">Remove me</button> ${queueItem.requestedByPlayerId === player?.playerId ? `<button class="queueSelf" data-action="remove" data-queue-id="${queueId}">Remove request</button>` : ""}`
        : "";
      return `<li>${escapeHtml(queueItem.status)}: ${escapeHtml(songTitle(queueItem.songId))} singers ${escapeHtml(singerNames(room, queueItem.singerNumbers))} · requested by ${escapeHtml(requestedBy)} ${mode === "host" ? hostControls : phoneControls}</li>`;
    })
    .join("")}</ul>`;
}
