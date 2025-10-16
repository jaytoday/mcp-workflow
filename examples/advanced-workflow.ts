import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  McpActivityTool,
  McpWorkflow,
  WorkflowSessionManager,
} from "../src/index.js";

/**
 * Example: Advanced workflow with conditional steps, retries, and error handling
 * This demonstrates:
 * 1. Conditional step execution
 * 2. Optional steps
 * 3. Retry logic for failed activities
 * 4. Accessing workflow memory between steps
 * 5. Timeout configuration
 */

// Create a shared session manager for all workflows
const sessionManager = new WorkflowSessionManager({
  maxSessions: 100,
  sessionTTLMs: 3600000, // 1 hour
});

// Create an MCP server
const server = new McpServer({
  name: "advanced-workflow-server",
  version: "1.0.0",
});

// Activity 1: Fetch data (with retry and timeout)
const fetchDataActivity = new McpActivityTool(
  "fetch_data",
  "Fetches data from a source with retry logic",
  {
    inputSchema: {
      source: z.string(),
      simulateFailure: z.boolean().optional(),
    },
    outputSchema: {
      data: z.array(z.number()),
      timestamp: z.string(),
    },
    callbacks: {
      run: async (context) => {
        const { source, simulateFailure } = context.input;

        // Simulate a network call
        await new Promise((resolve) => setTimeout(resolve, 100));

        if (simulateFailure) {
          return {
            success: false,
            error: "Simulated network failure",
          };
        }

        const data = [1, 2, 3, 4, 5];
        console.log(`[FETCH] Retrieved ${data.length} items from ${source}`);

        return {
          success: true,
          data: {
            data,
            timestamp: new Date().toISOString(),
          },
        };
      },
      onSuccess: async (result) => {
        console.log(`[FETCH] Success at ${result.data?.timestamp}`);
      },
      onFailure: async (result) => {
        console.error(`[FETCH] Failed: ${result.error}`);
      },
    },
    timeout: 5000, // 5 second timeout
    retry: {
      maxAttempts: 3,
      backoffMs: 1000,
    },
  }
);

// Activity 2: Transform data
const transformDataActivity = new McpActivityTool(
  "transform_data",
  "Transforms the fetched data",
  {
    inputSchema: {
      data: z.array(z.number()),
      operation: z.enum(["double", "square", "increment"]),
    },
    outputSchema: {
      transformed: z.array(z.number()),
      operation: z.string(),
    },
    callbacks: {
      run: async (context) => {
        const { data, operation } = context.input;

        let transformed: number[];
        switch (operation) {
          case "double":
            transformed = data.map((n) => n * 2);
            break;
          case "square":
            transformed = data.map((n) => n * n);
            break;
          case "increment":
            transformed = data.map((n) => n + 1);
            break;
        }

        console.log(`[TRANSFORM] Applied ${operation} operation`);

        return {
          success: true,
          data: {
            transformed,
            operation,
          },
        };
      },
    },
  }
);

// Activity 3: Validate data (optional step)
const validateDataActivity = new McpActivityTool(
  "validate_data",
  "Validates the transformed data",
  {
    inputSchema: {
      data: z.array(z.number()),
      minLength: z.number(),
    },
    outputSchema: {
      valid: z.boolean(),
      message: z.string(),
    },
    callbacks: {
      run: async (context) => {
        const { data, minLength } = context.input;

        const valid = data.length >= minLength;
        const message = valid
          ? `Data is valid (${data.length} items)`
          : `Data is invalid (${data.length} < ${minLength})`;

        console.log(`[VALIDATE] ${message}`);

        return {
          success: true,
          data: {
            valid,
            message,
          },
        };
      },
    },
  }
);

// Activity 4: Aggregate data
const aggregateDataActivity = new McpActivityTool(
  "aggregate_data",
  "Computes aggregate statistics on the data",
  {
    inputSchema: {
      data: z.array(z.number()),
    },
    outputSchema: {
      sum: z.number(),
      average: z.number(),
      min: z.number(),
      max: z.number(),
    },
    callbacks: {
      run: async (context) => {
        const { data } = context.input;

        const sum = data.reduce((a, b) => a + b, 0);
        const average = sum / data.length;
        const min = Math.min(...data);
        const max = Math.max(...data);

        console.log(
          `[AGGREGATE] Sum: ${sum}, Avg: ${average}, Min: ${min}, Max: ${max}`
        );

        return {
          success: true,
          data: {
            sum,
            average,
            min,
            max,
          },
        };
      },
    },
  }
);

