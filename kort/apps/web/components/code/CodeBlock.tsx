"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Copy, FileCode2, FileDiff } from "lucide-react";
import { t, type Locale } from "../../app/locale";
import { tokenizeLine, wordDiff, type DiffPiece, type Token } from "./highlight";

type Row = {
  kind: "code" | "ctx" | "add" | "del" | "hunk" | "file";
  old: number | null;
  cur: number | null;
  text: string;
  pieces?: DiffPiece[];
};

const EXTENSIONS: Record<string, string> = {
  ts: "ts", tsx: "ts", js: "js", jsx: "js", mjs: "js", cjs: "js",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "java",
  c: "c", h: "c", cpp: "c", cc: "c", hpp: "c", cs: "c", sql: "sql",
  sh: "bash", bash: "bash", zsh: "bash", yml: "python", yaml: "python",
  json: "js", css: "css", scss: "css", html: "plain", md: "plain",
};

/** ```lang、```lang path、```path/to/file.ts 三种写法都能识别 */
function parseInfo(info: string): { language: string; filename: string | null } {
  const parts = info.split(/[\s:]+/).filter(Boolean);
  let language = "";
  let filename: string | null = null;
  for (const part of parts) {
    const tail = part.split("/").pop() ?? "";
    const ext = tail.includes(".") ? (tail.split(".").pop() ?? "").toLowerCase() : "";
    if (EXTENSIONS[ext] && !language) {
      filename = tail;
      language = EXTENSIONS[ext];
    } else if (!language && !part.includes(".")) {
      language = part.toLowerCase();
    }
  }
  return { language, filename };
}

function parseDiff(code: string): { rows: Row[]; language: string; filename: string | null } {
  const lines = code.split("\n");
  const rows: Row[] = [];
  let old = 1;
  let cur = 1;
  let language = "plain";
  let filename: string | null = null;
  let delRun: number[] = [];
  let addRun: number[] = [];

  const flushRun = () => {
    if (delRun.length > 0 && delRun.length === addRun.length) {
      delRun.forEach((rowIndex, offset) => {
        const partner = addRun[offset];
        const diff = wordDiff(rows[rowIndex].text, rows[partner].text);
        rows[rowIndex] = { ...rows[rowIndex], pieces: diff.before };
        rows[partner] = { ...rows[partner], pieces: diff.after };
      });
    }
    delRun = [];
    addRun = [];
  };

  lines.forEach((line, index) => {
    if (index === lines.length - 1 && line === "") return;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      flushRun();
      old = Number(hunk[1]);
      cur = Number(hunk[2]);
      rows.push({ kind: "hunk", old: null, cur: null, text: line });
      return;
    }
    if (rows.every((row) => row.kind !== "ctx" && row.kind !== "add" && row.kind !== "del")) {
      const file = /^(--- |\+\+\+ )(\S+)(\s|$)/.exec(line);
      if (file) {
        const tail = (file[2] ?? "").replace(/^[ab]\//, "").split("/").pop() ?? "";
        const ext = (tail.split(".").pop() ?? "").toLowerCase();
        if (tail.includes(".") && EXTENSIONS[ext]) {
          filename = tail;
          language = EXTENSIONS[ext];
        }
        if (!filename) filename = tail || null;
        rows.push({ kind: "file", old: null, cur: null, text: line });
        return;
      }
    }
    if (line.startsWith("-")) {
      delRun.push(rows.length);
      rows.push({ kind: "del", old, cur: null, text: line.slice(1) });
      old += 1;
      return;
    }
    if (line.startsWith("+")) {
      addRun.push(rows.length);
      rows.push({ kind: "add", old: null, cur, text: line.slice(1) });
      cur += 1;
      return;
    }
    flushRun();
    rows.push({ kind: "ctx", old, cur, text: line.replace(/^ /, "") });
    old += 1;
    cur += 1;
  });
  flushRun();
  return { rows, language, filename };
}

function Tokens({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === "plain" ? (
          <span key={index}>{token.text}</span>
        ) : (
          <span key={index} className={`tk-${token.kind}`}>
            {token.text}
          </span>
        )
      )}
    </>
  );
}

export function CodeBlock({ code, info, locale }: { code: string; info: string; locale: Locale }) {
  const copy = t(locale).ui;
  const [copied, setCopied] = useState(false);

  const parsed = useMemo(() => {
    const meta = parseInfo(info);
    if (meta.language === "diff") {
      const diff = parseDiff(code);
      return { diff: diff.rows, language: diff.language, filename: diff.filename ?? meta.filename };
    }
    return { diff: null as Row[] | null, language: meta.language, filename: meta.filename };
  }, [code, info]);

  const lines = useMemo(() => code.replace(/\n$/, "").split("\n"), [code]);
  const added = parsed.diff?.filter((row) => row.kind === "add").length ?? 0;
  const removed = parsed.diff?.filter((row) => row.kind === "del").length ?? 0;
  const title = parsed.filename ?? (parsed.language ? parsed.language.toUpperCase() : copy.codeFallback);

  const handleCopy = useCallback(() => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  }, [code]);

  return (
    <div className="code-block" data-diff={parsed.diff ? "true" : undefined}>
      <div className="code-block-head">
        <span className="code-block-title">
          {parsed.diff ? <FileDiff size={13} aria-hidden="true" /> : <FileCode2 size={13} aria-hidden="true" />}
          <span>{title}</span>
        </span>
        {parsed.diff ? (
          <span className="code-block-stat">
            <span className="code-stat-add">+{added}</span>
            <span className="code-stat-del">-{removed}</span>
          </span>
        ) : null}
        <button
          type="button"
          className={`code-block-copy${copied ? " code-block-copy-done" : ""}`}
          onClick={handleCopy}
          title={copy.copy}
          aria-label={copy.copy}
        >
          {copied ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
          <span>{copied ? copy.copied : copy.copy}</span>
        </button>
      </div>

      <div className="code-block-body">
        {parsed.diff ? (
          parsed.diff.map((row, index) => (
            <div key={index} className={`code-row code-row-${row.kind}`}>
              <span className="code-gutter">{row.old ?? row.cur ?? ""}</span>
              {row.kind === "add" || row.kind === "del" ? (
                <span className="code-mark" aria-hidden="true" />
              ) : null}
              <code className="code-text">
                {row.pieces
                  ? row.pieces.map((piece, pieceIndex) =>
                      piece.changed ? (
                        <span key={pieceIndex} className={`code-word-${row.kind}`}>
                          {piece.text}
                        </span>
                      ) : (
                        <Tokens key={pieceIndex} tokens={tokenizeLine(piece.text, parsed.language)} />
                      )
                    )
                  : <Tokens tokens={tokenizeLine(row.text, parsed.language)} />}
              </code>
            </div>
          ))
        ) : (
          lines.map((line, index) => (
            <div key={index} className="code-row">
              <span className="code-gutter">{index + 1}</span>
              <code className="code-text">
                <Tokens tokens={tokenizeLine(line, parsed.language)} />
              </code>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
