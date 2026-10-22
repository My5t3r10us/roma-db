import test from "node:test";
import assert from "node:assert/strict";
import * as pg from "../../backend/postgres";
import { hbaApply, hbaRead } from "../../backend/hba";
import { parseHba, serializeHba } from "../../shared/hba";
import type { ProfileInput } from "../../shared/types";

test("pg_hba.conf is readable and protected on the shared dev server", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  const database = decodeURIComponent(url.pathname.slice(1));
  assert(database.endsWith("_test"), "Integration tests must use a devdb _test database.");
  const profile: ProfileInput = {
    id: "integration",
    name: "Test",
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    maintenanceDb: database,
    ssl: "disable",
    ca: "",
    cert: "",
    color: "#7755df",
  };
  const client = await pg.connect(profile);
  try {
    const file = await hbaRead(client, profile);
    assert.match(file.path, /pg_hba\.conf$/);
    assert.equal(file.fingerprint.length, 64);
    assert.equal(serializeHba(parseHba(file.content)).replace(/\r/g, ""), file.content.replace(/\r/g, "").replace(/\n*$/, "\n"));
    assert.ok(parseHba(file.content).some((e) => e.kind === "rule"));
    // The shared server must never be rewritten: read-only, and the write path refuses.
    assert.equal(file.writable, false);
    await assert.rejects(hbaApply(client, profile, { content: file.content, fingerprint: file.fingerprint }), /devdb/);
  } finally {
    await client.end();
  }
});
