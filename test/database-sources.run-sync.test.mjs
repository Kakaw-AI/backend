import test from "node:test";
import assert from "node:assert/strict";
import { HttpException } from "@nestjs/common";
import { DatabaseSourcesService } from "../dist/database-sources/database-sources.service.js";

test("runSync stores the upstream error message instead of Nest's generic HttpException text", async () => {
  let recordedFailure = null;

  const service = new DatabaseSourcesService(
    {
      async findRuntimeById() {
        return {
          id: "source-1",
          userId: "user-1",
          provider: "sqlite",
          sqliteFilePath: "/tmp/example.db",
          sqliteOriginalFilename: "example.db",
          schemaFingerprint: null,
          status: "SYNCING",
          lastError: null,
          lastTestedAt: null,
          lastSyncedAt: null,
        };
      },
      async markFailure(_id, lastError) {
        recordedFailure = lastError;
      },
      async markReady() {
        throw new Error("markReady should not be called in this test");
      },
    },
    {
      createRequestId() {
        return "request-1";
      },
      async syncDatabaseSource() {
        throw new HttpException(
          {
            error: {
              message: "AGENT_SHARED_SECRET is not configured.",
              code: "AGENT_RUNTIME_ERROR",
              statusCode: 500,
              retryable: false,
            },
          },
          500,
        );
      },
    },
    {
      async replaceCatalog() {
        throw new Error("replaceCatalog should not be called in this test");
      },
    },
    {
      async fingerprint() {
        return "fingerprint";
      },
    },
  );

  await service.runSync("source-1");

  assert.equal(recordedFailure, "AGENT_SHARED_SECRET is not configured.");
});
