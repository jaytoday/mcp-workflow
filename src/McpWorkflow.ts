import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpActivityTool } from './McpActivityTool.js';
import { WorkflowSessionManager } from './WorkflowSessionManager.js';
import {
  WorkflowConfig,
  WorkflowStatus,
  ActivityContext,
  WorkflowToolResponse,
  WorkflowSession,
  ToolCallSuggestion,
  ActivityResult,
} from './types.js';

/**
 * McpWorkflow orchestrates a sequence of McpActivityTool executions.
 * The workflow automatically registers itself as MCP tools when attached to a server,
 * coordinating the execution of multiple activity steps and managing state across tool calls.
 */
export class McpWorkflow {
  public readonly name: string;
  public readonly description: string;
  private readonly config: WorkflowConfig;
  private readonly activities: Map<string, McpActivityTool> = new Map();
  private readonly sessionManager: WorkflowSessionManager;
  private registered: boolean = false;

  constructor(
    name: string,
    description: string,
    config: WorkflowConfig,
    sessionManager?: WorkflowSessionManager
  ) {
    this.name = name;
    this.description = description;
    this.config = config;
    this.sessionManager = sessionManager || new WorkflowSessionManager();

    this.validateConfig();
    this.autoRegisterActivities();
  }

  /**
   * Validates the workflow configuration
   */
  private validateConfig(): void {
    if (!this.config.steps || this.config.steps.length === 0) {
      throw new Error('Workflow must have at least one step');
    }
  }

  /**
   * Automatically registers all activities from the workflow steps
   */
  private autoRegisterActivities(): void {
    for (const step of this.config.steps) {
      const activity = step.activity;
      if (!this.activities.has(activity.name)) {
        this.activities.set(activity.name, activity);
      }
    }
  }

  /**
   * Registers an activity tool that can be used in workflow steps
   * @deprecated Activities are now automatically registered from workflow steps
   */
  registerActivity(activity: McpActivityTool): void {
    this.activities.set(activity.name, activity);
  }

  /**
   * Attaches this workflow to an MCP server and automatically registers the workflow tools.
   * This will register two tools:
   * - `{workflow_name}_start`: Starts a new workflow execution
   * - `{workflow_name}_continue`: Continues an existing workflow session
   *
   * @param server - The MCP server instance to register tools with
   * @param options - Optional configuration for tool registration
   */
  attachToServer(
    server: McpServer,
    options?: {
      /** Custom title for the start tool */
      startToolTitle?: string;
      /** Custom title for the continue tool */
      continueToolTitle?: string;
      /** Whether to also register individual activities as standalone tools */
      registerActivities?: boolean;
    }
  ): void {
    if (this.registered) {
      throw new Error(
        `Workflow "${this.name}" is already registered with a server`
      );
    }

    this.registered = true;

    // Register the start tool
    const startToolName = `${this.name}_start`;
    server.registerTool(
      startToolName,
      {
        title: options?.startToolTitle || `Start ${this.name} Workflow`,
        description: this.description,
        inputSchema: this.getStartInputSchema(),
      },
      this.toMcpStartToolCallback()
    );

    // Register the continue tool
    const continueToolName = `${this.name}_continue`;
    server.registerTool(
      continueToolName,
      {
        title: options?.continueToolTitle || `Continue ${this.name} Workflow`,
        description: `Continues the ${this.name} workflow from a session`,
        inputSchema: this.getContinueInputSchema(),
      },
      this.toMcpContinueToolCallback()
    );

    // Optionally register individual activities as standalone tools
    if (options?.registerActivities) {
      for (const activity of this.activities.values()) {
        server.registerTool(
          activity.name,
          {
            title: activity.name,
            description: activity.description,
            inputSchema: activity.getInputSchema(),
            outputSchema: activity.getOutputSchema(),
          },
          activity.toMcpToolCallback()
        );
      }
    }
  }

  /**
   * Checks if this workflow has been attached to an MCP server
   */
  isRegistered(): boolean {
    return this.registered;
  }

