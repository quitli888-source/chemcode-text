// ====== Frontend Domain Types ======
// The shape of objects used in the UI. Mirrored 1:1 by `src/api/types.ts`
// which is the wire format. They are intentionally identical for the
// shared types (Task, ChatMessage, ...) so the UI can use either source.

export type CalcType =
  | 'molecular_dynamics'
  | 'dpd'
  | 'quantum_chemistry'
  | 'dft'
  | 'monte_carlo'
  | 'machine_learning';

export type TaskStatus = 'completed' | 'waiting' | 'error' | 'running';

export interface Task {
  id: string;
  name: string;
  calcType: CalcType;
  status: TaskStatus;
  description: string;
  progress?: number;
  createdAt: string;
  completedAt?: string;
  forceField?: string;
  temperature?: number;
  pressure?: number;
  timeStep?: number;
  totalSteps?: number;
  jobs?: JobStep[];
  parameters?: Record<string, string>;
  outputFiles?: string[];
}

export interface JobStep {
  name: string;
  status: TaskStatus;
  detail?: string;
}

export interface ChatMessage {
  id: string;
  type: 'user' | 'agent' | 'system' | 'tool';
  content: string;
  timestamp: string;
  files?: GeneratedFile[];
  code?: string;
  toolCallId?: string;
  toolName?: string;
  toolStatus?: 'pending' | 'running' | 'completed' | 'failed';
  thinking?: string;
  /** Token usage metadata (only on agent messages after done). */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens?: number };
  /** Model used for this message. */
  model?: string;
  /** Context window size in tokens. */
  contextWindow?: number;
  /** Files generated during this agent run. */
  generatedFiles?: Array<{ name: string; path: string; type: string }>;
}

export interface GeneratedFile {
  name: string;
  type: string;
  size?: string;
  content?: string;
  url?: string;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  category: string;
  content: string;
  tags: string[];
  updatedAt: string;
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  installed: boolean;
  author?: string;
  downloads?: number;
  /** Number of tools this skill provides. */
  toolCount?: number;
  /** Tool names provided by this skill. */
  toolNames?: string[];
}

export interface ConfiguredModel {
  id?: string;
  name: string;
  apiUrl: string;
  apiKey?: string;
  supportsContext: boolean;
  provider: string;
  isDefault?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

export type SettingsTab = 'account' | 'system' | 'models' | 'help';

export type PageView =
  | 'login'
  | 'chat'
  | 'task-detail'
  | 'knowledge'
  | 'database'
  | 'skills'
  | 'settings'
  | 'usage';

export type ThemeMode = 'light' | 'dark';
export type Lang = 'zh' | 'en';

export const CALC_TYPE_LABELS: Record<CalcType, string> = {
  molecular_dynamics: '分子动力学',
  dpd: 'DPD',
  quantum_chemistry: '量子化学',
  dft: 'DFT',
  monte_carlo: '蒙特卡洛',
  machine_learning: '机器学习',
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  completed: '已完成',
  waiting: '等待中',
  error: '出错',
  running: '进行中',
};

// ConnectionState used by the navbar / sidebar to show live connection
// status. Mirrors the value in api/types.ts but re-exported here for the UI.
export type ConnectionState =
  | 'idle'
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

// User profile returned by /api/auth/me.
export interface UserProfile {
  id: string;
  username: string;
  email?: string;
  avatarUrl?: string;
  createdAt?: string;
}
