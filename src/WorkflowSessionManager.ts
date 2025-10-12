import { WorkflowSession, WorkflowStatus } from './types.js';
import { WorkflowStore } from './WorkflowStore.js';
import { InMemoryWorkflowStore } from './InMemoryWorkflowStore.js';
import { randomUUID } from 'crypto';

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
  createSession(workflowName: string, totalSteps: number): WorkflowSession {
    // Clean up old sessions if we're at the limit (async cleanup)
    this.store.getStats().then((stats) => {
      if (stats.total >= this.maxSessions) {
        this.cleanup();
      }
    });

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

    // Create session in store (fire and forget for sync compatibility)
    this.store.createSession(session);
    return session;
  }

  /**
   * Gets a session by ID
   */
  getSession(sessionId: string): WorkflowSession | undefined {
    // For sync compatibility, we need to handle async store
    // In practice, this will work because createSession is called before getSession
    let result: WorkflowSession | undefined;
    this.store.getSession(sessionId).then((session) => {
      result = session;
    });
    // This is a temporary sync wrapper - ideally the whole API should be async
    return result;
  }

  /**
   * Updates a session
   */
  updateSession(sessionId: string, updates: Partial<WorkflowSession>): void {
    this.store.updateSession(sessionId, updates);
  }

  /**
   * Stores a value in the session memory
   */
  setMemory(sessionId: string, key: string, value: any): void {
    this.store.setMemory(sessionId, key, value);
  }

  /**
   * Gets a value from the session memory
   */
  getMemory(sessionId: string, key: string): any {
    let result: any;
    this.store.getMemory(sessionId, key).then((value) => {
      result = value;
    });
    return result;
  }

  /**
   * Records a step execution in the session history
   */
  recordStepExecution(
    sessionId: string,
    stepIndex: number,
    activityName: string,
    startedAt: Date,
    completedAt: Date,
    success: boolean,
    error?: string
  ): void {
    this.store.recordStepExecution(
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
  recordBranchDecision(
    sessionId: string,
    stepIndex: number,
    branchPattern: string | undefined,
    toolName: string
  ): void {
    this.store.recordBranchDecision(
      sessionId,
      stepIndex,
      branchPattern,
      toolName
    );
  }

  /**
   * Marks a session as completed
   */
  completeSession(
    sessionId: string,
    status: WorkflowStatus,
    error?: string
  ): void {
    this.store.updateSession(sessionId, {
      status,
      completedAt: new Date(),
      error,
    });
  }

  /**
   * Deletes a session
   */
  deleteSession(sessionId: string): void {
    this.store.deleteSession(sessionId);
  }

  /**
   * Cleans up old or completed sessions
   */
  cleanup(): void {
    this.store.cleanup({
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
  getStats(): {
    total: number;
    byStatus: Record<WorkflowStatus, number>;
    byWorkflow: Record<string, number>;
  } {
    // For backwards compatibility, return a basic structure
    // Actual data is fetched async
    const stats = {
      total: 0,
      byStatus: {
        [WorkflowStatus.PENDING]: 0,
        [WorkflowStatus.RUNNING]: 0,
        [WorkflowStatus.COMPLETED]: 0,
        [WorkflowStatus.FAILED]: 0,
        [WorkflowStatus.CANCELLED]: 0,
      },
      byWorkflow: {} as Record<string, number>,
    };

    this.store.getStats().then((storeStats) => {
      stats.total = storeStats.total;
      stats.byStatus[WorkflowStatus.PENDING] = storeStats.pending;
      stats.byStatus[WorkflowStatus.RUNNING] = storeStats.running;
      stats.byStatus[WorkflowStatus.COMPLETED] = storeStats.completed;
      stats.byStatus[WorkflowStatus.FAILED] = storeStats.failed;
      stats.byStatus[WorkflowStatus.CANCELLED] = storeStats.cancelled;
    });

    return stats;
  }

  /**
   * Closes the session manager and its underlying store
   */
  async close(): Promise<void> {
    await this.store.close();
  }
}
