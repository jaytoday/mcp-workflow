# Architecture Overview

This document describes the architecture and design of the mcp-workflow library.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        MCP Client                            │
│                     (e.g., Claude)                           │
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

## Component Breakdown

### 1. McpActivityTool

**Purpose**: Represents a single unit of work with validation and lifecycle hooks.

**Responsibilities**:
- Execute the main activity logic
- Validate input against Zod schema
- Validate output against Zod schema
- Trigger lifecycle hooks (onSuccess, onFailure, onComplete)
- Handle timeouts
- Implement retry logic with exponential backoff

**Key Methods**:
- `execute(context)`: Runs the activity
- `executeWithRetry(context)`: Runs with retry logic
- `toMcpToolCallback()`: Converts to standalone MCP tool

**State**: Stateless - all state is passed via context

### 2. McpWorkflow

**Purpose**: Orchestrates a sequence of activities into a workflow.

**Responsibilities**:
- Register activities
- Start new workflow executions
- Continue existing workflow executions
- Execute individual workflow steps
- Manage step transitions
- Handle conditional steps
- Handle optional steps
- Trigger workflow-level callbacks

**Key Methods**:
- `registerActivity(activity)`: Register an activity
- `start(input)`: Begin workflow execution
- `continue(sessionId, result)`: Continue execution
- `executeStep(sessionId, stepIndex)`: Execute a specific step
- `completeWorkflow(sessionId)`: Complete successfully
- `failWorkflow(sessionId, error)`: Fail workflow

**State**: Uses WorkflowSessionManager for persistence

### 3. WorkflowSessionManager

**Purpose**: Manages workflow sessions and their state.

**Responsibilities**:
- Create new sessions
- Store and retrieve sessions
- Manage session memory (shared state)
- Record execution history
- Clean up old sessions
- Provide session statistics

**Key Methods**:
- `createSession(name, steps)`: Create new session
- `getSession(id)`: Retrieve session
- `updateSession(id, updates)`: Update session
- `setMemory(id, key, value)`: Store in memory
- `getMemory(id, key)`: Retrieve from memory
- `cleanup()`: Clean old sessions

**State**: In-memory Map of sessions (could be extended to use Redis, etc.)

## Execution Flow

### Starting a Workflow

```
1. Client calls {workflow}_start tool
   ↓
2. McpWorkflow.start(input) is invoked
   ↓
3. WorkflowSessionManager.createSession() creates a new session
   ↓
4. Initial input is stored in session memory
   ↓
5. McpWorkflow.executeStep(sessionId, 0) runs first step
   ↓
6. Corresponding McpActivityTool is retrieved
   ↓
7. Activity context is prepared with:
   - Input from step config
   - Session ID
   - Workflow memory
   - Metadata
   ↓
8. McpActivityTool.execute(context) runs the activity
   ↓
9. Result is stored in session memory
   ↓
10. If more steps: Return instruction for next tool call
    If complete: Return final results
```

### Continuing a Workflow

```
1. Client calls {workflow}_continue tool with sessionId
   ↓
2. McpWorkflow.continue(sessionId, result) is invoked
   ↓
3. Session is retrieved from WorkflowSessionManager
   ↓
4. Previous step result is stored in memory
   ↓
5. Current step index is incremented
   ↓
6. Check if workflow is complete
   ↓
7. If not complete:
   - Execute next step (see step 5-10 above)
   ↓
8. If complete:
   - Call onSuccess callback
   - Mark session as completed
   - Return final results
```

## Data Flow

### Activity Context

```typescript
{
  input: any,              // Input for this activity
  sessionId: string,       // Unique session ID
  memory: Map<string, any>, // Shared workflow memory
  metadata: {
    workflowName: string,
    currentStep: number,
    totalSteps: number,
    startedAt: Date
  }
}
```

### Activity Result

```typescript
{
  success: boolean,    // Whether activity succeeded
  data?: any,          // Output data (if success)
  error?: string,      // Error message (if failure)
  metadata?: {         // Additional metadata
    executionTimeMs: number,
    // ... custom fields
  }
}
```

### Workflow Session

```typescript
{
  sessionId: string,
  workflowName: string,
  status: WorkflowStatus,
  currentStep: number,
  totalSteps: number,
  memory: Map<string, any>,
  startedAt: Date,
  completedAt?: Date,
  error?: string,
  history: StepExecution[]
}
```

## Memory Management

### Workflow Memory

The workflow memory is a `Map<string, any>` that persists across steps:

1. **Initial Input**: Stored as `__workflow_input__`
2. **Activity Results**: Stored by activity name (e.g., `"add"`, `"multiply"`)
3. **Custom Data**: Activities can store additional data

### Memory Access Pattern

```typescript
// In activity callback
run: async (context) => {
  // Read from previous steps
  const previousResult = context.memory.get('previous_activity');

  // Perform computation
  const result = doSomething(previousResult);

  // Return data (automatically stored by workflow)
  return { success: true, data: result };
}
```

