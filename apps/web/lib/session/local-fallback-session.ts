import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, hasDatabaseConfig } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import type { Session } from "./types";

const LOCAL_FALLBACK_EXTERNAL_ID = "local-dev-user";
const LOCAL_FALLBACK_USER_ID = "local-dev-user";

const LOCAL_FALLBACK_USER = {
  username: "local",
  email: undefined,
  avatar: "",
  name: "Local User",
} satisfies Omit<Session["user"], "id">;

async function ensureLocalFallbackUserId(): Promise<string> {
  if (!hasDatabaseConfig()) {
    return LOCAL_FALLBACK_USER_ID;
  }

  const existingUser = await db.query.users.findFirst({
    where: and(
      eq(users.provider, "github"),
      eq(users.externalId, LOCAL_FALLBACK_EXTERNAL_ID),
    ),
    columns: {
      id: true,
    },
  });

  if (existingUser) {
    return existingUser.id;
  }

  const userId = nanoid();
  const now = new Date();

  await db.insert(users).values({
    id: userId,
    provider: "github",
    externalId: LOCAL_FALLBACK_EXTERNAL_ID,
    accessToken: "local-dev-access-token",
    username: LOCAL_FALLBACK_USER.username,
    email: LOCAL_FALLBACK_USER.email,
    name: LOCAL_FALLBACK_USER.name,
    avatarUrl: LOCAL_FALLBACK_USER.avatar,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  });

  return userId;
}

export const getLocalFallbackSession = cache(async (): Promise<Session> => {
  const userId = await ensureLocalFallbackUserId();

  return {
    created: Date.now(),
    authProvider: "github",
    user: {
      id: userId,
      ...LOCAL_FALLBACK_USER,
    },
  };
});
