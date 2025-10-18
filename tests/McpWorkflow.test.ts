import {
  vi,
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  type Mock,
  MockInstance,
} from "vitest";
import { McpWorkflow, WorkflowSessionManager } from "../src";
import { McpActivityTool } from "../src/McpActivityTool";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../src/McpActivityTool", () => {
  const McpActivityTool = vi.fn();
  McpActivityTool.prototype.execute = vi.fn();
  McpActivityTool.prototype.name = "test_activity";
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
    let consoleInfoSpy: MockInstance<{
      (...data: any[]): void;
      (message?: any, ...optionalParams: any[]): void;
    }>;
    let consoleErrorSpy: MockInstance<{
      (...data: any[]): void;
      (message?: any, ...optionalParams: any[]): void;
    }>;

    beforeEach(() => {
      consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleInfoSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    test("should log start and completion messages on success", async () => {
      (mockActivity.execute as Mock).mockResolvedValue({ success: true });

      await workflow.start();

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        `[${mockActivity.name}] began execution`
      );
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringMatching(/completed in \d+ms/)
      );

      expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
        `[${mockActivity.name}] began execution`
      );
      expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
        expect.stringMatching(/completed in \d+ms/)
      );
    });

    test("should log start and error messages on failure", async () => {
      const testError = new Error("Activity failed");
      (mockActivity.execute as Mock).mockRejectedValue(testError);

      // Workflow expected to throw here
      await expect(workflow.start()).rejects.toThrow("Activity failed");

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        `[${mockActivity.name}] began execution`
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `[${mockActivity.name}] failed with error: Activity failed`
      );

      expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
        `[${mockActivity.name}] began execution`
      );
      expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
        `[${mockActivity.name}] failed with error: Activity failed`
      );
    });
  });
});