## Lifecycle Hooks

### Activity-Level Hooks

```
execute()
   │
   ├─► run() ────────────────┐
   │                          │
   │                    [Success?]
   │                          │
   │              ┌───────────┴────────────┐
   │              │                        │
   │           [Yes]                     [No]
   │              │                        │
   │              ▼                        ▼
   │        onSuccess()              onFailure()
   │              │                        │
   │              └───────────┬────────────┘
   │                          │
   └─────────► onComplete() ◄─┘
```

### Workflow-Level Hooks

```
Workflow Execution
   │
   ├─► [Execute all steps] ──┐
   │                          │
   │                    [All succeeded?]
   │                          │
   │              ┌───────────┴────────────┐
   │              │                        │
   │           [Yes]                     [No]
   │              │                        │
   │              ▼                        ▼
   │        onSuccess()              onFailure()
   │              │                        │
   │              └───────────┬────────────┘
   │                          │
   └─────────► onComplete() ◄─┘
```

## Error Handling

### Activity Failures

1. **Immediate Failure**: Activity returns `{ success: false }`
   - `onFailure` hook is called
   - Error is stored in result
   - Workflow checks if step is optional

2. **Exception Thrown**: Unhandled error in activity
   - Caught by McpActivityTool.execute()
   - Converted to failure result
   - `onFailure` hook is called

