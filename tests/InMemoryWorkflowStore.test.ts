import { vi, describe, expect, test, beforeEach } from "vitest";
import { InMemoryWorkflowStore } from "../src/InMemoryWorkflowStore";
import { WorkflowSession, WorkflowStatus } from "../src/types";

describe("InMemoryWorkflowStore", () => {
  let store: InMemoryWorkflowStore;
  let session: WorkflowSession;

  beforeEach(() => {
    store = new InMemoryWorkflowStore();
    session = {
      sessionId: "test-session",
      workflowName: "test-workflow",
      status: WorkflowStatus.RUNNING,
      startedAt: new Date(),
      history: [],
      memory: new Map(),
      branchHistory: [],
      currentStep: 0,
      totalSteps: 3,
    };
  });

  test("createSession and getSession", async () => {
    await store.createSession(session);
    const retrieved = await store.getSession("test-session");
    expect(retrieved).toEqual(session);
  });

  test("updateSession", async () => {
    await store.createSession(session);
    await store.updateSession("test-session", {
      status: WorkflowStatus.COMPLETED,
    });
    const retrieved = await store.getSession("test-session");
    expect(retrieved?.status).toBe(WorkflowStatus.COMPLETED);
  });

  test("deleteSession", async () => {
    await store.createSession(session);
    await store.deleteSession("test-session");
    const retrieved = await store.getSession("test-session");
    expect(retrieved).toBeUndefined();
  });

  test("listSessions", async () => {
    await store.createSession(session);
    const sessions = await store.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual(session);
  });

  test("getStats", async () => {
    await store.createSession(session);
    const stats = await store.getStats();
    expect(stats.total).toBe(1);
    expect(stats.running).toBe(1);
  });

  test("cleanup", async () => {
    await store.createSession(session);
    const deletedCount = await store.cleanup({ maxAge: -1 });
    expect(deletedCount).toBe(1);
    const sessions = await store.listSessions();
    expect(sessions).toHaveLength(0);
  });

  test("setMemory and getMemory", async () => {
    await store.createSession(session);
    await store.setMemory("test-session", "key", "value");
    const value = await store.getMemory("test-session", "key");
    expect(value).toBe("value");
  });

  test("recordStepExecution", async () => {
    await store.createSession(session);
    await store.recordStepExecution(
      "test-session",
      0,
      "test-activity",
      new Date(),
      new Date(),
      true
    );
    const retrieved = await store.getSession("test-session");
    expect(retrieved?.history).toHaveLength(1);
  });

  test("recordBranchDecision", async () => {
    await store.createSession(session);
    await store.recordBranchDecision(
      "test-session",
      0,
      "test-pattern",
      "test-tool"
    );
    const retrieved = await store.getSession("test-session");
    expect(retrieved?.branchHistory).toHaveLength(1);
  });

  test("close", async () => {
    await store.createSession(session);
    await store.close();
    const sessions = await store.listSessions();
    expect(sessions).toHaveLength(0);
  });
});
