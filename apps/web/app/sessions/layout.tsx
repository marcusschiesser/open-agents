import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { hasDatabaseConfig } from "@/lib/db/client";
import { getLastRepoByUserId } from "@/lib/db/last-repo";
import {
  getArchivedSessionCountByUserId,
  getSessionsWithUnreadByUserId,
} from "@/lib/db/sessions";
import { getServerSession } from "@/lib/session/get-server-session";
import { SessionsRouteShell } from "./sessions-route-shell";

type SessionsLayoutProps = {
  children: ReactNode;
};

export default async function SessionsLayout({
  children,
}: SessionsLayoutProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const [lastRepo, sessions, archivedCount] = hasDatabaseConfig()
    ? await Promise.all([
        getLastRepoByUserId(session.user.id),
        getSessionsWithUnreadByUserId(session.user.id, { status: "active" }),
        getArchivedSessionCountByUserId(session.user.id),
      ])
    : [null, [], 0];

  return (
    <SessionsRouteShell
      currentUser={session.user}
      initialSessionsData={{ sessions, archivedCount }}
      lastRepo={lastRepo}
    >
      {children}
    </SessionsRouteShell>
  );
}
