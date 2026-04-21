import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  // eslint-disable-next-line no-var
  var __openHarnessPostgresSql: Sql | undefined;
  // eslint-disable-next-line no-var
  var __openHarnessDrizzleClient: DrizzleClient | undefined;
}

export function hasDatabaseConfig(): boolean {
  return Boolean(process.env.POSTGRES_URL);
}

function getPostgresMaxConnections(): number {
  const configuredMax = Number(process.env.POSTGRES_MAX_CONNECTIONS);

  if (Number.isFinite(configuredMax) && configuredMax >= 1) {
    return Math.floor(configuredMax);
  }

  return process.env.NODE_ENV === "development" ? 1 : 10;
}

function getOrCreateDb(): DrizzleClient {
  const postgresUrl = process.env.POSTGRES_URL;
  if (!postgresUrl) {
    throw new Error("POSTGRES_URL environment variable is required");
  }

  globalThis.__openHarnessPostgresSql ??= postgres(postgresUrl, {
    max: getPostgresMaxConnections(),
  });
  globalThis.__openHarnessDrizzleClient ??= drizzle(
    globalThis.__openHarnessPostgresSql,
    { schema },
  );

  return globalThis.__openHarnessDrizzleClient;
}

export const db = new Proxy({} as DrizzleClient, {
  get(_, prop) {
    return Reflect.get(getOrCreateDb(), prop);
  },
});
