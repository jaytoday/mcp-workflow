# MCP Workflow

A TypeScript library that wraps the [Model Context Protocol (MCP) SDK](https://github.com/modelcontextprotocol/typescript-sdk) to enable MCP servers to function as workflow engines. Build complex, multi-step workflows with activities that have lifecycle hooks, automatic state management, and seamless integration with MCP tools.

## Features

- **Activity Tools**: Wrap individual units of work with lifecycle hooks (onSuccess, onFailure, onComplete)
- **Workflow Orchestration**: Chain activities together into sequential workflows
- **State Management**: Automatic session management with shared memory across workflow steps
- **Validation**: Built-in input/output validation using Zod schemas
- **Error Handling**: Robust error handling with retry logic and optional steps
- **Conditional Execution**: Skip steps based on runtime conditions
- **MCP Integration**: Seamlessly register workflows as MCP tools

## Installation

```bash
npm install mcp-workflow @modelcontextprotocol/sdk zod
```

## Quick Start

### 1. Create Activity Tools

Activity tools are individual units of work that can be executed independently or as part of a workflow.

```typescript
import { McpActivityTool } from 'mcp-workflow';
import { z } from 'zod';

const addActivity = new McpActivityTool(
  'add',
  'Adds two numbers together',
  {
    inputSchema: {
      a: z.number(),
      b: z.number(),
    },
    outputSchema: {
      result: z.number(),
    },
    callbacks: {
      run: async (context) => {
        const { a, b } = context.input;
        return {
          success: true,
          data: { result: a + b },
        };
      },
      onSuccess: async (result, context) => {
        console.log(`Addition succeeded: ${result.data?.result}`);
      },
      onFailure: async (result, context) => {
        console.error(`Addition failed: ${result.error}`);
      },
    },
  }
);
```

### 2. Create a Workflow

Workflows orchestrate multiple activities in sequence, managing state between steps.

```typescript
import { McpWorkflow } from 'mcp-workflow';

const calculatorWorkflow = new McpWorkflow(
  'calculator',
  'A workflow that performs calculations',
  {
    steps: [
      {
        activityName: 'add',
        input: {}, // Input provided at workflow start
      },
      {
        activityName: 'multiply',
        input: {
          factor: 2,
        },
      },
    ],
    onSuccess: async (memory, sessionId) => {
      console.log('Workflow completed!', Object.fromEntries(memory));
    },
  }
);

// Register activities with the workflow
calculatorWorkflow.registerActivity(addActivity);
calculatorWorkflow.registerActivity(multiplyActivity);
```

### 3. Register with MCP Server

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const server = new McpServer(
  { name: 'my-workflow-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Register workflow as MCP tools
server.registerTool(
  'calculator_start',
  {
    title: 'Start Calculator Workflow',
    description: 'Starts the calculator workflow',
    inputSchema: { a: z.number(), b: z.number() },
  },
  calculatorWorkflow.toMcpStartToolCallback()
);

server.registerTool(
  'calculator_continue',
  {
    title: 'Continue Calculator Workflow',
    description: 'Continues the calculator workflow',
    inputSchema: calculatorWorkflow.getContinueInputSchema(),
  },
  calculatorWorkflow.toMcpContinueToolCallback()
);
```

## Core Concepts

### McpActivityTool

An activity tool represents a single unit of work with:

- **Input/Output Schemas**: Zod schemas for validation
- **Lifecycle Hooks**:
  - `run`: Main execution function (required)
  - `onSuccess`: Called when the activity succeeds
  - `onFailure`: Called when the activity fails
  - `onComplete`: Called after success or failure
- **Timeout**: Optional execution timeout
- **Retry Logic**: Automatic retry with exponential backoff

```typescript
const activity = new McpActivityTool('name', 'description', {
  inputSchema: { /* Zod schema */ },
  outputSchema: { /* Zod schema */ },
  callbacks: {
    run: async (context) => {
      // Access context.input, context.memory, context.metadata
      return { success: true, data: { /* result */ } };
    },
    onSuccess: async (result, context) => { /* ... */ },
    onFailure: async (result, context) => { /* ... */ },
    onComplete: async (result, context) => { /* ... */ },
  },
  timeout: 5000, // 5 seconds
  retry: {
    maxAttempts: 3,
    backoffMs: 1000,
  },
});
```

### McpWorkflow

A workflow orchestrates multiple activities:

- **Steps**: Sequential list of activities to execute
- **Memory**: Shared state passed between steps
- **Conditional Steps**: Skip steps based on runtime conditions
- **Optional Steps**: Steps that won't fail the workflow if they error
- **Session Management**: Automatic tracking of workflow execution state

```typescript
const workflow = new McpWorkflow('name', 'description', {
  steps: [
    {
      activityName: 'step1',
      input: { /* ... */ },
    },
    {
      activityName: 'step2',
      input: { /* ... */ },
      optional: true, // Won't fail workflow on error
      condition: async (memory) => {
        // Return true to run, false to skip
        return memory.get('step1')?.someValue === true;
      },
    },
  ],
  timeout: 30000, // Total workflow timeout
  onSuccess: async (memory, sessionId) => { /* ... */ },
  onFailure: async (error, sessionId) => { /* ... */ },
  onComplete: async (status, sessionId) => { /* ... */ },
});
```

### WorkflowSessionManager

Manages workflow sessions across executions:

- **Session Tracking**: Maintains state for all active workflows
- **Memory Management**: Stores intermediate results
- **Session Lifecycle**: Automatic cleanup of old sessions
- **Statistics**: Query session status and statistics

```typescript
import { WorkflowSessionManager } from 'mcp-workflow';

const sessionManager = new WorkflowSessionManager({
  maxSessions: 1000,
  sessionTTLMs: 3600000, // 1 hour
});

// Pass to workflow constructor
const workflow = new McpWorkflow('name', 'description', config, sessionManager);

// Query session status
const session = workflow.getSessionStatus(sessionId);

// Get statistics
const stats = sessionManager.getStats();
```

## Advanced Features

### Accessing Workflow Memory

Activities can access data from previous steps through the context:

```typescript
callbacks: {
  run: async (context) => {
    // Access previous step results
    const previousResult = context.memory.get('previous_activity');

    // Access workflow metadata
    const { workflowName, currentStep, totalSteps } = context.metadata;

    return { success: true, data: { /* ... */ } };
  },
}
```

### Conditional Step Execution

Skip steps based on runtime conditions:

```typescript
{
  steps: [
    {
      activityName: 'validate',
      input: { /* ... */ },
    },
    {
      activityName: 'process',
      input: { /* ... */ },
      // Only run if validation passed
      condition: async (memory) => {
        const validation = memory.get('validate');
        return validation?.valid === true;
      },
    },
  ],
}
```

### Retry Logic

Automatically retry failed activities:

```typescript
const activity = new McpActivityTool('name', 'description', {
  // ...
  retry: {
    maxAttempts: 3,
    backoffMs: 1000, // Exponential backoff: 1s, 2s, 4s
  },
});
```

### Timeout Configuration

Set timeouts at activity or workflow level:

```typescript
// Activity timeout
const activity = new McpActivityTool('name', 'description', {
  // ...
  timeout: 5000, // 5 seconds
});

// Workflow timeout
const workflow = new McpWorkflow('name', 'description', {
  steps: [/* ... */],
  timeout: 30000, // 30 seconds total
});
```

## How It Works

### Workflow Execution Flow

1. **Start**: Client calls the workflow start tool
   - Creates a new workflow session
   - Initializes session memory
   - Executes the first step
   - Returns instructions for the next step

2. **Continue**: Client calls the workflow continue tool
   - Retrieves the session
   - Stores result from previous step in memory
   - Executes the next step
   - Returns instructions or completion status

3. **Complete**: All steps executed
   - Calls onSuccess/onFailure callbacks
   - Marks session as complete
   - Returns final results

### MCP Tool Registration

The workflow creates two MCP tools:

- **`{workflow_name}_start`**: Initiates a new workflow execution
- **`{workflow_name}_continue`**: Continues an existing workflow session

The MCP client (e.g., Claude) will:
1. Call the start tool to begin the workflow
2. Receive instructions to call the next activity
3. Call the continue tool with the session ID and results
4. Repeat until the workflow completes

## Examples

See the [examples](./examples) directory for complete working examples:

- **[basic-workflow.ts](./examples/basic-workflow.ts)**: Simple calculator workflow
- **[advanced-workflow.ts](./examples/advanced-workflow.ts)**: Data processing with conditional steps, retries, and error handling

### Running Examples

```bash
# Build the library
npm run build

# Run the basic example
node examples/basic-workflow.ts

# Run the advanced example
node examples/advanced-workflow.ts
```

## API Reference

### McpActivityTool

```typescript
class McpActivityTool<TInputSchema, TOutputSchema> {
  constructor(
    name: string,
    description: string,
    config: ActivityConfig<TInputSchema, TOutputSchema>
  );

  execute(context: ActivityContext): Promise<ActivityResult>;
  executeWithRetry(context: ActivityContext): Promise<ActivityResult>;
  toMcpToolCallback(): ToolCallback;
  getInputSchema(): TInputSchema | undefined;
  getOutputSchema(): TOutputSchema | undefined;
}
```

### McpWorkflow

```typescript
class McpWorkflow {
  constructor(
    name: string,
    description: string,
    config: WorkflowConfig,
    sessionManager?: WorkflowSessionManager
  );

  registerActivity(activity: McpActivityTool): void;
  start(input?: any): Promise<WorkflowToolResponse>;
  continue(sessionId: string, stepResult?: any): Promise<WorkflowToolResponse>;
  cancel(sessionId: string): Promise<void>;
  getSessionStatus(sessionId: string): WorkflowSession | undefined;
  toMcpStartToolCallback(): ToolCallback;
  toMcpContinueToolCallback(): ToolCallback;
}
```

### WorkflowSessionManager

```typescript
class WorkflowSessionManager {
  constructor(options?: {
    maxSessions?: number;
    sessionTTLMs?: number;
  });

  createSession(workflowName: string, totalSteps: number): WorkflowSession;
  getSession(sessionId: string): WorkflowSession | undefined;
  updateSession(sessionId: string, updates: Partial<WorkflowSession>): void;
  setMemory(sessionId: string, key: string, value: any): void;
  getMemory(sessionId: string, key: string): any;
  deleteSession(sessionId: string): boolean;
  cleanup(): void;
  getStats(): SessionStats;
}
```

## TypeScript Support

This library is written in TypeScript and includes full type definitions. All types are exported for use in your applications.

## License

ISC

## Contributing

Contributions are welcome! Please open an issue or pull request on GitHub.

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
