import postgres from "postgres";

export type DatabaseClient = ReturnType<typeof postgres>;

export function createDatabaseClient(connectionString: string): DatabaseClient {
  if (!connectionString.trim()) {
    throw new Error("DATABASE_URL is required.");
  }

  return postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

declare global {
  var __orryloDatabaseClient: DatabaseClient | undefined;
}

export function getDatabaseClient(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseClient {
  const connectionString = env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL is required for persistent application state.");
  }

  if (!globalThis.__orryloDatabaseClient) {
    globalThis.__orryloDatabaseClient = createDatabaseClient(connectionString);
  }

  return globalThis.__orryloDatabaseClient;
}
