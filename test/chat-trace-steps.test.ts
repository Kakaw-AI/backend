import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConversationSteps,
  extractLatestTraceSteps,
} from "../src/chat/trace-steps.ts";

test("extractLatestTraceSteps reads the latest persisted trace steps", () => {
  const steps = extractLatestTraceSteps([
    {
      steps: [
        { text: "Loading indexed schema context...", at: "2026-04-03T10:00:00.000Z" },
        { text: "Generating read-only SQL...", at: "2026-04-03T10:00:01.000Z" },
      ],
    },
  ]);

  assert.deepEqual(steps, [
    { text: "Loading indexed schema context...", at: "2026-04-03T10:00:00.000Z" },
    { text: "Generating read-only SQL...", at: "2026-04-03T10:00:01.000Z" },
  ]);
});

test("buildConversationSteps returns visible completed steps", () => {
  const steps = buildConversationSteps([
    { text: "Loading indexed schema context...", at: "2026-04-03T10:00:00.000Z" },
    { text: "Generating read-only SQL...", at: "2026-04-03T10:00:01.000Z" },
  ]);

  assert.deepEqual(steps, [
    { seq: 0, text: "Loading indexed schema context...", done: true },
    { seq: 1, text: "Generating read-only SQL...", done: true },
  ]);
});