  /**
   * Starts a new workflow execution
   */
  async start(input?: any): Promise<WorkflowToolResponse> {
    // Create a new session
    const session = this.sessionManager.createSession(
      this.name,
      this.config.steps.length
    );

    // Store initial input if provided
    if (input) {
      this.sessionManager.setMemory(
        session.sessionId,
        '__workflow_input__',
        input
      );
    }

    // Update status to running
    this.sessionManager.updateSession(session.sessionId, {
      status: WorkflowStatus.RUNNING,
    });

    // Execute the first step with the provided input
    return this.executeStep(session.sessionId, 0, input);
  }

  /**
   * Continues a workflow execution from a specific session
   */
  async continue(
    sessionId: string,
    stepInput?: any
  ): Promise<WorkflowToolResponse> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Workflow session ${sessionId} not found`);
    }

    if (session.status !== WorkflowStatus.RUNNING) {
      throw new Error(`Cannot continue workflow in status: ${session.status}`);
    }

    // Move to the next step
    const nextStepIndex = session.currentStep + 1;

    // Check if workflow is complete
    if (nextStepIndex >= this.config.steps.length) {
      return this.completeWorkflow(sessionId);
    }

    // Execute the next step with the provided input
    return this.executeStep(sessionId, nextStepIndex, stepInput);
  }

  /**
   * Evaluates branch patterns against activity result data
   */
  private matchBranchPattern(pattern: string, resultData: any): boolean {
    // Pattern format: "key:value" or "key.nested:value"
    const [path, expectedValue] = pattern.split(':');
    if (!path || expectedValue === undefined) return false;

    // Get the actual value from the result data
    const pathParts = path.split('.');
    let actualValue = resultData;
    for (const part of pathParts) {
      if (actualValue === undefined || actualValue === null) return false;
      actualValue = actualValue[part];
    }

    // Compare values (handle booleans and strings)
    const normalizedExpected = expectedValue.toLowerCase();
    const normalizedActual = String(actualValue).toLowerCase();

    return normalizedExpected === normalizedActual;
  }

  /**
   * Builds tool call suggestions from activity result and step configuration
   */
  private buildToolCallSuggestions(
    stepIndex: number,
    result: ActivityResult,
    sessionId: string,
    stepInput: any
  ): ToolCallSuggestion[] {
    const suggestions: ToolCallSuggestion[] = [];
    const step = this.config.steps[stepIndex];
    const isLastStep = stepIndex === this.config.steps.length - 1;
    const session = this.sessionManager.getSession(sessionId);
    const memory = session?.memory || new Map();

    // First, add suggestions from the activity result itself
    if (result.toolCallSuggestions && result.toolCallSuggestions.length > 0) {
      suggestions.push(...result.toolCallSuggestions);
    }

    // Then, evaluate branch definitions from step configuration
    if (step.branches && result.data) {
      // Check if branches is an array (new syntax) or object (legacy syntax)
      if (Array.isArray(step.branches)) {
        for (const branchConfig of step.branches) {
          if (branchConfig.when(result.data, stepInput, memory)) {
            const parameters = branchConfig.with
              ? branchConfig.with(result.data, stepInput, memory)
              : result.data;

            suggestions.push({
              toolName: branchConfig.call,
              parameters: {
                sessionId,
                ...parameters,
              },
              condition:
                branchConfig.description || `Branch: ${branchConfig.call}`,
              priority: 100, // High priority for matched branch patterns
            });
          }
        }
      } else {
        // Legacy pattern-matching syntax
        for (const [pattern, branchDef] of Object.entries(step.branches)) {
          if (this.matchBranchPattern(pattern, result.data)) {
            suggestions.push({
              toolName: branchDef.toolName,
              parameters: {
                sessionId,
                ...(branchDef.parameters || {}),
                ...result.data,
              },
              condition: `Branch condition: ${pattern}`,
              priority: 100, // High priority for matched branch patterns
              metadata: {
                branchPattern: pattern,
                continueWorkflow: branchDef.continueWorkflow,
              },
            });
          }
        }
      }
    }

    // Always add the default "continue" option if not the last step
    if (!isLastStep) {
      const continueExists = suggestions.some(
        (s) => s.toolName === `${this.name}_continue`
      );

      if (!continueExists) {
        suggestions.push({
          toolName: `${this.name}_continue`,
          parameters: {
            sessionId,
            ...result.data,
          },
          condition: 'Continue to next step in workflow',
          priority: 50, // Medium priority for default continuation
        });
      }
    }

    // Sort by priority (descending)
    return suggestions.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Executes a specific step in the workflow
   */
  private async executeStep(
    sessionId: string,
    stepIndex: number,
    stepInput?: any
  ): Promise<WorkflowToolResponse> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Workflow session ${sessionId} not found`);
    }

    const step = this.config.steps[stepIndex];
    if (!step) {
      throw new Error(`Step ${stepIndex} not found in workflow`);
    }

    // Update current step
    this.sessionManager.updateSession(sessionId, {
      currentStep: stepIndex,
    });

    // Check if step should be skipped based on condition
    if (step.condition) {
      const shouldRun = await step.condition(session.memory);
      if (!shouldRun) {
        // Skip this step and move to the next
        return this.continue(sessionId);
      }
    }

    // Get the activity for this step
    const activity = step.activity;
    if (!activity) {
      const error = `Activity not found for step ${stepIndex}`;
      await this.failWorkflow(sessionId, error);
      throw new Error(error);
    }

    try {
      // Prepare the activity context
      // Use the stepInput provided by the MCP client, or empty object as fallback
      const context: ActivityContext = {
        input: stepInput || {},
        sessionId,
        memory: session.memory,
        metadata: {
          workflowName: this.name,
          currentStep: stepIndex,
          totalSteps: this.config.steps.length,
          startedAt: session.startedAt,
        },
      };

      const startedAt = new Date();

      // Execute the activity
      const result = await activity.execute(context);

      const completedAt = new Date();

      // Record the execution
      this.sessionManager.recordStepExecution(
        sessionId,
        stepIndex,
        activity.name,
        startedAt,
        completedAt,
        result.success,
        result.error
      );

      // Store the result in memory
      this.sessionManager.setMemory(sessionId, activity.name, result.data);

      if (!result.success && !step.optional) {
        // If step failed and is not optional, fail the workflow
        await this.failWorkflow(
          sessionId,
          result.error || 'Activity failed without error message'
        );

        return {
          toolResult: {
            content: [
              {
                type: 'text',
                text: `Workflow failed at step ${stepIndex} (${activity.name}): ${result.error}`,
              },
            ],
            isError: true,
          },
          session: this.sessionManager.getSession(sessionId)!,
        };
      }

      // Determine next action
      const isLastStep = stepIndex === this.config.steps.length - 1;

      if (isLastStep) {
        // Complete the workflow
        return this.completeWorkflow(sessionId);
      } else {
        // Build all possible next step suggestions (including branches)
        const toolSuggestions = this.buildToolCallSuggestions(
          stepIndex,
          result,
          sessionId,
          stepInput
        );

        const nextStep = this.config.steps[stepIndex + 1];
        const updatedSession = this.sessionManager.getSession(sessionId)!;

        // Get the primary suggestion (highest priority)
        const primarySuggestion = toolSuggestions[0];

        return {
          toolResult: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message: `Step ${stepIndex} (${activity.name}) completed successfully`,
                  result: result.data,
                  nextStep: {
                    index: stepIndex + 1,
                    activity: nextStep.activity.name,
                  },
                  progress: {
                    current: stepIndex + 1,
                    total: this.config.steps.length,
                  },
                  branchOptions:
                    toolSuggestions.length > 1 ? toolSuggestions : undefined,
                }),
              },
            ],
            structuredContent: {
              stepResult: result.data,
              nextActivity: nextStep.activity.name,
              nextStepOptions: toolSuggestions,
            },
            _meta: {
              branchingEnabled: toolSuggestions.length > 1,
              suggestedNextTool: primarySuggestion?.toolName,
            },
          },
          session: updatedSession,
          // Keep single nextInstruction for backwards compatibility
          nextInstruction: primarySuggestion
            ? {
                toolName: primarySuggestion.toolName,
                parameters: primarySuggestion.parameters,
              }
            : {
                toolName: `${this.name}_continue`,
                parameters: {
                  sessionId,
                  ...result.data,
                },
              },
          // Include all suggestions for branching-aware clients
          nextInstructions: toolSuggestions,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.failWorkflow(sessionId, errorMessage);

      return {
        toolResult: {
          content: [
            {
              type: 'text',
              text: `Workflow failed at step ${stepIndex}: ${errorMessage}`,
            },
          ],
          isError: true,
        },
        session: this.sessionManager.getSession(sessionId)!,
      };
    }
  }

  /**
   * Completes the workflow successfully
   */
  private async completeWorkflow(
    sessionId: string
  ): Promise<WorkflowToolResponse> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Workflow session ${sessionId} not found`);
    }

    this.sessionManager.completeSession(sessionId, WorkflowStatus.COMPLETED);

    // Call the onSuccess callback if provided
    await this.config.onSuccess?.(session.memory, sessionId);

    // Call the onComplete callback if provided
    await this.config.onComplete?.(WorkflowStatus.COMPLETED, sessionId);

    const finalSession = this.sessionManager.getSession(sessionId)!;

    // Convert memory Map to plain object for serialization
    const memoryObject = Object.fromEntries(finalSession.memory);

    return {
      toolResult: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Workflow completed successfully',
              results: memoryObject,
              executionTime:
                finalSession.completedAt!.getTime() -
                finalSession.startedAt.getTime(),
            }),
          },
        ],
        structuredContent: {
          status: 'completed',
          results: memoryObject,
        },
      },
      session: finalSession,
    };
  }

  /**
   * Fails the workflow
   */
  private async failWorkflow(sessionId: string, error: string): Promise<void> {
    this.sessionManager.completeSession(
      sessionId,
      WorkflowStatus.FAILED,
      error
    );

    // Call the onFailure callback if provided
    await this.config.onFailure?.(new Error(error), sessionId);

    // Call the onComplete callback if provided
    await this.config.onComplete?.(WorkflowStatus.FAILED, sessionId);
  }

  /**
   * Cancels a workflow execution
   */
  async cancel(sessionId: string): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Workflow session ${sessionId} not found`);
    }

    this.sessionManager.completeSession(sessionId, WorkflowStatus.CANCELLED);

    // Call the onComplete callback if provided
    await this.config.onComplete?.(WorkflowStatus.CANCELLED, sessionId);
  }

  /**
   * Gets the current status of a workflow session
   */
  getSessionStatus(sessionId: string): WorkflowSession | undefined {
    return this.sessionManager.getSession(sessionId);
  }

  /**
   * Converts the workflow to an MCP tool callback that starts the workflow
   */
  toMcpStartToolCallback() {
    return async (args: any): Promise<CallToolResult> => {
      const response = await this.start(args);
      return response.toolResult;
    };
  }

  /**
   * Creates an MCP tool callback that continues the workflow
   */
  toMcpContinueToolCallback() {
    return async (args: any): Promise<CallToolResult> => {
      const { sessionId, ...stepInput } = args;
      // Pass all args except sessionId as the step input
      const inputData =
        Object.keys(stepInput).length > 0 ? stepInput : undefined;
      const response = await this.continue(sessionId, inputData);
      return response.toolResult;
    };
  }

  /**
   * Gets the input schema for the workflow start tool
   * Automatically uses the first activity's input schema
   */
  getStartInputSchema(): ZodRawShape {
    if (this.config.steps.length === 0) {
      return {};
    }

    const firstActivity = this.config.steps[0].activity;
    return firstActivity.getInputSchema();
  }

  /**
   * Gets the input schema for the workflow continue tool
   */
  getContinueInputSchema(): ZodRawShape {
    return {
      sessionId: z.string().describe('The session ID to continue'),
      // The rest of the input will be passed as step input
    };
  }
}
