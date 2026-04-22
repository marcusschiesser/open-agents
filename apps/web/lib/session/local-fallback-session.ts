import { cache } from "react";
import { eq } from "drizzle-orm";
import { db, hasDatabaseConfig } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import type { Session } from "./types";

const AUTH_BYPASS_ENABLED = process.env.AUTH_BYPASS === "true";
const LOCAL_FALLBACK_USER_ID = "local-dev-user";

const LOCAL_FALLBACK_USER = {
  username: "local",
  email: undefined,
  avatar: "",
  name: "Local User",
} satisfies Omit<Session["user"], "id">;

export function isAuthBypassEnabled(): boolean {
  return AUTH_BYPASS_ENABLED;
}

declare global {
  // eslint-disable-next-line no-var
  var __openHarnessAuthBypassUserIdPromise: Promise<string> | undefined;
}

async function ensureAuthBypassUserId(): Promise<string> {
  if (!hasDatabaseConfig()) {
    return LOCAL_FALLBACK_USER_ID;
  }

  const existingUser = await db.query.users.findFirst({
    where: eq(users.id, LOCAL_FALLBACK_USER_ID),
    columns: {
      id: true,
    },
  });

  const now = new Date();

  if (!existingUser) {
    await db.insert(users).values({
      id: LOCAL_FALLBACK_USER_ID,
      username: LOCAL_FALLBACK_USER.username,
      email: LOCAL_FALLBACK_USER.email,
      emailVerified: false,
      name: LOCAL_FALLBACK_USER.name,
      avatarUrl: LOCAL_FALLBACK_USER.avatar,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
  }

  return LOCAL_FALLBACK_USER_ID;
}

function getAuthBypassUserIdPromise(): Promise<string> {
  globalThis.__openHarnessAuthBypassUserIdPromise ??= ensureAuthBypassUserId();
  return globalThis.__openHarnessAuthBypassUserIdPromise;
}

export const getLocalFallbackSession = cache(
  async (): Promise<Session> => ({
    created: Date.now(),
    authProvider: "github",
    user: {
      id: await getAuthBypassUserIdPromise(),
      ...LOCAL_FALLBACK_USER,
    },
  }),
);
