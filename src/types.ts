import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodRawShape } from "zod";
import type { McpActivityTool } from "./McpActivityTool.js";

/**
 * The execution context passed to activity callbacks
 */
export interface ActivityContext<TInput = any> {
  /** The input parameters for this activity */
  input: TInput;
  /** The workflow session ID */
  sessionId: string;
  /** Data stored from previous activities in the workflow */
  memory: Map<string, any>;
  /** Metadata about the current workflow execution */
  metadata: {
    workflowName: string;
    currentStep: number;
    totalSteps: number;
    startedAt: Date;
  };
}

/**
 * Suggestion for the next tool to call, enabling workflow branching
 */
export interface ToolCallSuggestion {
  /** Name of the tool to call */
  toolName: string;
  /** Parameters to pass to the tool */
  parameters: Record<string, any>;
  /** Human-readable description of when/why to use this branch */
  condition?: string;
  /** Priority for ranking multiple options (higher = more preferred) */
  priority?: number;
  /** Metadata about this suggestion */
  metadata?: Record<string, any>;
}

/**
 * The result returned from an activity execution
 */
export interface ActivityResult<TOutput = any> {
  /**
   * Whether the activity succeeded.
   * If not provided, it will be considered `true` unless an error is thrown.
   */
  success?: boolean;
  /** The output data from the activity */
  data?: TOutput;
  /** Error message if the activity failed */
  error?: string;
  /** Additional metadata about the execution */
  metadata?: Record<string, any>;
  /** Suggestions for next tools to call, enabling branching workflows */
  toolCallSuggestions?: ToolCallSuggestion[];
}

/**
 * Lifecycle callbacks for an activity
 */
export interface ActivityCallbacks<TInput = any, TOutput = any> {
  /** Main execution function for the activity */
  run: (context: ActivityContext<TInput>) => Promise<ActivityResult<TOutput>>;
  /** Called when the activity succeeds */
  onSuccess?: (
    result: ActivityResult<TOutput>,
    context: ActivityContext<TInput>
  ) => Promise<void> | void;
  /** Called when the activity fails */
  onFailure?: (
    result: ActivityResult<TOutput>,
    context: ActivityContext<TInput>
  ) => Promise<void> | void;
  /** Called when the activity completes (success or failure) */
  onComplete?: (
    result: ActivityResult<TOutput>,
    context: ActivityContext<TInput>
  ) => Promise<void> | void;
}

/**
 * Configuration for creating an activity tool
 */
export interface ActivityConfig<
  TInputSchema extends ZodRawShape = any,
  TOutputSchema extends ZodRawShape = any
> {
  /** Zod schema for input validation */
  inputSchema?: TInputSchema;
  /** Zod schema for output validation */
  outputSchema?: TOutputSchema;
  /** Activity lifecycle callbacks */
  callbacks: ActivityCallbacks<
    z.objectOutputType<TInputSchema, z.ZodTypeAny>,
    z.objectOutputType<TOutputSchema, z.ZodTypeAny>
  >;
  /** Optional timeout in milliseconds */
  timeout?: number;
  /** Optional retry configuration */
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
}

/**
 * Status of a workflow execution
 */
export enum WorkflowStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

/**
 * Function-based branch configuration for cleaner conditional logic
 */
export interface BranchConfig {
  /** Condition function to determine if this branch should be taken */
  when: (result: any, input: any, memory: Map<string, any>) => boolean;
  /** Name of the tool to call if condition matches */
  call: string;
  /** Optional function to compute parameters for the tool call */
  with?: (
    result: any,
    input: any,
    memory: Map<string, any>
  ) => Record<string, any>;
  /** Human-readable description of this branch */
  description?: string;
}

/**
 * A step in a workflow execution
 */
export interface WorkflowStep {
  /** The activity tool to execute */
  activity: McpActivityTool;
  /** Whether this step is optional */
  optional?: boolean;
  /** Condition to determine if this step should run */
  condition?: (memory: Map<string, any>) => boolean | Promise<boolean>;
  /** Branch definitions based on activity result patterns */
  branches?: BranchConfig[];
  /** Optional function to map input data for the activity */
  inputMapper?: (data: any, memory: Map<string, any>) => any;
}

/**
 * Configuration for a workflow
 */
export interface WorkflowConfig {
  /** The steps to execute in order */
  steps: WorkflowStep[];
  /** Maximum time for the entire workflow in milliseconds */
  timeout?: number;
  /** Called when the workflow completes successfully */
  onSuccess?: (
    memory: Map<string, any>,
    sessionId: string
  ) => Promise<void> | void;
  /** Called when the workflow fails */
  onFailure?: (error: Error, sessionId: string) => Promise<void> | void;
  /** Called when the workflow completes (success or failure) */
  onComplete?: (
    status: WorkflowStatus,
    sessionId: string
  ) => Promise<void> | void;
}

/**
 * Current state of a workflow session
 */
export interface WorkflowSession {
  /** Unique session identifier */
  sessionId: string;
  /** Name of the workflow */
  workflowName: string;
  /** Current status */
  status: WorkflowStatus;
  /** Current step index */
  currentStep: number;
  /** Total number of steps */
  totalSteps: number;
  /** Shared memory for the workflow */
  memory: Map<string, any>;
  /** When the workflow started */
  startedAt: Date;
  /** When the workflow completed */
  completedAt?: Date;
  /** Error information if failed */
  error?: string;
  /** History of executed steps */
  history: Array<{
    stepIndex: number;
    activityName: string;
    startedAt: Date;
    completedAt: Date;
    success: boolean;
    error?: string;
    /** Branch options that were available at this step */
    branchOptions?: ToolCallSuggestion[];
  }>;
  /** History of branches taken during execution */
  branchHistory?: Array<{
    stepIndex: number;
    branchPattern?: string;
    toolName: string;
    timestamp: Date;
  }>;
}

/**
 * Response format for workflow tool calls
 */
export interface WorkflowToolResponse {
  /** The MCP tool result to return to the client */
  toolResult: CallToolResult;
  /** The current workflow session state */
  session: WorkflowSession;
  /** All available next step options (for branching workflows) */
  nextInstructions?: ToolCallSuggestion[];
}
