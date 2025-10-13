import { vi, describe, expect, test, beforeEach, Mock } from "vitest";
import { WorkflowSessionManager } from "../src/WorkflowSessionManager";
import { WorkflowStore } from "../src/WorkflowStore";
import { WorkflowStatus } from "../src/types";

const mockStore: WorkflowStore = {
  createSession: vi.fn(),
  getSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  listSessions: vi.fn(),
  getStats: vi.fn().mockResolvedValue({ total: 0 }),
  cleanup: vi.fn(),
  setMemory: vi.fn(),
  getMemory: vi.fn(),
  recordStepExecution: vi.fn(),
  recordBranchDecision: vi.fn(),
  close: vi.fn(),
};

describe("WorkflowSessionManager", () => {
  let manager: WorkflowSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorkflowSessionManager({ store: mockStore });
  });

  test("createSession", async () => {
    await manager.createSession("test-workflow", 5);
    expect(mockStore.createSession).toHaveBeenCalled();
  });

  test("getSession", async () => {
    await manager.getSession("test-session");
    expect(mockStore.getSession).toHaveBeenCalledWith("test-session");
  });

  test("updateSession", async () => {
    await manager.updateSession("test-session", {
      status: WorkflowStatus.RUNNING,
    });
    expect(mockStore.updateSession).toHaveBeenCalledWith("test-session", {
      status: WorkflowStatus.RUNNING,
    });
  });

  test("setMemory and getMemory", async () => {
    await manager.setMemory("test-session", "key", "value");
    expect(mockStore.setMemory).toHaveBeenCalledWith(
      "test-session",
      "key",
      "value"
    );

    await manager.getMemory("test-session", "key");
    expect(mockStore.getMemory).toHaveBeenCalledWith("test-session", "key");
  });

  test("recordStepExecution", async () => {
    const args = [
      "session",
      1,
      "activity",
      new Date(),
      new Date(),
      true,
      undefined,
    ] as const;
    await manager.recordStepExecution(...args);
    expect(mockStore.recordStepExecution).toHaveBeenCalledWith(...args);
  });

  test("recordBranchDecision", async () => {
    const args = ["session", 1, "pattern", "tool"] as const;
    await manager.recordBranchDecision(...args);
    expect(mockStore.recordBranchDecision).toHaveBeenCalledWith(...args);
  });

  test("completeSession", async () => {
    await manager.completeSession("test-session", WorkflowStatus.COMPLETED);
    expect(mockStore.updateSession).toHaveBeenCalledWith("test-session", {
      status: WorkflowStatus.COMPLETED,
      completedAt: expect.any(Date),
      error: undefined,
    });
  });

  test("deleteSession", async () => {
    await manager.deleteSession("test-session");
    expect(mockStore.deleteSession).toHaveBeenCalledWith("test-session");
  });

  test("cleanup", async () => {
    await manager.cleanup();
    expect(mockStore.cleanup).toHaveBeenCalled();
  });

  test("getSessionsForWorkflow", async () => {
    await manager.getSessionsForWorkflow("test-workflow");
    expect(mockStore.listSessions).toHaveBeenCalledWith({
      workflowName: "test-workflow",
    });
  });

  test("getStats", async () => {
    (mockStore.listSessions as Mock).mockResolvedValue([
      { workflowName: "wf1" },
      { workflowName: "wf1" },
      { workflowName: "wf2" },
    ]);
    const stats = await manager.getStats();
    expect(stats.byWorkflow).toEqual({ wf1: 2, wf2: 1 });
  });

  test("close", async () => {
    await manager.close();
    expect(mockStore.close).toHaveBeenCalled();
  });
});
