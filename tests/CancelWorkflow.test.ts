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

describe("Cancel Workflow", () => {
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
        steps: [{ activity: mockActivity }],
      },
      sessionManager
    );

    workflow.attachToServer(mockServer);
  });

  test("should cancel a running workflow", async () => {
    const { session } = await workflow.start();
    const sessionId = session.sessionId;

    const cancelResponse = await workflow.cancel(sessionId);

    const updatedSession = await sessionManager.getSession(sessionId);

    expect(updatedSession?.status).toBe(WorkflowStatus.CANCELLED);
  });

  test("should not be able to continue a cancelled workflow", async () => {
    const { session } = await workflow.start();
    const sessionId = session.sessionId;

    await workflow.cancel(sessionId);

    await expect(workflow.continue()).rejects.toThrow(
      "Cannot continue workflow in status: cancelled"
    );
  });
});
