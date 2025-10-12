import { WorkflowStore, WorkflowStoreStats } from './WorkflowStore.js';
import { WorkflowSession, WorkflowStatus } from './types.js';

/**
 * In-memory implementation of WorkflowStore.
 * This is the default store used when no custom store is provided.
 * Good for development and testing, but data is lost on restart.
 */
export class InMemoryWorkflowStore extends WorkflowStore {
  private sessions: Map<string, WorkflowSession> = new Map();

  async createSession(session: WorkflowSession): Promise<WorkflowSession> {
    this.sessions.set(session.sessionId, {
      ...session,
      // Ensure memory is a Map
      memory: session.memory instanceof Map ? session.memory : new Map(),
      history: [...session.history],
      branchHistory: session.branchHistory ? [...session.branchHistory] : [],
    });

    return this.sessions.get(session.sessionId)!;
  }

  async getSession(sessionId: string): Promise<WorkflowSession | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    // Return a deep copy to prevent external modifications
    return {
      ...session,
      memory: new Map(session.memory),
      history: [...session.history],
      branchHistory: session.branchHistory ? [...session.branchHistory] : [],
    };
  }

  async updateSession(
    sessionId: string,
    updates: Partial<WorkflowSession>
  ): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Merge updates with existing session
    const updated: WorkflowSession = {
      ...existing,
      ...updates,
      // Don't allow sessionId or workflowName to be changed
      sessionId: existing.sessionId,
      workflowName: existing.workflowName,
      // Preserve memory if not included in updates
      memory: updates.memory || existing.memory,
      history: updates.history || existing.history,
      branchHistory: updates.branchHistory || existing.branchHistory,
    };

    this.sessions.set(sessionId, updated);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async listSessions(filters?: {
    workflowName?: string;
    status?: WorkflowStatus;
    limit?: number;
    offset?: number;
  }): Promise<WorkflowSession[]> {
    let sessions = Array.from(this.sessions.values());

    // Apply filters
    if (filters?.workflowName) {
      sessions = sessions.filter(
        (s) => s.workflowName === filters.workflowName
      );
    }

    if (filters?.status) {
      sessions = sessions.filter((s) => s.status === filters.status);
    }

    // Apply pagination
    const offset = filters?.offset || 0;
    const limit = filters?.limit || sessions.length;

    return sessions.slice(offset, offset + limit).map((session) => ({
      ...session,
      memory: new Map(session.memory),
      history: [...session.history],
      branchHistory: session.branchHistory ? [...session.branchHistory] : [],
    }));
  }

  async getStats(): Promise<WorkflowStoreStats> {
    const sessions = Array.from(this.sessions.values());

    return {
      total: sessions.length,
      pending: sessions.filter((s) => s.status === WorkflowStatus.PENDING)
        .length,
      running: sessions.filter((s) => s.status === WorkflowStatus.RUNNING)
        .length,
      completed: sessions.filter((s) => s.status === WorkflowStatus.COMPLETED)
        .length,
      failed: sessions.filter((s) => s.status === WorkflowStatus.FAILED).length,
      cancelled: sessions.filter((s) => s.status === WorkflowStatus.CANCELLED)
        .length,
    };
  }

  async cleanup(options?: {
    maxAge?: number;
    maxSessions?: number;
    statuses?: WorkflowStatus[];
  }): Promise<number> {
    const now = Date.now();
    let deletedCount = 0;

    // Filter sessions to clean up
    const sessionsToClean: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      let shouldClean = false;

      // Check age
      if (options?.maxAge) {
        const age = now - session.startedAt.getTime();
        if (age > options.maxAge) {
          shouldClean = true;
        }
      }

      // Check status filter
      if (options?.statuses && !shouldClean) {
        if (options.statuses.includes(session.status)) {
          shouldClean = true;
        }
      }

      if (shouldClean) {
        sessionsToClean.push(sessionId);
      }
    }

    // Delete marked sessions
    for (const sessionId of sessionsToClean) {
      this.sessions.delete(sessionId);
      deletedCount++;
    }

    // If maxSessions is set and we still have too many, remove oldest
    if (options?.maxSessions && this.sessions.size > options.maxSessions) {
      const sortedSessions = Array.from(this.sessions.entries()).sort(
        (a, b) => a[1].startedAt.getTime() - b[1].startedAt.getTime()
      );

      const toRemove = this.sessions.size - options.maxSessions;
      for (let i = 0; i < toRemove; i++) {
        this.sessions.delete(sortedSessions[i][0]);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  async setMemory(sessionId: string, key: string, value: any): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.memory.set(key, value);
  }

  async getMemory(sessionId: string, key: string): Promise<any | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    return session.memory.get(key);
  }

  async recordStepExecution(
    sessionId: string,
    stepIndex: number,
    activityName: string,
    startedAt: Date,
    completedAt: Date,
    success: boolean,
    error?: string
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.history.push({
      stepIndex,
      activityName,
      startedAt,
      completedAt,
      success,
      error,
    });
  }

  async recordBranchDecision(
    sessionId: string,
    stepIndex: number,
    branchPattern: string | undefined,
    toolName: string
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.branchHistory ??= [];

    session.branchHistory.push({
      stepIndex,
      branchPattern,
      toolName,
      timestamp: new Date(),
    });
  }

  async close(): Promise<void> {
    // No resources to clean up for in-memory store
    this.sessions.clear();
  }
}
