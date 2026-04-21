import type { Source } from "../types";

export interface DaytonaState {
  /** Where to clone from (omit for empty sandbox or when reconnecting/restoring) */
  source?: Source;
  /** Durable sandbox name used for reconnecting/resuming sessions */
  sandboxName?: string;
  /** Runtime sandbox identifier */
  sandboxId?: string;
  /** Timestamp (ms) when the current runtime session expires */
  expiresAt?: number;
}
