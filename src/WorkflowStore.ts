import { WorkflowSession, WorkflowStatus } from "./types.js";

/**
 * Statistics about workflow sessions in the store
 */
export interface WorkflowStoreStats {
  /** Total number of sessions */
  total: number;
  /** Number of pending sessions */
  pending: number;
  /** Number of running sessions */
  running: number;
  /** Number of completed sessions */
  completed: number;
  /** Number of failed sessions */
  failed: number;
  /** Number of cancelled sessions */
  cancelled: number;
}

/**
 * Abstract interface for workflow session storage.
 * Implement this interface to provide custom storage backends (Redis, PostgreSQL, MongoDB, etc.)
 */
export abstract class WorkflowStore {
  /**
   * Creates a new session in the store
   */
  abstract createSession(session: WorkflowSession): Promise<WorkflowSession>;

  /**
   * Retrieves a session by ID
   */
  abstract getSession(sessionId: string): Promise<WorkflowSession | undefined>;

  /**
   * Updates an existing session
   */
  abstract updateSession(
    sessionId: string,
    updates: Partial<WorkflowSession>
  ): Promise<void>;

  /**
   * Deletes a session from the store
   */
  abstract deleteSession(sessionId: string): Promise<void>;

  /**
   * Lists all sessions, optionally filtered by workflow name or status
   */
  abstract listSessions(filters?: {
    workflowName?: string;
    status?: WorkflowStatus;
    limit?: number;
    offset?: number;
  }): Promise<WorkflowSession[]>;

  /**
   * Gets statistics about sessions in the store
   */
  abstract getStats(): Promise<WorkflowStoreStats>;

  /**
   * Cleans up old or completed sessions based on TTL and max sessions limit
   */
  abstract cleanup(options?: {
    maxAge?: number; // Max age in milliseconds
    maxSessions?: number;
    statuses?: WorkflowStatus[]; // Only cleanup sessions with these statuses
  }): Promise<number>; // Returns number of cleaned up sessions

  /**
   * Stores a value in the session's memory
   */
  abstract setMemory(sessionId: string, key: string, value: any): Promise<void>;

  /**
   * Retrieves a value from the session's memory
   */
  abstract getMemory(sessionId: string, key: string): Promise<any | undefined>;

  /**
   * Records a step execution in the session history
   */
  abstract recordStepExecution(
    sessionId: string,
    stepIndex: number,
    activityName: string,
    startedAt: Date,
    completedAt: Date,
    success: boolean,
    error?: string
  ): Promise<void>;

  /**
   * Records a branch decision in the session's branch history
   */
  abstract recordBranchDecision(
    sessionId: string,
    stepIndex: number,
    branchPattern: string | undefined,
    toolName: string
  ): Promise<void>;

  /**
   * Closes the store and cleans up any resources (connections, etc.)
   */
  abstract close(): Promise<void>;
}
