import { vi, describe, expect, test } from "vitest";
import { McpActivityTool, McpWorkflow, WorkflowSessionManager } from "../src";

vi.mock("../src/McpActivityTool", () => ({
  McpActivityTool: vi.fn(),
}));

describe("McpWorkflow", () => {
  test("Workflow starts new session when ran", async () => {
    const sessionStorage = new WorkflowSessionManager();
    const createSessionSpy = vi.spyOn(sessionStorage, "createSession");
    const workflow = new McpWorkflow(
      "test",
      "test workflow",
      {
        steps: [
          {
            activity: new McpActivityTool("test_activity", "test activity", {
              callbacks: {
                run: vi.fn(),
              },
            }),
          },
        ],
      },
      sessionStorage
    );

    await workflow.start();

    expect(createSessionSpy).toHaveBeenCalledExactlyOnceWith("test", 1);
  });
});
