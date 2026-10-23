export type TokenKind = "plain" | "keyword" | "string" | "number" | "function" | "comment";

export type Token = { text: string; kind: TokenKind };

const COMMON = [
  "true", "false", "null", "nil", "None", "undefined", "self", "this", "new", "return",
  "if", "else", "for", "while", "switch", "case", "default", "break", "continue",
];

const KEYWORDS: Record<string, string[]> = {
  js: ["import", "from", "export", "default", "async", "await", "function", "const", "let", "var", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "try", "catch", "finally", "throw", "class", "extends", "super", "typeof", "instanceof", "in", "of", "delete", "yield", "static", "get", "set"],
  ts: ["interface", "type", "enum", "implements", "readonly", "public", "private", "protected", "as", "satisfies", "declare", "namespace", "keyof"],
  python: ["def", "class", "lambda", "pass", "elif", "with", "as", "import", "from", "global", "nonlocal", "raise", "assert", "yield", "del", "is", "in", "not", "and", "or", "async", "await", "try", "except", "finally"],
  java: ["package", "implements", "extends", "public", "private", "protected", "static", "final", "abstract", "class", "interface", "enum", "void", "int", "long", "double", "float", "boolean", "char", "byte", "short", "synchronized", "throws", "try", "catch", "finally", "instanceof"],
  go: ["func", "package", "import", "type", "struct", "interface", "map", "chan", "go", "defer", "select", "range", "var", "const", "string", "int", "int64", "float64", "bool", "error", "make", "new"],
  rust: ["fn", "let", "mut", "struct", "enum", "impl", "trait", "pub", "use", "mod", "match", "if", "else", "loop", "while", "for", "ref", "move", "async", "await", "unsafe", "where", "dyn", "String", "Vec", "Option", "Result", "Some", "None", "Ok", "Err"],
  c: ["void", "int", "char", "float", "double", "long", "short", "unsigned", "signed", "struct", "union", "enum", "typedef", "static", "extern", "const", "sizeof", "goto", "volatile", "register"],
  sql: ["select", "from", "where", "group", "by", "order", "having", "join", "left", "right", "inner", "outer", "on", "as", "and", "or", "not", "null", "insert", "into", "values", "update", "set", "delete", "create", "table", "alter", "drop", "index", "distinct", "limit", "offset", "union", "all", "case", "when", "then", "else", "end", "with"],
  bash: ["if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while", "case", "esac", "function", "local", "export", "echo", "return", "exit", "source", "set"],
  css: ["important", "media", "keyframes", "supports", "import", "root", "hover", "focus", "active", "before", "after"],
};

const LANGUAGES: Record<string, { groups: string[]; line: string[]; block?: [string, string]; quotes: string[]; triple?: string[] }> = {
  js: { groups: ["js", "ts"], line: ["//"], block: ["/*", "*/"], quotes: ['"', "'", "`"] },
  css: { groups: ["css"], line: [], block: ["/*", "*/"], quotes: ['"', "'"] },
  python: { groups: ["python"], line: ["#"], quotes: ['"', "'"], triple: ['"""', "'''"] },
  java: { groups: ["java", "c"], line: ["//"], block: ["/*", "*/"], quotes: ['"'] },
  go: { groups: ["go", "c"], line: ["//"], block: ["/*", "*/"], quotes: ['"', "`"] },
  rust: { groups: ["rust", "c"], line: ["//"], block: ["/*", "*/"], quotes: ['"'] },
  sql: { groups: ["sql"], line: ["--"], quotes: ['"', "'"] },
  bash: { groups: ["bash"], line: ["#"], quotes: ['"', "'"] },
  plain: { groups: [], line: [], quotes: ['"', "'", "`"] },
};

