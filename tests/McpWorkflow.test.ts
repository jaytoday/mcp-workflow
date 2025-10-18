import { vi, describe, expect, test, beforeEach, type Mock } from "vitest";
import { McpWorkflow, WorkflowSessionManager } from "../src";
import { McpActivityTool } from "../src/McpActivityTool";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";

vi.mock("../src/McpActivityTool", () => {
  const McpActivityTool = vi.fn();
  McpActivityTool.prototype.execute = vi.fn();
  McpActivityTool.prototype.name = "test_activity";
  McpActivityTool.prototype.getInputSchema = vi.fn(() => z.object({}));
  return { McpActivityTool };
});

vi.mock("@modelcontextprotocol/sdk/server", () => ({
  McpServer: vi.fn().mockImplementation(() => ({
    registerTool: vi.fn(),
    sendLoggingMessage: vi.fn(),
  })),
}));

describe("McpWorkflow", () => {
  let sessionManager: WorkflowSessionManager;
  let mockActivity: McpActivityTool;
  let workflow: McpWorkflow;
  let mockServer: McpServer;

  beforeEach(() => {
    sessionManager = new WorkflowSessionManager();
    mockActivity = new McpActivityTool("test_activity", "test activity", {
      callbacks: { run: vi.fn() },
    });
    mockServer = new McpServer({ name: "test", version: "0.0.1" });

    mockServer.sendLoggingMessage = vi.fn();

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

  test("Workflow starts a new session when run", async () => {
    const createSessionSpy = vi.spyOn(sessionManager, "createSession");
    (mockActivity.execute as Mock).mockResolvedValue({ success: true });

    await workflow.start();

    expect(createSessionSpy).toHaveBeenCalledOnce();
    expect(createSessionSpy).toHaveBeenCalledWith("test_workflow", 1);
  });

  describe("Logging", () => {
    test("should log start and completion messages on success", async () => {
      (mockActivity.execute as Mock).mockResolvedValue({ success: true });

      await workflow.start();

      expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
        data: "[test_activity] began execution",
        level: "info",
      });
    });

    test("should log start and error messages on failure", async () => {
      const testError = new Error("Activity failed");
      (mockActivity.execute as Mock).mockRejectedValue(testError);

      await workflow.start();

      expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
        data: "[test_activity] failed with error: Activity failed",
        level: "error",
      });
    });
  });
});
