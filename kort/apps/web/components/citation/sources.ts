import type { TraceTool } from "../thinking/ThinkingTrace";

export type CiteSource = {
  index: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
};

export function domainOf(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

export function safeHref(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    return "";
  }
}

/**
 * Number the sources exactly like the backend digest does: walk the completed
 * traces in order and give each unseen URL the next index. The answer text
 * cites those same numbers, so this must stay in lockstep with SourceNumbers on the API.
 */
export function numberSources(traces: TraceTool[]): CiteSource[] {
  const seen = new Set<string>();
  const sources: CiteSource[] = [];
  for (const trace of traces) {
    if (trace.status !== "complete") continue;
    for (const source of trace.sources ?? []) {
      if (!source.url || seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push({
        index: sources.length + 1,
        title: source.title || domainOf(source.url),
        url: source.url,
        domain: source.domain || domainOf(source.url),
        snippet: source.snippet ?? "",
      });
    }
  }
  return sources;
}

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown>; [key: string]: unknown };
};

const GROUP_RE = /\[(\d{1,3}(?:\s*[,，、;；\-–—~至]\s*\d{1,3})*)\]/g;

/** Expand "[1]", "[1, 3]" or "[2-4]" into citation numbers, or null if it is not one. */
function citationNumbers(inner: string): number[] | null {
  const out: number[] = [];
  for (const part of inner.split(/[,，、;；\s]+/)) {
    if (!part) continue;
    const range = /^(\d{1,3})\s*[-–—~至]\s*(\d{1,3})$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to < from || to - from > 12) return null;
      for (let value = from; value <= to; value += 1) out.push(value);
      continue;
    }
    if (!/^\d{1,3}$/.test(part)) return null;
    out.push(Number(part));
  }
  if (out.length === 0) return null;
  return out.filter((value, i) => out.indexOf(value) === i);
}

function citeNode(value: number): MdastNode {
  return {
    type: "cite",
    data: { hName: "cite", hProperties: { className: "citation" } },
    children: [{ type: "text", value: String(value) }],
  };
}

function splitText(value: string, count: number): MdastNode[] | null {
  const nodes: MdastNode[] = [];
  let last = 0;
  let matched = false;
  GROUP_RE.lastIndex = 0;
  for (const match of value.matchAll(GROUP_RE)) {
    const start = match.index ?? 0;
    const numbers = citationNumbers(match[1]);
    if (!numbers || numbers.some((n) => n < 1 || n > count)) continue;
    matched = true;
    if (start > last) nodes.push({ type: "text", value: value.slice(last, start) });
    numbers.forEach((n) => nodes.push(citeNode(n)));
    last = start + match[0].length;
  }
  if (!matched) return null;
  if (last < value.length) nodes.push({ type: "text", value: value.slice(last) });
  return nodes;
}

function rewrite(node: MdastNode, count: number): boolean {
  let changed = false;
  const next: MdastNode[] = [];
  for (const child of node.children ?? []) {
    if (child.type === "text" && typeof child.value === "string") {
      const split = splitText(child.value, count);
      if (split) {
        next.push(...split);
        changed = true;
        continue;
      }
    } else if (child.children && rewrite(child, count)) {
      changed = true;
    }
    next.push(child);
  }
  if (changed) node.children = next;
  return changed;
}

/**
 * Remark plugin factory. unified treats each entry as an attacher, so this
 * returns a function that hands back the transformer.
 */
export function remarkCitations(count: number) {
  return () => (tree: MdastNode) => {
    if (count > 0) rewrite(tree, count);
  };
}
