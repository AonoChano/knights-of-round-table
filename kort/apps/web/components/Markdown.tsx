"use client";

import { isValidElement, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import type { Locale } from "../app/locale";
import { CodeBlock } from "./code/CodeBlock";
import { InlineCitation } from "./citation/InlineCitation";
import { remarkCitations } from "./citation/sources";
import type { CiteSource } from "./citation/sources";

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: unknown }).children);
  return "";
}

export function Markdown({
  content,
  locale,
  sources,
}: {
  content: string;
  locale: Locale;
  /** numbered web sources; when present, [n] markers in prose become citation chips */
  sources?: CiteSource[];
}) {
  const count = sources?.length ?? 0;
  const remarkPlugins = useMemo(
    () => (count > 0 ? [remarkGfm, remarkMath, remarkCitations(count)] : [remarkGfm, remarkMath]),
    [count]
  );
  const components = useMemo(
    () => ({
      pre: ({ children }: { children?: ReactNode }) => {
        const child = Array.isArray(children) ? children.find(isValidElement) : children;
        if (!isValidElement(child)) return <pre>{children}</pre>;
        const props = child.props as { className?: string; children?: unknown };
        return (
          <CodeBlock
            code={textOf(props.children)}
            info={(props.className ?? "").replace(/^language-/, "")}
            locale={locale}
          />
        );
      },
      cite: ({ children }: { children?: ReactNode }) => {
        const index = Number(textOf(children).trim());
        const source = sources?.[index - 1];
        if (!source) return <cite>{children}</cite>;
        return <InlineCitation source={source} locale={locale} />;
      },
    }),
    [locale, sources]
  );

  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={[rehypeKatex]} components={components}>
      {content}
    </ReactMarkdown>
  );
}

export type { CiteSource };
export { numberSources } from "./citation/sources";
