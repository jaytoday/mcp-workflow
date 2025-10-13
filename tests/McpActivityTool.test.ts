import { vi, describe, expect, test, beforeEach } from "vitest";
import { z } from "zod";
import { McpActivityTool } from "../src/McpActivityTool";
import { ActivityContext, ActivityResult } from "../src/types";

describe("McpActivityTool", () => {
  let context: ActivityContext;

  beforeEach(() => {
    context = {
      input: { data: "test" },
      sessionId: "test-session",
      memory: new Map(),
      metadata: {
        workflowName: "test-workflow",
        currentStep: 0,
        totalSteps: 1,
        startedAt: new Date(),
      },
    };
  });

  test("executes successfully", async () => {
    const run = vi.fn().mockResolvedValue({ success: true, data: "output" });
    const activity = new McpActivityTool("test-activity", "description", {
      callbacks: { run },
    });

    const result = await activity.execute(context);

    expect(run).toHaveBeenCalledWith(context);
    expect(result.success).toBe(true);
    expect(result.data).toBe("output");
  });

  test("handles execution failure", async () => {
    const run = vi.fn().mockRejectedValue(new Error("Failed"));
    const activity = new McpActivityTool("test-activity", "description", {
      callbacks: { run },
    });

    const result = await activity.execute(context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed");
  });

  test("validates input schema", async () => {
    const run = vi.fn();
    const activity = new McpActivityTool("test-activity", "description", {
      inputSchema: { data: z.string() },
      callbacks: { run },
    });

    await activity.execute({ ...context, input: { data: 123 } });
    expect(run).not.toHaveBeenCalled();
  });

  test("validates output schema", async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ success: true, data: { value: "invalid" } });
    const activity = new McpActivityTool("test-activity", "description", {
      outputSchema: { value: z.number() },
      callbacks: { run },
    });

    const result = await activity.execute(context);
    expect(result.success).toBe(false);
  });

  test("calls lifecycle hooks", async () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const onComplete = vi.fn();

    const activity = new McpActivityTool("test-activity", "description", {
      callbacks: {
        run: async () => ({ success: true }),
        onSuccess,
        onFailure,
        onComplete,
      },
    });

    await activity.execute(context);

    expect(onSuccess).toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });

  test("handles timeout", async () => {
    const activity = new McpActivityTool("test-activity", "description", {
      timeout: 10,
      callbacks: {
        run: () =>
          new Promise<ActivityResult>((resolve) =>
            setTimeout(() => resolve({ success: true }), 100)
          ),
      },
    });

    const result = await activity.execute(context);
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  test("retries on failure", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: "Attempt 1" })
      .mockResolvedValueOnce({ success: true });

    const activity = new McpActivityTool("test-activity", "description", {
      retry: { maxAttempts: 2, backoffMs: 10 },
      callbacks: { run },
    });

    const result = await activity.executeWithRetry(context);

    expect(run).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
  });

  test("toMcpToolCallback", async () => {
    const activity = new McpActivityTool("test-activity", "description", {
      callbacks: { run: async (ctx) => ({ success: true, data: ctx.input }) },
    });

    const mcpTool = activity.toMcpToolCallback();
    const result = await mcpTool({ test: "data" });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({ test: "data" });
  });
});
