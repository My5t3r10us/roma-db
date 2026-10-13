import test from "node:test";
import assert from "node:assert/strict";
import { sslOptions, connectionError } from "../backend/connection";
import { profileSchema as nodeProfile } from "../backend/sql";
import { profileSchema as nativeProfile } from "../backend/sql-lite";
import type { ProfileInput } from "../shared/types";
const profile: ProfileInput = {
  id: "tls-test",
  name: "TLS",
  host: "db.example.test",
  port: 5432,
  user: "postgres",
  maintenanceDb: "example",
  ssl: "verify-full",
  ca: "",
  cert: "",
  color: "#7755df",
};
test("verified SSL remains strict and non-SSL is explicit", () => {
  assert.deepEqual(sslOptions(profile), { rejectUnauthorized: true });
  assert.equal(sslOptions({ ...profile, ssl: "disable" }), false);
});
test("require explicitly encrypts without trusting self-signed certificates automatically", () => {
  assert.deepEqual(sslOptions({ ...profile, ssl: "require" }), {
    rejectUnauthorized: false,
  });
  assert.deepEqual(sslOptions(profile), { rejectUnauthorized: true });
  assert.deepEqual(
    sslOptions({ ...profile, ssl: "require", cert: "cert", privateKey: "key" }),
    { rejectUnauthorized: false, cert: "cert", key: "key" },
  );
});
test("both runtime validators accept require and preserve existing profiles", () => {
  for (const ssl of ["disable", "require", "verify-full"] as const) {
    const input = { ...profile, ssl };
    assert.equal(nodeProfile.parse(input).ssl, ssl);
    assert.equal(nativeProfile(input).ssl, ssl);
  }
});
test("encryption and certificate errors offer specific remediation", () => {
  assert.match(
    connectionError({
      message:
        'pg_hba.conf rejects connection for host "example", no encryption',
    }),
    /Activez SSL/,
  );
  assert.match(
    connectionError({
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
      message: "self-signed certificate",
    }),
    /autorité de certification/,
  );
  assert.match(
    connectionError({
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
      message: "hostname mismatch",
    }),
    /nom DNS/,
  );
  assert.equal(
    connectionError({
      code: "28P01",
      message: "password authentication failed",
    }),
    "password authentication failed",
  );
});