const ALIAS: Record<string, keyof typeof LANGUAGES> = {
  js: "js", javascript: "js", jsx: "js", mjs: "js", cjs: "js",
  ts: "js", tsx: "js", typescript: "js",
  json: "js", jsonc: "js", vue: "js",
  css: "css", scss: "css", less: "css",
  py: "python", python: "python", toml: "python", yaml: "python", yml: "python", ruby: "python", r: "python",
  java: "java", kotlin: "java", scala: "java", c: "java", cpp: "java", csharp: "java", cs: "java", objc: "java",
  go: "go", golang: "go",
  rs: "rust", rust: "rust",
  sql: "sql", postgres: "sql", postgresql: "sql", mysql: "sql", sqlite: "sql",
  sh: "bash", bash: "bash", zsh: "bash", shell: "bash", powershell: "bash", ps1: "bash",
  text: "plain", txt: "plain", md: "plain", markdown: "plain", html: "plain", xml: "plain",
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordPattern(groups: string[]): string {
  const words = new Set<string>(COMMON);
  for (const group of groups) {
    for (const word of KEYWORDS[group] ?? []) {
      words.add(word);
      // SQL 关键字习惯写大写，两种都认
      if (group === "sql") words.add(word.toUpperCase());
    }
  }
  return `\\b(?:${Array.from(words).sort((a, b) => b.length - a.length).map(escapeRegex).join("|")})\\b`;
}

const patternCache = new Map<string, RegExp>();

function tokenPattern(language: string): RegExp {
  const key = language;
  const cached = patternCache.get(key);
  if (cached) return new RegExp(cached.source, "g");

  const id = ALIAS[language.toLowerCase()] ?? "plain";
  const spec = LANGUAGES[id];
  const parts: string[] = [];

  const lineComments = [...spec.line, ...(id === "plain" ? ["//", "#"] : [])];
  if (lineComments.length) {
    parts.push(`(?<line>${lineComments.map(escapeRegex).join("|")}[^\\n]*)`);
  }
  if (spec.block) {
    const [open, close] = spec.block;
    parts.push(`(?<block>${escapeRegex(open)}[\\s\\S]*?${escapeRegex(close)})`);
  }
  const quotes = [...spec.quotes];
  if (spec.triple) {
    // 三引号文档字符串：整行成段，未闭合的那一行也按字符串着色
    const triples = spec.triple.flatMap((quote) => {
      const q = escapeRegex(quote);
      return [`${q}[^\\n]*${q}`, `${q}[^\\n]*`];
    });
    parts.push(`(?<triple>${triples.join("|")})`);
  }
  if (quotes.length) {
    // 允许未闭合的引号：流式输出时字符串可能还没写完
    const perQuote = quotes.map(
      (quote) => `${escapeRegex(quote)}(?:\\\\.|[^\\\\\\n${escapeRegex(quote)}])*${escapeRegex(quote)}?`
    );
    parts.push(`(?<string>${perQuote.join("|")})`);
  }
  parts.push(`(?<keyword>${keywordPattern(spec.groups)})`);
  parts.push(`(?<number>\\b\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b)`);
  // 函数调用；! 覆盖 Rust 宏（println!(...)）
  parts.push(`(?<fn>[A-Za-z_$][\\w$]*!?(?=\\s*\\())`);

  const pattern = new RegExp(parts.filter(Boolean).join("|"), "g");
  patternCache.set(key, pattern);
  return new RegExp(pattern.source, "g");
}

export function tokenizeLine(text: string, language: string): Token[] {
  const pattern = tokenPattern(language);
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    if (!value) continue;
    const index = match.index ?? 0;
    if (index > last) tokens.push({ text: text.slice(last, index), kind: "plain" });
    const groups = match.groups ?? {};
    const kind: TokenKind =
      groups.line || groups.block ? "comment"
        : groups.triple || groups.string ? "string"
          : groups.keyword ? "keyword"
            : groups.number ? "number"
              : groups.fn ? "function"
                : "plain";
    tokens.push({ text: value, kind });
    last = index + value.length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), kind: "plain" });
  return tokens.length > 0 ? tokens : [{ text: "", kind: "plain" }];
}

/** 词级 diff：把两段文本按 token 拆开做 LCS，标出真正变化的片段 */
export type DiffPiece = { text: string; changed: boolean };

function splitWords(text: string): string[] {
  return text.match(/\s+|\w+|[^\s\w]/g) ?? [];
}

export function wordDiff(before: string, after: string): { before: DiffPiece[]; after: DiffPiece[] } {
  const a = splitWords(before);
  const b = splitWords(after);
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = rows - 2; i >= 0; i -= 1) {
    for (let j = cols - 2; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const beforePieces: DiffPiece[] = [];
  const afterPieces: DiffPiece[] = [];
  const push = (list: DiffPiece[], text: string, changed: boolean) => {
    const tail = list[list.length - 1];
    if (tail && tail.changed === changed) tail.text += text;
    else list.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  while (i < rows - 1 || j < cols - 1) {
    if (i < rows - 1 && j < cols - 1 && a[i] === b[j]) {
      push(beforePieces, a[i], false);
      push(afterPieces, b[j], false);
      i += 1;
      j += 1;
    } else if (j < cols - 1 && (i === rows - 1 || table[i * cols + j + 1] >= table[(i + 1) * cols + j])) {
      push(afterPieces, b[j], true);
      j += 1;
    } else {
      push(beforePieces, a[i], true);
      i += 1;
    }
  }
  return { before: beforePieces, after: afterPieces };
}
