import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { databaseUrlFromEnvironment } from "../app/server/database-url";

let client: ReturnType<typeof postgres> | null = null;

export function getDb() {
  const url = databaseUrlFromEnvironment();
  client ??= postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10 });
  return drizzle(client, { schema });
}
