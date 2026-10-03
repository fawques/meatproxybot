/**
 * Manages per-workspace trigger emoji configuration.
 * Workspaces can configure their own trigger emoji independently.
 */
export interface WorkspaceStore {
  /**
   * Get the trigger emoji for a workspace.
   * Returns undefined if no specific configuration exists.
   */
  getTriggerEmoji(teamId: string): string | undefined;

  /**
   * Set the trigger emoji for a workspace.
   */
  setTriggerEmoji(teamId: string, emoji: string): void;

  /**
   * Clear the trigger emoji configuration for a workspace.
   */
  clearTriggerEmoji(teamId: string): void;
}

/**
 * In-memory workspace store for per-workspace configuration.
 * Configuration is stored in a Map but not persisted to disk.
 */
export class InMemoryWorkspaceStore implements WorkspaceStore {
  private config: Map<string, string> = new Map();

  getTriggerEmoji(teamId: string): string | undefined {
    return this.config.get(teamId);
  }

  setTriggerEmoji(teamId: string, emoji: string): void {
    this.config.set(teamId, emoji);
  }

  clearTriggerEmoji(teamId: string): void {
    this.config.delete(teamId);
  }
}
