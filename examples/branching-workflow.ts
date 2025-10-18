import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  McpActivityTool,
  McpWorkflow,
  WorkflowSessionManager,
} from "../src/index.js";

/**
 * Example: Branching workflow with conditional paths
 * This demonstrates:
 * 1. Activities returning tool call suggestions
 * 2. Branch definitions based on result patterns
 * 3. Multiple execution paths based on conditions
 * 4. Error handling workflows
 * 5. Approval workflows
 */

// Create a shared session manager
const sessionManager = new WorkflowSessionManager({
  maxSessions: 100,
  sessionTTLMs: 3600000, // 1 hour
});

// Create an MCP server
const server = new McpServer({
  name: "branching-workflow-server",
  version: "1.0.0",
});

// ============================================
// Define Activity Tools
// ============================================

// Activity 1: Validate Input
const validateActivity = new McpActivityTool(
  "validate_input",
  "Validates the input data",
  {
    inputSchema: {
      email: z.string(),
      age: z.number(),
      amount: z.number().optional(),
    },
    outputSchema: {
      valid: z.boolean(),
      errors: z.array(z.string()),
      requiresApproval: z.boolean().optional(),
    },
    callbacks: {
      run: async (context) => {
        const { email, age, amount } = context.input;
        const errors: string[] = [];

        // Validation logic
        if (!email.includes("@")) {
          errors.push("Invalid email format");
        }

        if (age < 18) {
          errors.push("User must be 18 or older");
        }

        const valid = errors.length === 0;
        const requiresApproval = Boolean(valid && amount && amount > 10000);

        // Simply return the data - branching logic is now handled declaratively in the workflow
        return {
          success: true,
          data: {
            valid,
            errors,
            requiresApproval,
          },
        };
      },
    },
  }
);

// Activity 2: Process Registration
const processRegistrationActivity = new McpActivityTool(
  "process_registration",
  "Processes the user registration",
  {
    inputSchema: {
      email: z.string(),
      age: z.number(),
    },
    outputSchema: {
      userId: z.string(),
      status: z.string(),
    },
    callbacks: {
      run: async (context) => {
        const { email } = context.input;

        // Simulate processing
        const userId = `user_${Date.now()}`;

        return {
          success: true,
          data: {
            userId,
            status: "registered",
          },
        };
      },
    },
  }
);

// Activity 3: Send Notification
const sendNotificationActivity = new McpActivityTool(
  "send_notification",
  "Sends a notification to the user",
  {
    inputSchema: {
      userId: z.string(),
      message: z.string().optional(),
    },
    outputSchema: {
      sent: z.boolean(),
      notificationId: z.string(),
    },
    callbacks: {
      run: async (context) => {
        const { userId, message } = context.input;

        const notificationId = `notif_${Date.now()}`;

        return {
          success: true,
          data: {
            sent: true,
            notificationId,
          },
        };
      },
    },
  }
);

// ============================================
// Error Correction Workflow Activities
// ============================================

const errorCorrectionActivity = new McpActivityTool(
  "correct_errors",
  "Attempts to auto-correct validation errors",
  {
    inputSchema: {
      errors: z.array(z.string()),
      originalData: z.any(),
    },
    outputSchema: {
      corrected: z.boolean(),
      correctedData: z.any().optional(),
      remainingErrors: z.array(z.string()),
    },
    callbacks: {
      run: async (context) => {
        const { errors, originalData } = context.input;

        // Simulate auto-correction
        const correctedData = { ...originalData };
        const remainingErrors: string[] = [];

        for (const error of errors) {
          if (error.includes("email")) {
            // Can't auto-fix email
            remainingErrors.push(error);
          }
          // Other errors might be auto-correctable
        }

        const corrected = remainingErrors.length === 0;

        return {
          success: true,
          data: {
            corrected,
            correctedData: corrected ? correctedData : undefined,
            remainingErrors,
          },
        };
      },
    },
  }
);

// ============================================
// Approval Workflow Activities
// ============================================

const requestApprovalActivity = new McpActivityTool(
  "request_approval",
  "Requests approval from a manager",
  {
    inputSchema: {
      data: z.any(),
      reason: z.string(),
    },
    outputSchema: {
      approvalId: z.string(),
      status: z.enum(["pending", "approved", "rejected"]),
    },
    callbacks: {
      run: async (context) => {
        const { reason } = context.input;

        const approvalId = `approval_${Date.now()}`;

        return {
          success: true,
          data: {
            approvalId,
            status: "approved" as const, // In a real system, this would be pending until approved
          },
        };
      },
    },
  }
);

// ============================================
// Create Main User Registration Workflow
// ============================================

