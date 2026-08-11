import { randomUUID } from 'expo-crypto';

/**
 * Ids are UUIDs generated on the device, not by the database.
 *
 * Two reasons it has to work this way. A habit created offline needs its id
 * immediately — the row it will eventually become is the same row, and waiting
 * on a server round-trip would put the network back in the check-in path. And
 * the old scheme (`seed-0`, or `Date.now()` plus a short random suffix) collides
 * across users the moment two devices share a table.
 */
export function newId(): string {
  return randomUUID();
}
