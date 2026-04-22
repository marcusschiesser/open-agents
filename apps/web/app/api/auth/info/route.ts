import type { NextRequest } from "next/server";
import { hasDatabaseConfig } from "@/lib/db/client";
import { hasGitHubAccount as checkGitHubLinked } from "@/lib/github/token";
import { getInstallationsByUserId } from "@/lib/db/installations";
import { userExists } from "@/lib/db/users";
import { getSessionFromReq } from "@/lib/session/server";
import type { SessionUserInfo } from "@/lib/session/types";
import { getUserVercelToken } from "@/lib/vercel/token";

const UNAUTHENTICATED: SessionUserInfo = { user: undefined };
const VERCEL_USERINFO_URL = "https://api.vercel.com/login/oauth/userinfo";
const VERCEL_USERINFO_TIMEOUT_MS = 3_000;

async function requiresVercelReconnect(userId: string): Promise<boolean> {
  const token = await getUserVercelToken(userId);
  if (!token) {
    return true;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    VERCEL_USERINFO_TIMEOUT_MS,
  );

  try {
    const response = await fetch(VERCEL_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.ok) {
      return false;
    }

    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403
    ) {
      return true;
    }

    console.error(
      `Failed to validate Vercel connection status: ${response.status} ${response.statusText}`,
    );
    return false;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error("Timed out validating Vercel connection status");
      return false;
    }

    console.error("Failed to validate Vercel connection status:", error);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req);

  if (!session?.user?.id) {
    return Response.json(UNAUTHENTICATED);
  }

  if (!hasDatabaseConfig()) {
    return Response.json({
      user: session.user,
      authProvider: session.authProvider,
      hasGitHub: false,
      hasGitHubAccount: false,
      hasGitHubInstallations: false,
      vercelReconnectRequired: false,
    } satisfies SessionUserInfo);
  }

  const vercelReconnectPromise =
    session.authProvider === "vercel"
      ? requiresVercelReconnect(session.user.id)
      : Promise.resolve(false);

  // Run the user-existence check in parallel with the auth queries
  // so there is zero added latency on the happy path.
  const [exists, hasGitHubAccount, installations, vercelReconnectRequired] =
    await Promise.all([
      userExists(session.user.id),
      checkGitHubLinked(session.user.id),
      getInstallationsByUserId(session.user.id),
      vercelReconnectPromise,
    ]);

  if (!exists) {
    return Response.json(UNAUTHENTICATED);
  }
  const hasGitHubInstallations = installations.length > 0;
  const hasGitHub = hasGitHubAccount || hasGitHubInstallations;

  const data: SessionUserInfo = {
    user: session.user,
    authProvider: session.authProvider,
    hasGitHub,
    hasGitHubAccount,
    hasGitHubInstallations,
    vercelReconnectRequired,
  };

  return Response.json(data);
}
