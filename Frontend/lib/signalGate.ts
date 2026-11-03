/**
 * Fires once after `active` has stayed true for holdMs, then waits cooldownMs.
 * A gap resets the hold, so a blink or a quick glance does not count.
 */
export function createSignalGate(holdMs: number, cooldownMs: number) {
  let since: number | null = null;
  let cooledUntil = 0;

  return {
    update(active: boolean, now: number) {
      if (!active) {
        since = null;
        return false;
      }
      if (now < cooledUntil) return false;
      if (since == null) since = now;
      if (now - since >= holdMs) {
        since = null;
        cooledUntil = now + cooldownMs;
        return true;
      }
      return false;
    },
  };
}
