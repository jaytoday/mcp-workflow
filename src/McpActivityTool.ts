import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodRawShape } from "zod";
import { ActivityConfig, ActivityContext, ActivityResult } from "./types.js";

/**
 * McpActivityTool wraps a single unit of work that can be executed as part of a workflow.
 * It provides lifecycle hooks (onSuccess, onFailure, onComplete) and automatic validation.
 */
export class McpActivityTool<
  TInputSchema extends ZodRawShape = any,
  TOutputSchema extends ZodRawShape = any
> {
  public readonly name: string;
  public readonly description: string;
  private readonly config: ActivityConfig<TInputSchema, TOutputSchema>;
  private readonly inputSchema?: z.ZodObject<TInputSchema>;
  private readonly outputSchema?: z.ZodObject<TOutputSchema>;

  constructor(
    name: string,
    description: string,
    config: ActivityConfig<TInputSchema, TOutputSchema>
  ) {
    this.name = name;
    this.description = description;
    this.config = config;

    // Convert raw schemas to Zod objects
    if (config.inputSchema) {
      this.inputSchema = z.object(config.inputSchema);
    }
    if (config.outputSchema) {
      this.outputSchema = z.object(config.outputSchema);
    }
  }

  /**
   * Executes the activity with the given context
   */
  async execute(context: ActivityContext): Promise<ActivityResult> {
    const startTime = Date.now();
    let result: ActivityResult;

    try {
      this.validateInput(context.input);

      result = await this.runActivity(context);

      // Default success to true if not explicitly set to false
      result.success = result.success !== false;

      this.validateOutput(result.data);

      await this.runPostExecutionCallbacks(result, context);
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      await this.config.callbacks.onFailure?.(result, context);
    } finally {
      await this.config.callbacks.onComplete?.(result!, context);
    }

    result!.metadata = {
      ...result!.metadata,
      executionTimeMs: Date.now() - startTime,
    };
    return result!;
  }

  private validateInput(input: any): void {
    if (this.inputSchema && input) {
      this.inputSchema.parse(input);
    }
  }

  private validateOutput(output: any): void {
    if (this.outputSchema && output) {
      this.outputSchema.parse(output);
    }
  }

  private async runActivity(context: ActivityContext): Promise<ActivityResult> {
    if (this.config.timeout) {
      return this.executeWithTimeout(context, this.config.timeout);
    }
    return this.config.callbacks.run(context);
  }

  private async runPostExecutionCallbacks(
    result: ActivityResult,
    context: ActivityContext
  ): Promise<void> {
    if (result.success) {
      await this.config.callbacks.onSuccess?.(result, context);
    } else {
      await this.config.callbacks.onFailure?.(result, context);
    }
  }

  /**
   * Executes the activity with a timeout
   */
  private async executeWithTimeout(
    context: ActivityContext,
    timeoutMs: number
  ): Promise<ActivityResult> {
    return Promise.race([
      this.config.callbacks.run(context),
      new Promise<ActivityResult>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Activity timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }

  /**
   * Executes the activity with retry logic
   */
  async executeWithRetry(context: ActivityContext): Promise<ActivityResult> {
    const retryConfig = this.config.retry;
    if (!retryConfig) {
      return this.execute(context);
    }

    let lastError: Error | undefined;
    let attempt = 0;

    while (attempt < retryConfig.maxAttempts) {
      try {
        const result = await this.execute(context);
        if (result.success) {
          return result;
        }
        lastError = new Error(result.error || "Activity failed");
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      attempt++;
      if (attempt < retryConfig.maxAttempts) {
        // Exponential backoff
        const backoff = retryConfig.backoffMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    return {
      success: false,
      error: `Activity failed after ${retryConfig.maxAttempts} attempts: ${lastError?.message}`,
    };
  }

  /**
   * Converts the activity to an MCP tool callback format
   */
  toMcpToolCallback() {
    return async (
      args: z.objectOutputType<TInputSchema, z.ZodTypeAny>
    ): Promise<CallToolResult> => {
      // This is called when registered as a standalone tool
      // For workflow usage, we'll use a different mechanism
      const context: ActivityContext = {
        input: args,
        sessionId: "standalone",
        memory: new Map(),
        metadata: {
          workflowName: "standalone",
          currentStep: 0,
          totalSteps: 1,
          startedAt: new Date(),
        },
      };

      const result = await this.execute(context);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
        structuredContent: result.data,
        isError: !result.success,
      };
    };
  }

  /**
   * Gets the input schema for MCP tool registration
   */
  getInputSchema(): TInputSchema | undefined {
    return this.config.inputSchema;
  }

  /**
   * Gets the output schema for MCP tool registration
   */
  getOutputSchema(): TOutputSchema | undefined {
    return this.config.outputSchema;
  }
}
