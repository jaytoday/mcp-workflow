# MCP Workflow

An extension of the [Model Context Protocol (MCP) SDK](https://github.com/modelcontextprotocol/typescript-sdk) to enable MCP servers to function as workflow engines. Build complex, multi-step workflows with activities that have lifecycle hooks, automatic state management, and seamless integration with MCP tools.

# Installation

```
npm i @p0u4a/mcp-workflow
```

## Features

- **Activity Tools**: Wrap individual units of work with lifecycle hooks (onSuccess, onFailure, onComplete)
- **Workflow Orchestration**: Chain activities together into sequential workflows
- **State Management**: Automatic session management with shared memory across workflow steps
- **Validation**: Built-in input/output validation using Zod schemas
- **Error Handling**: Robust error handling with retry logic and optional steps
- **Conditional Execution**: Skip steps based on runtime conditions
- **Branching Workflows**: Activities can suggest multiple next steps, allowing for dynamic workflow paths.
- **Persistent Storage**: Pluggable storage layer for session persistence (default is in-memory).
- **MCP Integration**: Seamlessly register workflows as MCP tools

## Installation

```bash
npm install mcp-workflow @modelcontextprotocol/sdk zod
```

## Architecture

### High-Level Overview

The `mcp-workflow` library provides a structured way to define and execute complex, multi-step processes on top of the Model Context Protocol. It introduces the concepts of "Workflows" and "Activities" to orchestrate a series of tool calls, manage state, and handle errors.

```
┌─────────────────────────────────────────────────────────────┐
│                        MCP Client                            │
│                     (e.g., Gemini)                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ JSON-RPC
                         │
┌────────────────────────▼────────────────────────────────────┐
│                     MCP Server                               │
│                (with mcp-workflow)                           │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Workflow Tools                          │  │
│  │  • {workflow}_start                                  │  │
│  │  • {workflow}_continue                               │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │           McpWorkflow Instance                       │  │
│  │  • Orchestrates activity execution                   │  │
│  │  • Manages workflow state                            │  │
│  │  • Handles step transitions                          │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │      WorkflowSessionManager                          │  │
│  │  • Creates and tracks sessions                       │  │
│  │  • Manages workflow memory                           │  │
│  │  • Records execution history                         │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │       McpActivityTool Instances                      │  │
│  │  • Execute individual activities                     │  │
│  │  • Validate input/output                             │  │
│  │  • Trigger lifecycle hooks                           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

- **`McpWorkflow`**: The main class that orchestrates a workflow. It manages a sequence of "activities" and registers itself as a set of MCP tools (`_start` and `_continue`).
- **`McpActivityTool`**: Represents a single unit of work within a workflow. It has lifecycle hooks (`onSuccess`, `onFailure`, `onComplete`) and can be configured with input/output schemas, timeouts, and retries.
- **`WorkflowSessionManager`**: Manages the lifecycle of workflow sessions, including creation, retrieval, and updates. It uses a `WorkflowStore` for persistence.
- **`WorkflowStore`**: An abstract class that defines the interface for storing and retrieving workflow session data. This allows for plugging in different storage backends like Redis, PostgreSQL, etc.
- **`InMemoryWorkflowStore`**: The default, in-memory implementation of `WorkflowStore`. Good for development and testing, but data is lost on restart.

## How It Works

1.  **Define Activities**: Create `McpActivityTool` instances for each step in your process. Each activity encapsulates a specific task, with its own input/output validation, execution logic, and lifecycle callbacks.
2.  **Define a Workflow**: Create an `McpWorkflow` instance, providing a sequence of steps. Each step references an activity and can have its own configuration, such as input mapping, conditions for execution, and branching logic.
3.  **Attach to MCP Server**: The `McpWorkflow` instance is attached to your MCP server. This automatically registers two tools:
    - `{workflow_name}_start`: To begin a new workflow execution.
    - `{workflow_name}_continue`: To proceed to the next step in an ongoing workflow.
4.  **Execution Flow**:
    - An MCP client calls the `_start` tool, which creates a new workflow session and executes the first step.
    - The result of the step, along with suggestions for the next step (if any), is returned to the client.
    - The client then calls the `_continue` tool to execute the next step, and so on, until the workflow is complete.

## Quick Start

### 1. Create Activity Tools

Activity tools are individual units of work that can be executed independently or as part of a workflow.

```typescript
import { McpActivityTool } from "mcp-workflow";
import { z } from "zod";

const addActivity = new McpActivityTool("add", "Adds two numbers together", {
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
});
```

### 2. Create a Workflow

Workflows orchestrate multiple activities in sequence, managing state between steps.

```typescript
import { McpWorkflow } from "mcp-workflow";

const calculatorWorkflow = new McpWorkflow(
  "calculator",
  "A workflow that performs calculations",
  {
    steps: [
      {
        activity: addActivity,
      },
      {
        activity: multiplyActivity, // Assuming multiplyActivity is defined
        inputMapper: (data, memory) => ({
          a: memory.get("add")?.result, // Use output from 'add' activity
          b: 2,
        }),
      },
    ],
    onSuccess: async (memory, sessionId) => {
      console.log("Workflow completed!", Object.fromEntries(memory));
    },
  }
);
```

### 3. Register with MCP Server

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer(
  { name: "my-workflow-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Attach the workflow to the server
calculatorWorkflow.attachToServer(server);
```

## Advanced Features

### Branching Workflows

Activities can suggest multiple next steps, allowing for dynamic workflow paths.

```typescript
// In an activity's run callback
return {
  success: true,
  data: { some: "data" },
  toolCallSuggestions: [
    {
      toolName: "next_step_A",
      parameters: { a: 1 },
      condition: "If you want to do A",
    },
    {
      toolName: "next_step_B",
      parameters: { b: 2 },
      condition: "If you want to do B",
    },
  ],
};
```

### Persistent Storage

You can provide your own storage implementation by extending `WorkflowStore` and passing it to the `WorkflowSessionManager`.

```typescript
import {
  WorkflowStore,
  WorkflowSessionManager,
  McpWorkflow,
} from "mcp-workflow";

// 1. Implement your custom store
class MyCustomStore extends WorkflowStore {
  // ... implement abstract methods
}

// 2. Pass it to the session manager
const myStore = new MyCustomStore();
const sessionManager = new WorkflowSessionManager({ store: myStore });

// 3. Use the session manager in your workflow
const workflow = new McpWorkflow("my-workflow", "...", {}, sessionManager);
```

## API Reference

The public API is exposed through the main `index.ts` file and includes:

- `McpWorkflow`
- `McpActivityTool`
- `WorkflowSessionManager`
- `WorkflowStore`
- `InMemoryWorkflowStore`
- And all related types and interfaces.

## Examples

See the [examples](./examples) directory for complete working examples.

## Contributing

Contributions are welcome! Please open an issue or pull request on GitHub.
