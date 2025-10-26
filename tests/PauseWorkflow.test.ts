import { vi, describe, expect, test, beforeEach } from "vitest";
import { McpWorkflow, WorkflowSessionManager, WorkflowStatus } from "../src";
import { McpActivityTool } from "../src/McpActivityTool";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ActivityContext } from "../src/types";

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
  const McpServer = vi.fn(() => ({
    registerTool: vi.fn(),
    sendLoggingMessage: vi.fn(),
  }));
  return { McpServer };
});

describe("Pause Workflow", () => {
  let sessionManager: WorkflowSessionManager;
  let mockActivity: McpActivityTool;
  let workflow: McpWorkflow;
  let mockServer: McpServer;

  beforeEach(() => {
    sessionManager = new WorkflowSessionManager();

    mockActivity = new McpActivityTool("test_activity", "test activity", {
      callbacks: {
        run: async (context: ActivityContext) => {
          return { success: true, data: { result: "ok" } };
        },
      },
    });

    mockServer = new McpServer({ name: "test", version: "0.0.1" });

    workflow = new McpWorkflow(
      "test_workflow",
      "a test workflow",
      {
        steps: [{ activity: mockActivity }, { activity: mockActivity }],
      },
      sessionManager
    );

    workflow.attachToServer(mockServer);
  });

  test("should pause a running workflow", async () => {
    const { session } = await workflow.start();
    const sessionId = session.sessionId;

    await workflow.pause(sessionId);

    const updatedSession = await sessionManager.getSession(sessionId);

    expect(updatedSession?.status).toBe(WorkflowStatus.PAUSED);
  });

  test("should be able to continue a paused workflow", async () => {
    const { session } = await workflow.start();
    const sessionId = session.sessionId;

    await workflow.pause(sessionId);
    const maybePausedSession = await sessionManager.getSession(sessionId);
    expect(maybePausedSession?.status).toBe(WorkflowStatus.PAUSED);

    await workflow.continue();
    const updatedSession = await sessionManager.getSession(sessionId);
    expect(updatedSession?.status).toBe(WorkflowStatus.COMPLETED);

    expect(updatedSession?.currentStep).toBe(1);
  });
});
