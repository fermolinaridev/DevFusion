import { z } from 'zod';
import type { ChatMessage } from './orchestration';

export interface SessionRecord { id: string; agent: string; state: string; createdAt: string; updatedAt: string }
export interface HistoryOverview { messages: number; sessions: number; tasks: number; oldestMessageAt: string | null }
export interface RecentWorkspace { id: string; name: string; displayPath: string; lastOpenedAt: string | null; available: boolean }
export interface DashboardData {
  recent: RecentWorkspace[];
  tasksByStatus: Record<string, number>;
  worktreesActive: number;
  history: HistoryOverview | null;
}
export type { ChatMessage };

export const HistorySearchArgsSchema = z.object({ query: z.string().max(200), limit: z.number().int().min(1).max(500) }).strict();
export const OpenRecentArgsSchema = z.object({ id: z.string().uuid() }).strict();
