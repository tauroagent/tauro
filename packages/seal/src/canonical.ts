/**
 * JSON canonicalization (RFC 8785 subset). Keys sorted by UTF-16 code units, no whitespace,
 * numbers in ECMAScript form. Non-finite numbers, undefined values and bigints are rejected,
 * so a record either has exactly one encoding or none.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonical JSON cannot hold NaN or Infinity");
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const parts: string[] = [];
      for (const k of keys) {
        if (obj[k] === undefined) throw new Error(`canonical JSON cannot hold undefined (key "${k}")`);
        parts.push(`${JSON.stringify(k)}:${canonicalize(obj[k])}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new Error(`canonical JSON cannot hold a ${typeof value}`);
  }
}
