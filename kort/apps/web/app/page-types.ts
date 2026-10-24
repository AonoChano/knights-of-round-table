import type { ComposerAttachmentPayload } from "../components/composer/Composer";
import type { DiscussionLevel } from "./locale";
import type { TraceTool } from "../components/thinking/ThinkingTrace";

export type ToolTrace = TraceTool;

export type TimerHandle = ReturnType<typeof setTimeout>;

export type ThinkingTreeNode = {
  id: string;
  title: string;
  summary: string;
  parent_id?: string | null;
  status?: "active" | "complete" | "done" | "cancelled";
  children?: ThinkingTreeNode[];
};

export type StageSummary = {
  id: string;
  stage: string;
  title: string;
  snippet: string;
  details: string;
  confidence: number;
  order?: number;
  tree_nodes: ThinkingTreeNode[];
};

export type DelegatedAgent = {
  name: string;
  nickname: string;
  role: string;
  provider_profile: string;
  model: string;
};

export type DelegationInfo = {
  route_kind: "direct" | "solo_thinking" | "panel";
  reason_code: string;
  discussion_level: DiscussionLevel;
  deep_think: boolean;
  participant_count: number;
  max_rounds: number;
  agents: DelegatedAgent[];
  // Early stop fields
  actual_rounds?: number;
  early_stop?: boolean;
  early_stop_reason?: string | null;
  convergence_score?: number | null;
};

export type MessageNode = {
  node_id: string;
  parent_id: string | null;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "error" | "cancelled";
  error?: string | null;
  elapsed_ms?: number;
  created_at?: string;
  stage_summaries?: StageSummary[];
  delegation?: DelegationInfo | null;
  discussion_messages?: DiscussionMessage[];
  tool_traces?: ToolTrace[];
  attachments?: ComposerAttachmentPayload[];
  active_child_id?: string | null;
  children: string[];
};

export type ConversationResponse = {
  conversation_id: string;
  created_at: string;
  updated_at: string;
  title: string;
  expert_count: number;
  nodes: MessageNode[];
  active_root_id: string | null;
  active_path: string[];
};

export type ConversationListItem = {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  expert_count: number;
};

export type BranchAttempt = {
  parentId: string | null;
  role: "user" | "assistant";
  content: string;
  attachments?: ComposerAttachmentPayload[];
  /** 编辑已有消息：新分支要顶替这条消息的位置，不能像新提问那样追加到末尾 */
  editOfNodeId?: string;
};

export type PendingEdit = { nodeId: string; content: string };

export type DiscussionMessage = {
  id: string;
  round: number;
  speaker: string;
  nickname: string;
  role: string;
  text: string;
};

export type DiscussionViewTarget =
  | { source: "live" }
  | { source: "node"; question: string; node: MessageNode };


export type AgentView = {
  name: string;
  nickname: string;
  role: string;
  provider_profile: string;
  model: string;
  system_prompt: string;
  allowed_global_skills: string[];
  disabled_global_skills: string[];
  private_skill_count: number;
  priority: number;
};

export type LogLevel = "error" | "info" | "debug";

export type DeveloperDiagnostics = {
  app_env: string;
  api_base_url: string;
  conversation_store_path: string;
  conversation_count: number;
  jobs_total: number;
  jobs_running: number;
  log_level: string;
};

export type SettingsTab = "general" | "providers" | "experts" | "memory" | "skills" | "data" | "developer";

export type ToolCallView = {
  callId: string;
  name: string;
  state: "running" | "complete" | "failed" | "skipped";
  query?: string;
  url?: string;
  result?: string;
  error?: string;
  reason?: string;
  trace?: ToolTrace;
};

export type TimelineItem = {
  id: string;
  title: string;
  body: string;
  raw: string;
  status: "streaming" | "complete" | "active" | "done" | "talking";
  treeNodes?: ThinkingTreeNode[];
  order?: number;
  call?: ToolCallView;
};

export type StreamEvent = {
  event: string;
  data: Record<string, unknown>;
};

export type StreamSlot = {
  abortController: AbortController | null;
  loading: boolean;
  elapsed: number;
  /** 本轮开始生成的墙钟时间，用来在事件到达时精确结算耗时 */
  startedAt: number | null;
  thinkingComplete: boolean;
  finalBody: string;
  timeline: TimelineItem[];
  nodes: MessageNode[];
  activeRootId: string | null;
  streamingNodeId: string | null;
  pendingRetryOf: string | null;
  lastBranch: BranchAttempt | null;
  talkingActive: boolean;
  discussionLevel: DiscussionLevel;
  submittedQuestion: string | null;
  pendingEdit: PendingEdit | null;
  plannedConversationId: string | null;
  deepThink: boolean;
  requestPhase: "sent" | "delegating" | "delegated" | null;
  delegationInfo: DelegationInfo | null;
  paused: boolean;
  conversation: ConversationResponse | null;
  streamError: string | null;
  discussionMessages: DiscussionMessage[];
  toolTraces: ToolTrace[];
};
