import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";
import { databaseUrlFromEnvironment } from "./database-url.mjs";

const databaseUrl = databaseUrlFromEnvironment();

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 5, prepare: false });

try {
  await sql`select pg_advisory_lock(hashtext('abn_guard_migrations'))`;
  await sql`create table if not exists abn_guard_migrations (
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`;

  const files = (await readdir(new URL("../drizzle-pg/", import.meta.url)))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const name of files) {
    const migration = await readFile(new URL(`../drizzle-pg/${name}`, import.meta.url), "utf8");
    const checksum = createHash("sha256").update(migration).digest("hex");
    const [applied] = await sql`select checksum from abn_guard_migrations where name = ${name}`;
    if (applied) {
      if (applied.checksum !== checksum) throw new Error(`Applied migration ${name} has changed.`);
      continue;
    }
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`insert into abn_guard_migrations (name, checksum) values (${name}, ${checksum})`;
    });
    console.log(`Applied ${name}`);
  }
} finally {
  await sql`select pg_advisory_unlock(hashtext('abn_guard_migrations'))`.catch(() => undefined);
  await sql.end({ timeout: 5 });
}