// Activity 5: Generate report
const generateReportActivity = new McpActivityTool(
  "generate_report",
  "Generates a final report",
  {
    inputSchema: {
      stats: z.object({
        sum: z.number(),
        average: z.number(),
        min: z.number(),
        max: z.number(),
      }),
      metadata: z.any(),
    },
    outputSchema: {
      report: z.string(),
    },
    callbacks: {
      run: async (context) => {
        const { stats } = context.input;

        const report = `
Data Processing Report
=====================
Generated at: ${new Date().toISOString()}
Workflow: ${context.metadata.workflowName}

Statistics:
- Sum: ${stats.sum}
- Average: ${stats.average.toFixed(2)}
- Min: ${stats.min}
- Max: ${stats.max}

Processing Steps: ${context.metadata.currentStep + 1}/${
          context.metadata.totalSteps
        }
        `.trim();

        console.log(`[REPORT] Generated report`);

        return {
          success: true,
          data: {
            report,
          },
        };
      },
    },
  }
);

// ============================================
// Create Advanced Workflow with Conditional Steps
// ============================================

const dataProcessingWorkflow = new McpWorkflow(
  "data_processing",
  "Fetches, transforms, validates, and aggregates data with conditional execution",
  {
    steps: [
      {
        activity: fetchDataActivity,
      },
      {
        activity: transformDataActivity,
        // Map the fetch output to transform input
        inputMapper: (prevOutput) => ({
          data: prevOutput?.data || [],
          operation: "double", // Default operation
        }),
      },
      {
        activity: validateDataActivity,
        optional: true, // This step is optional and won't fail the workflow
        // Map the transform output to validate input
        inputMapper: (prevOutput) => ({
          data: prevOutput?.transformed || [],
          minLength: 3,
        }),
      },
      {
        activity: aggregateDataActivity,
        // Only run this step if validation passed or was skipped
        condition: async (memory) => {
          const validationResult = memory.get("validate_data");
          if (!validationResult) return true; // Validation was skipped
          return validationResult.valid === true;
        },
        // Map from either transform or validate output
        inputMapper: (prevOutput, memory) => {
          const transformData = memory.get("transform_data");
          return {
            data: transformData?.transformed || [],
          };
        },
      },
      {
        activity: generateReportActivity,
        // Map the aggregate output to report input
        inputMapper: (prevOutput, memory) => ({
          stats: prevOutput || {},
          metadata: {
            fetchTimestamp: memory.get("fetch_data")?.timestamp,
            transformOperation: memory.get("transform_data")?.operation,
          },
        }),
      },
    ],
    timeout: 30000, // 30 second total workflow timeout
    onSuccess: async (memory, sessionId) => {
      console.log(`\n[WORKFLOW] ✓ Completed successfully!`);
      console.log(`[WORKFLOW] Session ID: ${sessionId}`);

      const report = memory.get("generate_report");
      if (report?.report) {
        console.log("\n" + report.report);
      }
    },
    onFailure: async (error, sessionId) => {
      console.error(`\n[WORKFLOW] ✗ Failed: ${error.message}`);
      console.error(`[WORKFLOW] Session ID: ${sessionId}`);
    },
    onComplete: async (status, sessionId) => {
      console.log(`\n[WORKFLOW] Final status: ${status}`);

      // Get session stats
      const stats = await sessionManager.getStats();
      console.log(`[WORKFLOW] Active sessions: ${stats.total}`);
    },
  },
  sessionManager
);

// Activities are automatically registered from the workflow steps!

// ============================================
// Attach Workflow to MCP Server
// ============================================

// The workflow automatically registers itself as MCP tools
// This creates two tools:
// - data_processing_start: Starts a new workflow execution (uses first activity's input schema)
// - data_processing_continue: Continues an existing workflow session
dataProcessingWorkflow.attachToServer(server, {
  startToolTitle: "Start Data Processing Workflow",
  continueToolTitle: "Continue Data Processing Workflow",
  // Don't register individual activities as standalone tools in this example
  registerActivities: false,
});

// Add a tool to check workflow status
server.tool(
  "workflow_status",
  "Check the status of a workflow session",
  {
    sessionId: z.string(),
  },
  async (args) => {
    const session = await dataProcessingWorkflow.getSessionStatus(
      args.sessionId
    );

    if (!session) {
      return {
        content: [
          {
            type: "text",
            text: `Session ${args.sessionId} not found`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              sessionId: session.sessionId,
              workflowName: session.workflowName,
              status: session.status,
              currentStep: session.currentStep,
              totalSteps: session.totalSteps,
              startedAt: session.startedAt,
              completedAt: session.completedAt,
              history: session.history,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Add a tool to get session manager stats
server.tool(
  "workflow_stats",
  "Get statistics about all workflow sessions",
  async () => {
    const stats = sessionManager.getStats();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  }
);

// ============================================
// Start the Server
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Advanced Workflow MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
