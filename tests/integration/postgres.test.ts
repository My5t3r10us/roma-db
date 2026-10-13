import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as pg from "../../backend/postgres";
import { qi } from "../../backend/sql";
import type { Change, ProfileInput, Resource } from "../../shared/types";

test("PostgreSQL integration on the devdb test database", async (t) => {
  const url = new URL(process.env.DATABASE_URL!);
  const database = decodeURIComponent(url.pathname.slice(1));
  assert(
    database.endsWith("_test"),
    "Integration tests must use a devdb _test database.",
  );
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
  const prefix = "roma_test_" + randomUUID().replaceAll("-", "").slice(0, 10);
  const schema = prefix;
  const reader = prefix + "_reader";
  const member = prefix + "_member";
  const denied = prefix + "_denied";
  const roleInput = (name: string, login = false) => ({
    name,
    login,
    superuser: false,
    createDb: false,
    createRole: false,
    inherit: true,
    replication: false,
    bypassRls: false,
    connectionLimit: -1,
    password: login ? "temporary-test-pass" : undefined,
  });
  let objects: Resource[] = [];
  function target(name: string) {
    const result = objects.find((r) => r.name === name);
    assert(result);
    return result;
  }
  async function change(
    resource: Resource,
    role: string,
    privilege: string,
    action: "grant" | "revoke" = "grant",
    p = profile,
    c = client,
  ): Promise<Change> {
    const snapshot = await pg.access(c, p, resource, role);
    return {
      id: randomUUID(),
      profileId: p.id,
      database,
      resource,
      role,
      privilege,
      action,
      grantOption: false,
      fingerprint: snapshot.fingerprint,
    };
  }
  try {
    await pg.crud(client, profile, {
      kind: "schema",
      action: "create",
      name: schema,
    });
    for (const name of [reader, member, denied])
      await pg.crud(client, profile, {
        kind: "role",
        action: "create",
        name,
        role: roleInput(name, name === denied),
      });
    await client.query(
      `CREATE TABLE ${qi(schema)}."records" (id integer, tenant_id integer); CREATE SEQUENCE ${qi(schema)}."record_ids"; CREATE VIEW ${qi(schema)}."record_view" AS SELECT * FROM ${qi(schema)}."records"; CREATE FUNCTION ${qi(schema)}."total"(value integer) RETURNS integer LANGUAGE sql AS 'SELECT $1'; CREATE FUNCTION ${qi(schema)}."total"(value text) RETURNS text LANGUAGE sql AS 'SELECT $1'; ALTER TABLE ${qi(schema)}."records" ENABLE ROW LEVEL SECURITY; CREATE POLICY tenant_rule ON ${qi(schema)}."records" USING (tenant_id=1)`,
    );
    objects = await pg.resources(client, schema);
    await t.test(
      "catalog discovery, RLS and overloaded functions",
      async () => {
        assert.equal(objects.filter((r) => r.kind === "function").length, 2);
        assert(objects.some((r) => r.kind === "sequence"));
        const info = await pg.overview(client, profile);
        assert(info.server.sharedDev);
        assert(info.roles.some((r) => r.name === reader));
        const snapshot = await pg.access(
          client,
          profile,
          target("records"),
          reader,
        );
        assert.equal(snapshot.policies[0].name, "tenant_rule");
        assert(!snapshot.schemaUsage);
      },
    );
    await t.test(
      "direct grants, inherited membership, grant option and PUBLIC",
      async () => {
        const table = target("records");
        const grant = await change(table, reader, "SELECT");
        grant.grantOption = true;
        await pg.apply(client, profile, database, [grant]);
        let snapshot = await pg.access(client, profile, table, reader);
        assert(
          snapshot.permissions.some(
            (p) => p.source === "direct" && p.grantable,
          ),
        );
        await pg.membership(client, profile, {
          role: reader,
          member,
          action: "grant",
          admin: false,
          inherit: true,
          set: true,
        });
        snapshot = await pg.access(client, profile, table, member);
        assert(
          snapshot.permissions.some(
            (p) => p.source === "inherited" && p.via === reader,
          ),
        );
        const publicChange = await change(table, "PUBLIC", "UPDATE");
        await pg.apply(client, profile, database, [publicChange]);
        snapshot = await pg.access(client, profile, table, member);
        assert(
          snapshot.permissions.some(
            (p) => p.source === "public" && p.privilege === "UPDATE",
          ),
        );
        await pg.apply(client, profile, database, [
          await change(table, member, "SELECT"),
        ]);
        await pg.apply(client, profile, database, [
          await change(table, member, "SELECT", "revoke"),
        ]);
        snapshot = await pg.access(client, profile, table, member);
        assert(
          !snapshot.permissions.some(
            (p) => p.source === "direct" && p.privilege === "SELECT",
          ),
        );
        assert(
          snapshot.permissions.some(
            (p) => p.source === "inherited" && p.privilege === "SELECT",
          ),
        );
      },
    );
    await t.test("concurrent changes abort the complete batch", async () => {
      const prepared = await change(target("records"), reader, "INSERT");
      await client.query(
        `GRANT DELETE ON ${qi(schema)}."records" TO ${qi(reader)}`,
      );
      await assert.rejects(
        pg.apply(client, profile, database, [prepared]),
        /Conflit/,
      );
      const state = await pg.access(client, profile, target("records"), reader);
      assert(!state.permissions.some((p) => p.privilege === "INSERT"));
    });
    await t.test("default privileges affect future tables only", async () => {
      const state = await pg.defaultAccess(
        client,
        profile.user,
        schema,
        "table",
      );
      const prepared: Change = {
        id: randomUUID(),
        profileId: profile.id,
        database,
        resource: {
          oid: 0,
          name: "future",
          schema,
          kind: "table",
          owner: profile.user,
        },
        role: reader,
        privilege: "SELECT",
        action: "grant",
        grantOption: false,
        fingerprint: state.fingerprint,
        defaultOwner: profile.user,
      };
      await pg.apply(client, profile, database, [prepared]);
      await client.query(`CREATE TABLE ${qi(schema)}."future" (id integer)`);
      objects = await pg.resources(client, schema);
      const future = await pg.access(client, profile, target("future"), reader);
      assert(
        future.permissions.some(
          (p) => p.source === "direct" && p.privilege === "SELECT",
        ),
      );
      assert(
        (await pg.defaults(client)).some(
          (p) => p.schema === schema && p.role === reader,
        ),
      );
    });
    await t.test(
      "authoritative function signature prevents injected client identity",
      async () => {
        const func = objects.find(
          (r) => r.kind === "function" && r.identity?.includes("integer"),
        )!;
        const prepared = await change(func, reader, "EXECUTE");
        prepared.resource = {
          ...prepared.resource,
          identity: "); DROP SCHEMA public CASCADE; --",
        };
        const sql = await pg.preview(client, profile, database, [prepared]);
        assert(sql[0].includes("(value integer)"));
        assert(!sql[0].includes("DROP"));
        await pg.apply(client, profile, database, [prepared]);
      },
    );
    await t.test(
      "a SQL permission failure rolls back earlier grants",
      async () => {
        await client.query(
          `GRANT USAGE ON SCHEMA ${qi(schema)} TO ${qi(denied)}; CREATE TABLE ${qi(schema)}."owned_by_denied" (id integer); ALTER TABLE ${qi(schema)}."owned_by_denied" OWNER TO ${qi(denied)}`,
        );
        objects = await pg.resources(client, schema);
        const restricted = {
          ...profile,
          id: "restricted",
          user: denied,
          password: "temporary-test-pass",
        };
        const restrictedClient = await pg.connect(restricted);
        try {
          const first = await change(
            target("owned_by_denied"),
            reader,
            "INSERT",
            "grant",
            restricted,
            restrictedClient,
          );
          const second = await change(
            target("future"),
            reader,
            "INSERT",
            "grant",
            restricted,
            restrictedClient,
          );
          await assert.rejects(
            pg.apply(restrictedClient, restricted, database, [first, second]),
          );
          const state = await pg.access(
            client,
            profile,
            target("owned_by_denied"),
            reader,
          );
          assert(
            !state.permissions.some(
              (p) => p.role === reader && p.privilege === "INSERT",
            ),
          );
        } finally {
          await restrictedClient.end();
        }
      },
    );
    await t.test(
      "shared database lifecycle is blocked, including aliases",
      async () => {
        for (const host of ["127.0.0.1", "localhost"]) {
          await assert.rejects(
            pg.crud(
              client,
              { ...profile, host },
              { kind: "database", action: "create", name: prefix + "_db" },
            ),
            /devdb/,
          );
          await assert.rejects(
            pg.crud(
              client,
              { ...profile, host },
              {
                kind: "database",
                action: "delete",
                name: database,
                confirmation: database,
              },
            ),
            /devdb/,
          );
        }
      },
    );
    await t.test(
      "role deletion reports cross-database dependencies and refuses cascade",
      async () => {
        const deps = await pg.dependencies(client, "role", reader);
        assert(deps.length > 0);
        await assert.rejects(
          pg.crud(client, profile, {
            kind: "role",
            action: "delete",
            name: reader,
            confirmation: reader,
          }),
          /dépendances/,
        );
      },
    );
    await t.test(
      "bad credentials and SSL failures remain explicit",
      async () => {
        await assert.rejects(
          pg.connect({ ...profile, password: "incorrect-test-password" }),
        );
        await assert.rejects(pg.connect({ ...profile, ssl: "verify-full" }));
        await assert.rejects(pg.connect({ ...profile, ssl: "require" }));
      },
    );
    await t.test(
      "schema and role rename/update/delete validation",
      async () => {
        const disposable = prefix + "_disposable";
        await pg.crud(client, profile, {
          kind: "schema",
          action: "create",
          name: disposable,
        });
        await pg.crud(client, profile, {
          kind: "schema",
          action: "update",
          name: disposable,
          newName: disposable + "_new",
        });
        await assert.rejects(
          pg.crud(client, profile, {
            kind: "schema",
            action: "delete",
            name: disposable + "_new",
            confirmation: "wrong",
          }),
        );
        await pg.crud(client, profile, {
          kind: "schema",
          action: "delete",
          name: disposable + "_new",
          confirmation: disposable + "_new",
        });
        const name = prefix + "_rename";
        await pg.crud(client, profile, {
          kind: "role",
          action: "create",
          name,
          role: roleInput(name),
        });
        await pg.crud(client, profile, {
          kind: "role",
          action: "update",
          name,
          newName: name + "_new",
          role: roleInput(name),
        });
        await pg.crud(client, profile, {
          kind: "role",
          action: "delete",
          name: name + "_new",
          confirmation: name + "_new",
        });
      },
    );
  } finally {
    // Remove only the objects created by this run, never a database or unrelated object.
    await client.query(
      `DROP VIEW IF EXISTS ${qi(schema)}."record_view"; DROP FUNCTION IF EXISTS ${qi(schema)}."total"(integer); DROP FUNCTION IF EXISTS ${qi(schema)}."total"(text); DROP TABLE IF EXISTS ${qi(schema)}."records"; DROP TABLE IF EXISTS ${qi(schema)}."future"; DROP TABLE IF EXISTS ${qi(schema)}."owned_by_denied"; DROP SEQUENCE IF EXISTS ${qi(schema)}."record_ids"; DROP SCHEMA IF EXISTS ${qi(schema)} RESTRICT`,
    );
    for (const name of [member, reader, denied])
      await pg.crud(client, profile, {
        kind: "role",
        action: "delete",
        name,
        confirmation: name,
      });
    await client.end();
  }
});
