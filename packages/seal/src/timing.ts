/** Hour H is sealed on time if its seal lands before the close of hour H+1. */
export const hourStart = (unixSec: number): number => unixSec - (((unixSec % 3600) + 3600) % 3600);

/** Last second (exclusive) at which a seal for `hour` counts as on time. */
export const sealDeadline = (hour: number): number => hour + 2 * 3600;

export type SealTiming = "on_time" | "late" | "too_early";

export function sealTiming(hour: number, blockTimestamp: number): SealTiming {
  // The hour's decisions exist only after it closes, so a seal before hour + 3600 is invalid.
  if (blockTimestamp < hour + 3600) return "too_early";
  return blockTimestamp < sealDeadline(hour) ? "on_time" : "late";
}
