import { apiRequest } from "../models/api";

export type SearchScope = "all" | "title" | "message";

/** One matched row. `matches` are [start, length] pairs inside `snippet`, so the highlight is
 *  drawn from numbers and stored text can never be interpreted as markup. */
export type ConversationSearchHit = {
  conversation_id: string;
  conversation_title: string;
  node_id: string | null;
  match_type: "title" | "message";
  role: "user" | "assistant" | null;
  snippet: string;
  matches: number[][];
  matched_at: string;
  score: number;
};

export type ConversationSearchResponse = {
  query: string;
  scope: SearchScope;
  results: ConversationSearchHit[];
  next_cursor: string | null;
  total: number;
  took_ms: number;
};

export type SearchQuery = {
  query: string;
  scope: SearchScope;
  limit?: number;
  cursor?: string | null;
};

export const searchApi = {
  query: ({ query, scope, limit = 20, cursor = null }: SearchQuery) => {
    const params = new URLSearchParams({ query, scope, limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return apiRequest<ConversationSearchResponse>(`/api/conversations/search?${params.toString()}`);
  },
};
