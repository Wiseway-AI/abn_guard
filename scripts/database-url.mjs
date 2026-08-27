export function databaseUrlFromEnvironment(environment = process.env) {
  const configured = environment.DATABASE_URL?.trim();
  if (configured) return configured;
  const host = environment.DB_HOST?.trim();
  const username = environment.DB_USERNAME?.trim();
  const password = environment.DB_PASSWORD;
  if (!host || !username || !password) throw new Error("DATABASE_URL or complete DB_* settings are required.");
  const port = environment.DB_PORT?.trim() || "5432";
  const database = environment.DB_NAME?.trim() || "abn_guard";
  return `postgres://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}?sslmode=require`;
}