const userRegistrationWorkflow = new McpWorkflow(
  "user_registration",
  "Registers a user with validation and conditional branching",
  {
    steps: [
      {
        activity: validateActivity,
        branches: [
          {
            when: (result) => result.valid && result.requiresApproval,
            call: "approval_workflow_start",
            with: (_result, input) => ({
              data: input,
              reason: "Amount exceeds $10,000",
            }),
            description: "Requires manager approval",
          },
          {
            when: (result) => result.valid && !result.requiresApproval,
            call: "user_registration_continue",
            description: "Continue registration",
          },
          {
            when: (result) => !result.valid,
            call: "error_correction_start",
            with: (result, input) => ({
              errors: result.errors,
              originalData: input,
            }),
            description: "Validation failed, attempt auto-correction",
          },
        ],
      },
      {
        activity: processRegistrationActivity,
        // Map validation output or approval output to registration input
        inputMapper: (prevOutput, memory) => {
          // Get the original input from the first step
          const originalInput = memory.get("__workflow_input__");
          return {
            email: originalInput?.email || "",
            age: originalInput?.age || 0,
          };
        },
      },
      {
        activity: sendNotificationActivity,
        // Map registration output to notification input
        inputMapper: (prevOutput) => ({
          userId: prevOutput?.userId || "",
          message: `Welcome! Your status is: ${
            prevOutput?.status || "unknown"
          }`,
        }),
      },
    ],
    onSuccess: async (memory, sessionId) => {
      server.sendLoggingMessage({
        level: "info",
        data: `[WORKFLOW] ✓ User Registration completed! Session ID: ${sessionId}`,
      });

      const result = memory.get("send_notification");
      if (result?.notificationId) {
        server.sendLoggingMessage({
          level: "info",
          data: `[WORKFLOW] Notification sent: ${result.notificationId}`,
        });
      }
    },
    onFailure: async (error, sessionId) => {
      server.sendLoggingMessage({
        level: "error",
        data: `[WORKFLOW] ✗ Registration failed: ${error.message}. Session ID: ${sessionId}`,
      });
    },
  },
  sessionManager
);

// ============================================
// Create Error Correction Workflow
// ============================================

const errorCorrectionWorkflow = new McpWorkflow(
  "error_correction",
  "Attempts to auto-correct validation errors",
  {
    steps: [
      {
        activity: errorCorrectionActivity,
      },
    ],
    onSuccess: async (memory, sessionId) => {
      server.sendLoggingMessage({
        level: "info",
        data: `[ERROR_CORRECTION] ✓ Error correction completed!`,
      });

      const result = memory.get("correct_errors");
      if (result?.corrected) {
        server.sendLoggingMessage({
          level: "info",
          data: `[ERROR_CORRECTION] Errors corrected, can retry registration`,
        });
      } else {
        server.sendLoggingMessage({
          level: "info",
          data: `[ERROR_CORRECTION] Could not auto-correct, manual review needed`,
        });
      }
    },
  },
  sessionManager
);

// ============================================
// Create Approval Workflow
// ============================================

const approvalWorkflow = new McpWorkflow(
  "approval_workflow",
  "Handles approval requests",
  {
    steps: [
      {
        activity: requestApprovalActivity,
      },
    ],
    onSuccess: async (memory, sessionId) => {
      server.sendLoggingMessage({
        level: "info",
        data: `[APPROVAL] ✓ Approval workflow completed!`,
      });

      const result = memory.get("request_approval");
      if (result?.status === "approved") {
        server.sendLoggingMessage({
          level: "info",
          data: `[APPROVAL] Request approved, can continue registration`,
        });
      }
    },
  },
  sessionManager
);

// ============================================
// Attach Workflows to MCP Server
// ============================================

userRegistrationWorkflow.attachToServer(server, {
  startToolTitle: "Start User Registration",
  continueToolTitle: "Continue User Registration",
});

errorCorrectionWorkflow.attachToServer(server, {
  startToolTitle: "Start Error Correction",
  continueToolTitle: "Continue Error Correction",
});

approvalWorkflow.attachToServer(server, {
  startToolTitle: "Start Approval Workflow",
  continueToolTitle: "Continue Approval Workflow",
});

// Add a tool to check workflow status
server.tool(
  "workflow_status",
  "Check the status of any workflow session",
  {
    sessionId: z.string(),
  },
  async (args) => {
    const session =
      (await userRegistrationWorkflow.getSessionStatus(args.sessionId)) ||
      (await errorCorrectionWorkflow.getSessionStatus(args.sessionId)) ||
      (await approvalWorkflow.getSessionStatus(args.sessionId));

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
              branchHistory: session.branchHistory,
            },
            null,
            2
          ),
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
  console.error("Branching Workflow MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
