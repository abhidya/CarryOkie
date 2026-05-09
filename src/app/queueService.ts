import {
  addSingerToQueueItem,
  enqueueRequest,
  removeQueueItem,
  removeSingerFromQueueItem,
  type Player,
  type QueueItem,
  type Room,
} from "../state.ts";
import type { SongCatalogItem } from "./catalog.ts";

export interface QueueAddRequestMessage {
  item?: Partial<QueueItem>;
}

export interface QueueUpdateRequestMessage {
  playerId?: string;
  queueItemId?: string;
  action?: "join" | "leave" | "remove" | string;
}

export function pairedActor(
  room: Room | null | undefined,
  remotePeerId: string,
  messagePlayerId: string | undefined,
): Player | undefined {
  return room?.players?.find(
    (roomPlayer) =>
      roomPlayer.playerId === messagePlayerId &&
      roomPlayer.peerId === remotePeerId,
  );
}

export function validSingerNumbers(
  room: Room | null | undefined,
  singerNumbers: unknown,
): number[] {
  const playerNumbersInRoom = new Set(
    room?.players?.map((roomPlayer) => roomPlayer.playerNumber).filter(Boolean) || [],
  );
  return [
    ...new Set(
      (Array.isArray(singerNumbers) ? singerNumbers : []).filter(
        (singerNumber): singerNumber is number =>
          Number.isInteger(singerNumber) && playerNumbersInRoom.has(singerNumber),
      ),
    ),
  ];
}

export function handleQueueAddRequest(
  room: Room,
  catalog: SongCatalogItem[],
  remotePeerId: string,
  message: QueueAddRequestMessage,
): void {
  const queueItem = message.item || {};
  const actor = pairedActor(room, remotePeerId, queueItem.requestedByPlayerId);
  if (!actor?.playerNumber)
    throw new Error("Queue request needs a paired requester.");
  if (!catalog.some((song) => song.songId === queueItem.songId))
    throw new Error("Queue request song is not in this room catalog.");
  const singerNumbers = validSingerNumbers(room, queueItem.singerNumbers);
  enqueueRequest(room, {
    ...(queueItem as QueueItem),
    requestedByPlayerId: actor.playerId,
    singerNumbers: singerNumbers.length ? singerNumbers : [actor.playerNumber],
  });
}

export function applyPhoneQueueUpdate(
  room: Room,
  remotePeerId: string,
  message: QueueUpdateRequestMessage,
): void {
  const actor = pairedActor(room, remotePeerId, message.playerId);
  if (!actor?.playerNumber)
    throw new Error("Queue update needs a paired player number.");
  const queueItem = room.queue.find(
    (item) => item.queueItemId === message.queueItemId,
  );
  if (!queueItem) throw new Error("Queue item not found.");
  if (message.action === "join")
    addSingerToQueueItem(room, queueItem.queueItemId, actor.playerNumber);
  else if (message.action === "leave")
    removeSingerFromQueueItem(room, queueItem.queueItemId, actor.playerNumber);
  else if (
    message.action === "remove" &&
    queueItem.requestedByPlayerId === actor.playerId &&
    !["active", "ended"].includes(queueItem.status)
  )
    removeQueueItem(room, queueItem.queueItemId);
  else throw new Error("Queue update not allowed.");
}
