import { apiRequest } from "../models/api";

export type MemoryFact = {
  id: string;
  scope: "private" | "shared";
  text: string;
  tags: string[];
  confidence: number;
  importance: number;
  pinned: boolean;
  source: string;
  status: string;
  promoted_to?: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type MemoryHunch = {
  id: string;
  text: string;
  confidence: number;
  tags: string[];
  status: string;
  created_at: string | null;
  updated_at: string | null;
};

export type MemoryEpisode = {
  id: string;
  question: string;
  answer_gist: string;
  summaries: string[];
  participants: string[];
  importance: number;
  created_at: string | null;
};

export type MemoryDream = {
  id: string;
  created_at: string | null;
  journal: string;
  stats: Record<string, number>;
};

export type MemoryStatus = {
  agent: string;
  fact_count: number;
  shared_fact_count: number;
  episode_count: number;
  hunch_count: number;
  pending_episodes: number;
  last_dream_at: string | null;
  self_narrative: string;
  preview: string;
  budget_tokens: number;
  auto_dream: boolean;
  dream_min_episodes: number;
  dream_min_hours: number;
};

export type MemoryDetail = {
  agent: string;
  self_narrative: string;
  private_facts: MemoryFact[];
  shared_facts: MemoryFact[];
  hunches: MemoryHunch[];
  episodes: MemoryEpisode[];
  dreams: MemoryDream[];
  status: MemoryStatus;
};

export type MemoryDreamReport = {
  agent: string;
  applied: boolean;
  journal: string;
  stats: Record<string, number>;
  added_facts: string[];
  added_hunches: string[];
  shared_promotions: string[];
  rejected: string[];
  self_narrative: string;
  proposal: Record<string, unknown> | null;
};

export type RememberInput = {
  text: string;
  tags?: string[];
  scope?: "private" | "shared";
  pinned?: boolean;
};

export const memoryApi = {
  detail: (agent: string) =>
    apiRequest<MemoryDetail>(`/api/memory/${encodeURIComponent(agent)}/detail`),

  remember: (agent: string, input: RememberInput) =>
    apiRequest<MemoryFact>(`/api/memory/${encodeURIComponent(agent)}/remember`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateFact: (
    agent: string,
    factId: string,
    input: { text?: string; pinned?: boolean; importance?: number; confidence?: number; status?: "active" | "archived" }
  ) =>
    apiRequest<MemoryFact>(
      `/api/memory/${encodeURIComponent(agent)}/facts/${encodeURIComponent(factId)}`,
      { method: "PATCH", body: JSON.stringify(input) }
    ),

  archiveFact: (agent: string, factId: string) =>
    apiRequest<MemoryFact>(
      `/api/memory/${encodeURIComponent(agent)}/facts/${encodeURIComponent(factId)}`,
      { method: "DELETE" }
    ),

  promoteFact: (agent: string, factId: string) =>
    apiRequest<MemoryFact>(
      `/api/memory/${encodeURIComponent(agent)}/facts/${encodeURIComponent(factId)}/promote`,
      { method: "POST" }
    ),

  dream: (agent: string, apply: boolean) =>
    apiRequest<MemoryDreamReport>(
      `/api/memory/${encodeURIComponent(agent)}/dream`,
      { method: "POST", body: JSON.stringify({ apply }) },
      180000
    ),
};
