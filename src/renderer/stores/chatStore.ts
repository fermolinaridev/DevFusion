import { create } from 'zustand';
import type { AgentId } from '@shared/agents';
import type { ChatMessage, ChatTarget, OutboundPreview, Task, TaskDecision, TaskOutbound } from '@shared/orchestration';
import { unwrap } from '../lib/ipc';

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

interface ChatState {
  messages: ChatMessage[];
  tasks: Task[];
  init(): () => void;
  reload(): Promise<void>;
  send(to: ChatTarget, content: string): Promise<Result<ChatMessage>>;
  forward(from: AgentId, to: AgentId, content: string): Promise<Result<ChatMessage>>;
  createTask(input: { title: string; description: string; criteria: string[]; developer: AgentId; reviewer: AgentId; worktree: boolean }): Promise<Result<Task | null>>;
  previewTask(taskId: string, action: TaskOutbound, notes?: string): Promise<Result<OutboundPreview>>;
  sendTask(taskId: string, action: TaskOutbound, content: string): Promise<Result<Task>>;
  decideTask(taskId: string, decision: TaskDecision, note?: string): Promise<Result<Task>>;
}

const MAX_IN_MEMORY = 300;

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  tasks: [],
  init() {
    const offMsg = window.devfusion.chat.onMessage((m) => set((s) => ({ messages: [...s.messages, m].slice(-MAX_IN_MEMORY) })));
    const offTask = window.devfusion.tasks.onUpdated((t) => set((s) => ({ tasks: [t, ...s.tasks.filter((x) => x.id !== t.id)] })));
    const offWs = window.devfusion.workspace.onChanged(() => void get().reload());
    void get().reload();
    return () => { offMsg(); offTask(); offWs(); };
  },
  async reload() {
    const [messages, tasks] = await Promise.all([unwrap(window.devfusion.chat.list(200)), unwrap(window.devfusion.tasks.list())]);
    set({ messages, tasks });
  },
  send: (to, content) => unwrap(window.devfusion.chat.send(to, content)),
  forward: (from, to, content) => unwrap(window.devfusion.chat.forward(from, to, content)),
  createTask: (input) => unwrap(window.devfusion.tasks.create(input)),
  previewTask: (taskId, action, notes) => unwrap(window.devfusion.tasks.preview(taskId, action, notes)),
  sendTask: (taskId, action, content) => unwrap(window.devfusion.tasks.send(taskId, action, content)),
  decideTask: (taskId, decision, note) => unwrap(window.devfusion.tasks.decide(taskId, decision, note)),
}));
