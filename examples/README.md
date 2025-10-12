# Examples

This directory contains working examples demonstrating the capabilities of mcp-workflow.

## Available Examples

### 1. Basic Workflow ([basic-workflow.ts](./basic-workflow.ts))

A simple calculator workflow demonstrating:
- Creating activity tools with input/output schemas
- Chaining activities in a workflow
- Registering workflows as MCP tools
- Basic lifecycle hooks

**What it does**:
1. Adds two numbers
2. Multiplies the result by a factor
3. Formats the output

**How to run**:
```bash
npm run build
node examples/basic-workflow.ts
```

### 2. Advanced Workflow ([advanced-workflow.ts](./advanced-workflow.ts))

A data processing workflow showcasing advanced features:
- Retry logic with exponential backoff
- Timeout configuration
- Optional steps
- Conditional step execution
- Workflow memory access
- Error handling
- Session management
- Workflow status tracking

**What it does**:
1. Fetches data from a source (with retry)
2. Transforms the data
3. Validates the data (optional step)
4. Aggregates statistics (conditional)
5. Generates a report

**How to run**:
```bash
npm run build
node examples/advanced-workflow.ts
```

## Testing the Examples

## Prerequisites
An MCP client like Claude Code or Cursor.

### Option 1: Using Claude Desktop

Add to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "calculator": {
      "command": "node",
      "args": ["/path/to/mcp-workflow/examples/basic-workflow.ts"]
    },
    "data-processor": {
      "command": "node",
      "args": ["/path/to/mcp-workflow/examples/advanced-workflow.ts"]
    }
  }
}
```

### Option 2: Using MCP Inspector

```bash
npm install -g @modelcontextprotocol/inspector
mcp-inspector node examples/basic-workflow.ts
```

Then open the inspector UI in your browser to test the tools.

### Option 3: Manual Testing with Node

Create a simple test client:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

const serverProcess = spawn('node', ['examples/basic-workflow.ts']);

const transport = new StdioClientTransport({
  command: 'node',
  args: ['examples/basic-workflow.ts'],
});

const client = new Client({
  name: 'test-client',
  version: '1.0.0',
});

await client.connect(transport);

// List available tools
const tools = await client.listTools();
console.log('Available tools:', tools);

// Call a tool
const result = await client.callTool({
  name: 'calculator_start',
  arguments: { a: 5, b: 3 },
});
console.log('Result:', result);
```

## Understanding the Output

### Basic Workflow Output

When you call `calculator_start` with `{ a: 5, b: 3 }`:

```
[ADD] 5 + 3 = 8
[ADD] Success! Result: 8
[MULTIPLY] 8 * 2 = 16
[FORMAT] The final result is: 16.00
[WORKFLOW] Completed successfully!
```

### Advanced Workflow Output

When you call `data_processing_start`:

```
[FETCH] Retrieved 5 items from api
[FETCH] Success at 2025-10-10T...
[TRANSFORM] Applied double operation
[VALIDATE] Data is valid (5 items)
[AGGREGATE] Sum: 30, Avg: 6, Min: 2, Max: 10
[REPORT] Generated report

[WORKFLOW] ✓ Completed successfully!

Data Processing Report
=====================
Generated at: 2025-10-10T...
Workflow: data_processing

Statistics:
- Sum: 30
- Average: 6.00
- Min: 2
- Max: 10

Processing Steps: 5/5
```

## Modifying the Examples

### Change Input Parameters

In [basic-workflow.ts](./basic-workflow.ts), modify the tool registration:

```typescript
server.registerTool(
  'calculator_start',
  {
    title: 'Start Calculator Workflow',
    description: 'Starts the calculator workflow',
    inputSchema: {
      a: z.number(),
      b: z.number(),
      factor: z.number().optional(), // Add optional factor
    },
  },
  calculatorWorkflow.toMcpStartToolCallback()
);
```

### Add More Steps

Add a new activity:

```typescript
const subtractActivity = new McpActivityTool(
  'subtract',
  'Subtracts one number from another',
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
          data: { result: a - b },
        };
      },
    },
  }
);
```

Register it with the workflow:

```typescript
calculatorWorkflow.registerActivity(subtractActivity);
```

Add it to the steps:

```typescript
const calculatorWorkflow = new McpWorkflow(
  'calculator',
  'Calculator with subtraction',
  {
    steps: [
      { activityName: 'add', input: {} },
      { activityName: 'subtract', input: { a: 0, b: 2 } },
      { activityName: 'format', input: {} },
    ],
  }
);
```

### Add Error Handling

Add error simulation:

```typescript
const unreliableActivity = new McpActivityTool(
  'unreliable',
  'An activity that sometimes fails',
  {
    inputSchema: {
      value: z.number(),
      shouldFail: z.boolean().optional(),
    },
    outputSchema: {
      result: z.number(),
    },
    callbacks: {
      run: async (context) => {
        if (context.input.shouldFail) {
          return {
            success: false,
            error: 'Simulated failure',
          };
        }
        return {
          success: true,
          data: { result: context.input.value * 2 },
        };
      },
      onFailure: async (result) => {
        console.error('Activity failed:', result.error);
      },
    },
    retry: {
      maxAttempts: 3,
      backoffMs: 1000,
    },
  }
);
```

## Next Steps

- Read the [README](../README.md) for full documentation
- Check out [QUICKSTART](../QUICKSTART.md) for a step-by-step guide
- Review [ARCHITECTURE](../ARCHITECTURE.md) to understand the internals
- Build your own workflow based on these examples!

## Common Issues

### Issue: "Module not found"

**Solution**: Make sure you've built the project first:
```bash
npm run build
```

### Issue: "Activity not found"

**Solution**: Make sure you've registered the activity with the workflow:
```typescript
workflow.registerActivity(myActivity);
```

### Issue: "Session not found"

**Solution**: Sessions expire after 1 hour by default. Create a custom session manager:
```typescript
const sessionManager = new WorkflowSessionManager({
  sessionTTLMs: 7200000, // 2 hours
});
```

### Issue: "Workflow times out"

**Solution**: Increase the workflow timeout:
```typescript
const workflow = new McpWorkflow('name', 'description', {
  steps: [/* ... */],
  timeout: 60000, // 60 seconds
});
```
