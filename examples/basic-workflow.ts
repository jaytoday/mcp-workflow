import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { McpActivityTool, McpWorkflow } from "../src/index.js";

/**
 * Example: Building a simple calculator workflow
 * This workflow demonstrates:
 * 1. Creating activity tools with input/output schemas
 * 2. Chaining activities together in a workflow
 * 3. Using workflow memory to pass data between steps
 * 4. Registering the workflow as MCP tools
 */

// Create an MCP server
const server = new McpServer({
  name: "calculator-workflow-server",
  version: "1.0.0",
});

// ============================================
// Define Activity Tools
// ============================================

// Activity 1: Add two numbers
const addActivity = new McpActivityTool("add", "Adds two numbers together", {
  inputSchema: {
    a: z.number(),
    b: z.number(),
  },
  outputSchema: {
    value: z.number(), // Output 'value' to match multiply's input
    factor: z.number().optional(), // Can optionally pass factor through
  },
  callbacks: {
    run: async (context) => {
      const { a, b } = context.input;
      const result = a + b;

      return {
        data: {
          value: result, // Output as 'value' for next step
          factor: 2, // Default factor for multiply step
        },
      };
    },
  },
});

// Activity 2: Multiply by a factor
const multiplyActivity = new McpActivityTool(
  "multiply",
  "Multiplies a number by a factor",
  {
    inputSchema: {
      value: z.number(),
      factor: z.number().default(2),
    },
    outputSchema: {
      value: z.number(), // Output 'value' to match format's input
    },
    callbacks: {
      run: async (context) => {
        const { value, factor } = context.input;
        const result = value * factor;

        return {
          data: { value: result }, // Output as 'value' for next step
        };
      },
    },
  }
);

// Activity 3: Format the result
const formatActivity = new McpActivityTool(
  "format",
  "Formats the final result as a string",
  {
    inputSchema: {
      value: z.number(),
    },
    outputSchema: {
      formatted: z.string(),
    },
    callbacks: {
      run: async (context) => {
        const { value } = context.input;
        const formatted = `The final result is: ${value.toFixed(2)}`;

        return {
          data: { formatted },
        };
      },
    },
  }
);

// ============================================
// Create a Workflow
// ============================================

const calculatorWorkflow = new McpWorkflow(
  "calculator",
  "A workflow that adds two numbers, multiplies the result, and formats the output",
  {
    steps: [
      {
        activity: addActivity,
      },
      {
        activity: multiplyActivity,
      },
      {
        activity: formatActivity,
      },
    ],
    onSuccess: async (memory, sessionId) => {
      server.sendLoggingMessage({
        level: "info",
        data: `[WORKFLOW] Completed successfully! Session ID: ${sessionId}`,
      });
      server.sendLoggingMessage({
        level: "info",
        data: `[WORKFLOW] Final memory: ${JSON.stringify(
          Object.fromEntries(memory)
        )}`,
      });
    },
    onFailure: async (error, sessionId) => {
      server.sendLoggingMessage({
        level: "error",
        data: `[WORKFLOW] Failed: ${error.message}. Session ID: ${sessionId}`,
      });
    },
  }
);

// ============================================
// Attach Workflow to MCP Server
// ============================================

// The workflow automatically registers itself as MCP tools
// This creates two tools:
// - calculator_start: Starts a new workflow execution (uses first activity's input schema)
// - calculator_continue: Continues an existing workflow session
calculatorWorkflow.attachToServer(server, {
  startToolTitle: "Start Calculator Workflow",
  continueToolTitle: "Continue Calculator Workflow",
  // Optionally register individual activities as standalone tools
  registerActivities: true,
});

// ============================================
// Start the Server
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("Calculator Workflow MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
