/** Picking the Chainlink round that closes an hour. Pure, so it is tested without a chain. */

export interface Round {
  roundId: bigint;
  answer: bigint;
  updatedAt: number;
}

export type RoundReader = (roundIds: readonly (bigint | "latest")[]) => Promise<(Round | null)[]>;

export type CloseResult =
  | { status: "ok"; round: Round }
  | { status: "no_round"; reason: string };

/**
 * The close of the hour ending at `hourEnd` is the newest round with updatedAt < hourEnd.
 * Starts from `latest` and walks back one round at a time, up to `maxSteps` rounds.
 * Within one Chainlink phase, round ids are consecutive, so roundId - 1 is the previous round.
 */
export async function closeBefore(read: RoundReader, hourEnd: number, maxSteps = 24): Promise<CloseResult> {
  const [latest] = await read(["latest"]);
  if (!latest) return { status: "no_round", reason: "latestRoundData failed" };
  let r: Round = latest;
  for (let step = 0; r.updatedAt >= hourEnd; step++) {
    if (step >= maxSteps) return { status: "no_round", reason: `more than ${maxSteps} rounds after the hour` };
    const phaseRound = r.roundId & ((1n << 64n) - 1n);
    if (phaseRound <= 1n) return { status: "no_round", reason: "reached the start of the feed phase" };
    const [prev] = await read([r.roundId - 1n]);
    if (!prev || prev.updatedAt === 0) return { status: "no_round", reason: `round ${r.roundId - 1n} unreadable` };
    r = prev;
  }
  if (r.answer <= 0n) return { status: "no_round", reason: "non-positive answer" };
  return { status: "ok", round: r };
}

/** Hours to ingest this run: from the hour after `lastDone` up to the last closed hour, oldest first. */
export function hoursToIngest(nowSec: number, lastDone: number | null, maxHours: number): number[] {
  const lastClosed = nowSec - (nowSec % 3600) - 3600;
  const start = lastDone === null ? lastClosed : Math.max(lastDone + 3600, lastClosed - (maxHours - 1) * 3600);
  const out: number[] = [];
  for (let h = start; h <= lastClosed && out.length < maxHours; h += 3600) out.push(h);
  return out;
}
