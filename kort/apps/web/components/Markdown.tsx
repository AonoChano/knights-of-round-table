"use client";

import { isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import type { Locale } from "../app/locale";
import { CodeBlock } from "./code/CodeBlock";

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: unknown }).children);
  return "";
}

export function Markdown({ content, locale }: { content: string; locale: Locale }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        pre: ({ children }) => {
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
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