3. **Timeout**: Activity exceeds timeout
   - Promise.race rejects
   - Treated as exception (see #2)

4. **Retry Logic**: If configured
   - Activity is retried up to maxAttempts
   - Exponential backoff between attempts
   - Last failure is returned if all attempts fail

### Workflow Failures

1. **Required Step Fails**: Step is not optional
   - Workflow fails immediately
   - `onFailure` callback is invoked
   - Session is marked as FAILED
   - Error is stored in session

2. **Optional Step Fails**: Step has `optional: true`
   - Failure is logged
   - Workflow continues to next step
   - No workflow failure

3. **Workflow Timeout**: Entire workflow exceeds timeout
   - Workflow is marked as FAILED
   - Current activity may be incomplete
   - `onFailure` callback is invoked

## Extension Points

### Custom Session Storage

Replace in-memory storage with persistent storage:

```typescript
class RedisSessionManager extends WorkflowSessionManager {
  // Override methods to use Redis
  async createSession(...) { /* ... */ }
  async getSession(...) { /* ... */ }
  async updateSession(...) { /* ... */ }
}
```

### Custom Activity Types

Extend McpActivityTool for specific use cases:

```typescript
class HttpActivityTool extends McpActivityTool {
  constructor(url: string, method: string, ...) {
    super(name, description, {
      callbacks: {
        run: async (context) => {
          // HTTP request logic
        }
      }
    });
  }
}
```

### Workflow Middleware

Add middleware to intercept workflow execution:

```typescript
class McpWorkflowWithMiddleware extends McpWorkflow {
  private middleware: ((context) => Promise<void>)[] = [];

  use(fn: (context) => Promise<void>) {
    this.middleware.push(fn);
  }

  async executeStep(...) {
    for (const fn of this.middleware) {
      await fn(context);
    }
    return super.executeStep(...);
  }
}
```

## Design Decisions

### Why Separate Tools for Start/Continue?

- **Stateful Execution**: Workflows need to maintain state between steps
- **Client Control**: Allows client to control execution pace
- **Transparency**: Client can see progress at each step
- **Debugging**: Easier to debug individual steps
- **Interruption**: Allows pausing/resuming workflows

### Why In-Memory Sessions?

- **Simplicity**: Easy to use out of the box
- **Performance**: Fast access to session data
- **Extensibility**: Can be replaced with persistent storage
- **Development**: Good for development and testing

### Why Lifecycle Hooks?

- **Observability**: Track what's happening in activities
- **Side Effects**: Perform logging, metrics, notifications
- **Error Recovery**: Implement custom error handling
- **Flexibility**: Customize behavior without changing core logic

### Why Zod for Validation?

- **Type Safety**: TypeScript types derived from schemas
- **Runtime Validation**: Catch errors at runtime
- **Error Messages**: Clear, descriptive validation errors
- **MCP Integration**: MCP SDK uses Zod for schemas
- **Ecosystem**: Large ecosystem of Zod utilities

## Performance Considerations

### Memory Usage

- Sessions stored in-memory grow with workflow executions
- Automatic cleanup based on age and status
- Configurable max sessions limit
- Consider persistent storage for high-volume scenarios

### Execution Speed

- Activities execute sequentially (not parallel)
- Each step requires a separate tool call
- Network overhead between client and server
- Consider batching steps for high-throughput needs

### Scalability

- Current implementation is single-process
- For distributed systems, use persistent session storage
- Consider message queues for workflow steps
- Horizontal scaling requires session sharing

## Branching Workflows

### Overview

The library now supports **branching workflows**, allowing activities to suggest multiple next steps based on their results. This enables dynamic workflow paths and conditional execution.

### How Branching Works

1. **Activity Tool Suggestions**: Activities can return `toolCallSuggestions` in their result
2. **Branch Definitions**: Workflow steps can define `branches` based on result patterns
3. **MCP Client Choice**: The MCP client receives all options and decides which to execute
4. **Branch History**: All branch decisions are recorded in session history

### Branch Pattern Matching

Patterns follow the format `key:value` or `key.nested:value`:

```typescript
branches: {
  'valid:true': { toolName: 'continue_workflow' },
  'valid:false': { toolName: 'error_handler_start' },
  'status.code:approved': { toolName: 'approval_workflow_start' }
}
```

### Activity-Based Suggestions

Activities can return multiple tool suggestions:

```typescript
return {
  success: true,
  data: { valid: false, errors: ['Invalid email'] },
  toolCallSuggestions: [
    {
      toolName: 'error_correction_start',
      parameters: { errors: ['Invalid email'] },
      condition: 'Auto-correct errors',
      priority: 100
    },
    {
      toolName: 'manual_review_start',
      parameters: { data: context.input },
      condition: 'Send to manual review',
      priority: 50
    }
  ]
};
```

### CallToolResult Structure

Branch suggestions are included in the tool result:

```typescript
{
  content: [...],
  structuredContent: {
    stepResult: data,
    nextStepOptions: [
      { toolName: "workflow_continue", parameters: {...}, priority: 100 },
      { toolName: "error_handler", parameters: {...}, priority: 50 }
    ]
  },
  _meta: {
    branchingEnabled: true,
    suggestedNextTool: "workflow_continue"
  }
}
```

## Persistent Storage

### Storage Architecture

The library uses a **pluggable storage layer** via the `WorkflowStore` abstract class:

```
┌─────────────────────────────────────────┐
│     WorkflowSessionManager              │
│  (Orchestrates session lifecycle)       │
└────────────────┬────────────────────────┘
                 │
                 │ uses
                 │
┌────────────────▼────────────────────────┐
│         WorkflowStore                   │
│      (Abstract Interface)               │
└────────────────┬────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
┌───────▼──────┐  ┌──────▼──────────┐
│ InMemoryStore│  │  CustomStore    │
│  (Default)   │  │  (Redis/SQL/etc)│
└──────────────┘  └─────────────────┘
```

### Implementing Custom Stores

Create a class extending `WorkflowStore`:

```typescript
import { WorkflowStore } from 'mcp-workflow';

export class PostgreSQLWorkflowStore extends WorkflowStore {
  private pool: Pool;

  constructor(connectionString: string) {
    super();
    this.pool = new Pool({ connectionString });
  }

  async createSession(session: WorkflowSession): Promise<WorkflowSession> {
    // Serialize and insert into PostgreSQL
    await this.pool.query(
      'INSERT INTO workflow_sessions (id, data) VALUES ($1, $2)',
      [session.sessionId, JSON.stringify(session)]
    );
    return session;
  }

  async getSession(sessionId: string): Promise<WorkflowSession | undefined> {
    const result = await this.pool.query(
      'SELECT data FROM workflow_sessions WHERE id = $1',
      [sessionId]
    );
    return result.rows[0] ? JSON.parse(result.rows[0].data) : undefined;
  }

  // Implement other methods...
}
```

### Using Custom Stores

Pass your store to the `WorkflowSessionManager`:

```typescript
const store = new PostgreSQLWorkflowStore('postgresql://...');
const sessionManager = new WorkflowSessionManager({
  store,
  maxSessions: 1000,
  sessionTTLMs: 3600000
});

const workflow = new McpWorkflow('my_workflow', 'description', config, sessionManager);
```

### Built-in Store: InMemoryWorkflowStore

- **Default**: Used when no store is specified
- **Fast**: All operations are in-memory
- **Volatile**: Data lost on restart
- **Good for**: Development, testing, low-volume production

### Store Interface

All stores must implement:

- `createSession()`: Create new session
- `getSession()`: Retrieve session
- `updateSession()`: Update session
- `deleteSession()`: Delete session
- `listSessions()`: Query sessions
- `getStats()`: Get statistics
- `cleanup()`: Clean old sessions
- `setMemory()` / `getMemory()`: Session memory operations
- `recordStepExecution()`: Record step in history
- `recordBranchDecision()`: Record branch decisions
- `close()`: Cleanup resources

## Future Enhancements

Possible future features:

1. **Parallel Step Execution**: Execute multiple steps concurrently
2. **Subworkflows**: Nest workflows within workflows
3. **Event-Driven**: Trigger steps based on events
4. **More Store Implementations**: MongoDB, DynamoDB, SQLite adapters
5. **Workflow Visualization**: Generate flow diagrams
6. **Time-Based Triggers**: Schedule workflow execution
7. **Compensation Logic**: Rollback on failure
8. **Workflow Templates**: Reusable workflow patterns
9. **Monitoring Dashboard**: Real-time workflow monitoring
10. **Workflow Versioning**: Version control for workflows
