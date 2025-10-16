import { WorkflowSession, WorkflowStatus } from "./types.js";
import { WorkflowStore } from "./WorkflowStore.js";
import { InMemoryWorkflowStore } from "./InMemoryWorkflowStore.js";
import { randomUUID } from "crypto";

/**
 * Manages workflow sessions across multiple executions.
 * Uses a pluggable WorkflowStore for persistence.
 */
export class WorkflowSessionManager {
  private readonly store: WorkflowStore;
  private readonly maxSessions: number;
  private readonly sessionTTLMs: number;

  constructor(options?: {
    maxSessions?: number;
    sessionTTLMs?: number;
    store?: WorkflowStore;
  }) {
    this.maxSessions = options?.maxSessions || 1000;
    this.sessionTTLMs = options?.sessionTTLMs || 3600000; // 1 hour default
    this.store = options?.store || new InMemoryWorkflowStore();
  }

  /**
   * Creates a new workflow session
   */
  async createSession(
    workflowName: string,
    totalSteps: number
  ): Promise<WorkflowSession> {
    // Clean up old sessions if we're at the limit
    const stats = await this.store.getStats();
    if (stats.total >= this.maxSessions) {
      await this.cleanup();
    }

    const sessionId = randomUUID();
    const session: WorkflowSession = {
      sessionId,
      workflowName,
      status: WorkflowStatus.PENDING,
      currentStep: 0,
      totalSteps,
      memory: new Map(),
      startedAt: new Date(),
      history: [],
      branchHistory: [],
    };

    // Create session in store
    return this.store.createSession(session);
  }

  /**
   * Gets a session by ID
   */
  async getSession(sessionId: string): Promise<WorkflowSession | undefined> {
    return this.store.getSession(sessionId);
  }

  /**
   * Updates a session
   */
  async updateSession(
    sessionId: string,
    updates: Partial<WorkflowSession>
  ): Promise<void> {
    await this.store.updateSession(sessionId, updates);
  }

  /**
   * Stores a value in the session memory
   */
  async setMemory(sessionId: string, key: string, value: any): Promise<void> {
    await this.store.setMemory(sessionId, key, value);
  }

  /**
   * Gets a value from the session memory
   */
  async getMemory(sessionId: string, key: string): Promise<any> {
    return this.store.getMemory(sessionId, key);
  }

  /**
   * Records a step execution in the session history
   */
  async recordStepExecution(
    sessionId: string,
    stepIndex: number,
    activityName: string,
    startedAt: Date,
    completedAt: Date,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.store.recordStepExecution(
      sessionId,
      stepIndex,
      activityName,
      startedAt,
      completedAt,
      success,
      error
    );
  }

  /**
   * Records a branch decision in the session history
   */
  async recordBranchDecision(
    sessionId: string,
    stepIndex: number,
    branchPattern: string | undefined,
    toolName: string
  ): Promise<void> {
    await this.store.recordBranchDecision(
      sessionId,
      stepIndex,
      branchPattern,
      toolName
    );
  }

  /**
   * Marks a session as completed
   */
  async completeSession(
    sessionId: string,
    status: WorkflowStatus,
    error?: string
  ): Promise<void> {
    await this.store.updateSession(sessionId, {
      status,
      completedAt: new Date(),
      error,
    });
  }

  /**
   * Deletes a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.store.deleteSession(sessionId);
  }

  /**
   * Cleans up old or completed sessions
   */
  async cleanup(): Promise<void> {
    await this.store.cleanup({
      maxAge: this.sessionTTLMs,
      maxSessions: this.maxSessions,
      statuses: [
        WorkflowStatus.COMPLETED,
        WorkflowStatus.FAILED,
        WorkflowStatus.CANCELLED,
      ],
    });
  }

  /**
   * Gets all sessions for a workflow
   */
  async getSessionsForWorkflow(
    workflowName: string
  ): Promise<WorkflowSession[]> {
    return this.store.listSessions({ workflowName });
  }

  /**
   * Gets statistics about sessions
   */
  async getStats(): Promise<{
    total: number;
    byStatus: Record<WorkflowStatus, number>;
    byWorkflow: Record<string, number>;
  }> {
    const storeStats = await this.store.getStats();
    const sessions = await this.store.listSessions();

    const byWorkflow: Record<string, number> = {};
    for (const session of sessions) {
      byWorkflow[session.workflowName] =
        (byWorkflow[session.workflowName] || 0) + 1;
    }

    return {
      total: storeStats.total,
      byStatus: {
        [WorkflowStatus.PENDING]: storeStats.pending,
        [WorkflowStatus.RUNNING]: storeStats.running,
        [WorkflowStatus.COMPLETED]: storeStats.completed,
        [WorkflowStatus.FAILED]: storeStats.failed,
        [WorkflowStatus.CANCELLED]: storeStats.cancelled,
      },
      byWorkflow,
    };
  }

  /**
   * Closes the session manager and its underlying store
   */
  async close(): Promise<void> {
    await this.store.close();
  }
}
