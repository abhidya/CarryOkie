export interface LyricLine {
  startMs: number;
  endMs: number;
  text: string;
}

export interface ClockEstimate {
  rttMs: number;
  hostOffsetMs: number;
}

export interface DerivedPosition {
  positionMs: number;
  syncDegraded: boolean;
}

export function estimateHostOffset({
  clientSentAtMs,
  hostReceivedAtMs,
  clientReceivedAtMs,
}: {
  clientSentAtMs: number;
  hostReceivedAtMs: number;
  clientReceivedAtMs: number;
}): ClockEstimate {
  const rttMs = clientReceivedAtMs - clientSentAtMs;
  return {
    rttMs,
    hostOffsetMs: hostReceivedAtMs + rttMs / 2 - clientReceivedAtMs,
  };
}

export function deriveTvMediaPositionMs(
  playbackState:
    | {
        status?: string;
        tvMediaTimeMs?: number;
        tvMediaTimeSampledAtHostMs: number | null;
        playbackRate?: number;
        paused?: boolean;
        seekOffsetMs?: number;
        syncDegraded?: boolean;
      }
    | undefined,
  nowMs: number = Date.now(),
  hostOffsetMs: number = 0,
): DerivedPosition {
  if (
    !playbackState ||
    playbackState.syncDegraded ||
    playbackState.tvMediaTimeSampledAtHostMs == null
  ) {
    return {
      positionMs: playbackState?.tvMediaTimeMs || 0,
      syncDegraded: true,
    };
  }
  const hostNowMs = nowMs + hostOffsetMs;
  const elapsedMs = Math.max(
    0,
    hostNowMs - playbackState.tvMediaTimeSampledAtHostMs,
  );
  const status = playbackState.paused
    ? "paused"
    : playbackState.status || "playing";
  const shouldAdvance =
    !playbackState.paused &&
    !["paused", "idle", "ended", "host_lost", "error"].includes(status);
  const rate = playbackState.playbackRate ?? 1;
  const baseMs = playbackState.tvMediaTimeMs || 0;
  const offsetMs = playbackState.seekOffsetMs || 0;
  return {
    positionMs: Math.max(
      0,
      baseMs + offsetMs + (shouldAdvance ? elapsedMs * rate : 0),
    ),
    syncDegraded: false,
  };
}

export function activeLyricLine(
  lines: LyricLine[],
  positionMs: number,
): LyricLine | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  return (
    lines.find(
      (line) => positionMs >= line.startMs && positionMs < line.endMs,
    ) ||
    [...lines].reverse().find((line) => positionMs >= line.startMs) ||
    lines[0]
  );
}
