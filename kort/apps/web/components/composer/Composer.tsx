"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type Dispatch,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  Brain,
  Check,
  CircleStop,
  Eraser,
  FileText,
  Globe,
  ImageOff,
  Loader2,
  Mic,
  Plus,
  SendHorizontal,
  UsersRound,
  WifiOff,
  X,
} from "lucide-react";
import { discussionLevels, t } from "../../app/locale";
import type { DiscussionLevel, Locale } from "../../app/locale";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  kindOf,
  readTextFile,
} from "./attachmentFiles";
import { useDictation, type DictationErrorCode } from "./useDictation";

export type AttachmentNote = "truncated" | "undecodable" | "binary" | "tooLarge" | "tooMany";

export type ComposerAttachmentItem = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  chars: number;
  text: string;
  state: "reading" | "done" | "error";
  progress: number;
  note?: AttachmentNote;
};

export type ComposerAttachmentPayload = { name: string; mime: string; text: string };

const COMPOSER_ROW_GAP = 8;
const COMPOSER_ROW_PADDING = 16;
const COMPOSER_ROW_SLACK = 12;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 168;
const HINT_MS = 2200;

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function attachmentId() {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** the /command [arg] being typed at the end of the draft — CJK names included */
function parseCommand(draft: string): CommandToken | null {
  const match = /(^|\s)\/([\p{L}\p{N}-]+)?(?:\s+([^\s]*))?$/u.exec(draft);
  if (!match) return null;
  const start = match.index + match[1].length;
  const word = match[2] ?? "";
  const args = match[3] ?? "";
  return { start, word, args, wordEnd: start + 1 + word.length };
}

type CommandToken = { start: number; word: string; args: string; wordEnd: number };

type MenuRow = {
  key: string;
  name: string;
  desc: string;
  checked: boolean;
  icon: ReactNode;
  keywords: string[];
};

/* ─────────────────────────────────────────────────────────
 * 斜杠命令菜单：一条滑动高亮，↑↓ + Enter/Tab 选择，Esc 退回
 * ───────────────────────────────────────────────────────── */
function CommandMenu({
  rows,
  active,
  label,
  emptyText,
  onHover,
  onPick,
}: {
  rows: MenuRow[];
  active: number;
  label: string;
  emptyText: string;
  onHover: (index: number) => void;
  onPick: (key: string) => void;
}) {
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const [engaged, setEngaged] = useState(false);

  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target) setBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [active, rows.length]);

  useEffect(() => setEngaged(false), [rows.length]);

  return (
    <div className="composer-menu" role="menu" aria-label={label} onMouseLeave={() => setEngaged(false)}>
      <span
        aria-hidden="true"
        className="composer-menu-glide"
        style={{
          top: box?.top ?? 0,
          height: box?.height ?? 0,
          opacity: box && engaged && rows.length > 0 ? 1 : 0,
        }}
      />
      {rows.length === 0 ? <div className="composer-menu-empty">{emptyText}</div> : null}
      {rows.map((row, index) => (
        <button
          key={row.key}
          type="button"
          role="menuitem"
          ref={(element) => {
            rowRefs.current[index] = element;
          }}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => {
            onHover(index);
            setEngaged(true);
          }}
          onClick={() => onPick(row.key)}
          className={cn("composer-menu-row", index === active && "composer-menu-row-active")}
        >
          <span className="composer-menu-icon" aria-hidden="true">
            {row.icon}
          </span>
          <span className="composer-menu-name">{row.name}</span>
          <span className="composer-menu-desc">{row.desc}</span>
          {row.checked ? (
            <span className="composer-menu-check" aria-hidden="true">
              <Check size={13} />
            </span>
          ) : index === active ? (
            <span className="composer-menu-enter" aria-hidden="true">
              ↵
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * 附件芯片：读取进度、失败原因、移除
 * ───────────────────────────────────────────────────────── */
function AttachmentChip({
  item,
  locale,
  onRemove,
}: {
  item: ComposerAttachmentItem;
  locale: Locale;
  onRemove: (id: string) => void;
}) {
  const cp = t(locale).composer;
  const notes: Record<AttachmentNote, string> = {
    truncated: cp.attachmentTruncated,
    undecodable: cp.attachmentUndecodable,
    binary: cp.attachmentBinary,
    tooLarge: cp.attachmentTooLarge,
    tooMany: cp.attachmentTooMany,
  };
  const error = item.state === "error";
  const meta = error
    ? (item.note ? notes[item.note] : cp.attachmentFailed)
    : item.state === "reading"
      ? `${Math.round(item.progress)}%`
      : (item.note ? notes[item.note] : humanSize(item.bytes));

  return (
    <div className={cn("composer-attachment", error && "composer-attachment-error")}>
      <span className="composer-attachment-icon" aria-hidden="true">
        {item.note === "binary" ? <ImageOff size={13} /> : <FileText size={13} />}
      </span>
      <span className="composer-attachment-label">
        <span className="composer-attachment-name" title={item.name}>
          {item.name}
        </span>
        <span className="composer-attachment-meta">{meta}</span>
      </span>
      {item.state === "reading" ? (
        <span className="composer-attachment-spinner" aria-hidden="true">
          <Loader2 size={12} />
        </span>
      ) : (
        <button
          type="button"
          className="composer-attachment-remove"
          aria-label={`${cp.attachmentRemove} ${item.name}`}
          onClick={() => onRemove(item.id)}
        >
          <X size={11} aria-hidden="true" />
        </button>
      )}
      {item.state === "reading" ? (
        <span className="composer-attachment-progress" style={{ width: `${item.progress}%` }} />
      ) : null}
    </div>
  );
}

export function Composer({
  input,
  loading,
  paused,
  pauseFlash,
  locale,
  setInput,
  webSearch,
  setWebSearch,
  discussionLevel,
  setDiscussionLevel,
  deepThink,
  setDeepThink,
  attachments,
  setAttachments,
  onSubmit,
  onPause,
}: {
  input: string;
  loading: boolean;
  paused: boolean;
  pauseFlash: boolean;
  locale: Locale;
  setInput: Dispatch<SetStateAction<string>>;
  webSearch: boolean;
  setWebSearch: Dispatch<SetStateAction<boolean>>;
  discussionLevel: DiscussionLevel;
  setDiscussionLevel: Dispatch<SetStateAction<DiscussionLevel>>;
  deepThink: boolean;
  setDeepThink: Dispatch<SetStateAction<boolean>>;
  attachments: ComposerAttachmentItem[];
  setAttachments: Dispatch<SetStateAction<ComposerAttachmentItem[]>>;
  onSubmit: (files: ComposerAttachmentPayload[]) => void;
  onPause: () => void;
}) {
  const copy = t(locale).ui;
  const cp = t(locale).composer;
  const shellRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wide, setWide] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [submenu, setSubmenu] = useState(false);
  const [submenuWord, setSubmenuWord] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const say = useCallback((message: string) => {
    setHint(message);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  }, []);

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    []
  );

  const dictation = useDictation({
    lang: locale === "zh-CN" ? "zh-CN" : "en-US",
    onFinal: (text) => setInput((current) => (current ? `${current.trimEnd()} ${text}` : text)),
    onError: (code: DictationErrorCode) =>
      say(
        code === "mic"
          ? cp.dictateMic
          : code === "silent"
            ? cp.dictateSilent
            : code === "network"
              ? cp.dictateNetwork
              : cp.dictateFailed
      ),
  });

  const token = dismissed ? null : parseCommand(input);
  const query = token ? (submenu ? token.args : token.word).toLowerCase() : "";
  const levels = useMemo(() => discussionLevels(locale), [locale]);

  const commands = useMemo<MenuRow[]>(
    () => [
      {
        key: "web",
        name: `/${cp.commandWeb}`,
        desc: cp.commandWebDesc,
        keywords: ["web", "search", "net", "联网", "搜索", "联网搜索"],
        icon: <Globe size={13} />,
        checked: webSearch,
      },
      {
        key: "discuss",
        name: `/${cp.commandDiscuss}`,
        desc: cp.commandDiscussDesc,
        keywords: ["discuss", "panel", "experts", "讨论", "专家", "讨论档位"],
        icon: <UsersRound size={13} />,
        checked: discussionLevel !== "off",
      },
      {
        key: "deep",
        name: `/${cp.commandDeep}`,
        desc: cp.commandDeepDesc,
        keywords: ["deep", "think", "solo", "深想", "深度", "深度思考"],
        icon: <Brain size={13} />,
        checked: deepThink,
      },
      {
        key: "clear",
        name: `/${cp.commandClear}`,
        desc: cp.commandClearDesc,
        keywords: ["clear", "reset", "清空", "清除", "清空输入"],
        icon: <Eraser size={13} />,
        checked: false,
      },
    ],
    [cp, deepThink, discussionLevel, webSearch]
  );

  const rows = useMemo<MenuRow[]>(() => {
    if (submenu) {
      return levels
        .map((level) => ({
          key: level.id,
          name: level.label,
          desc: `${level.tag} [${level.code}]`,
          keywords: [level.id, level.code, level.tag, level.label],
          icon: <Check size={13} />,
          checked: discussionLevel === level.id,
        }))
        .filter((row) => !query || row.keywords.some((keyword) => keyword.startsWith(query)));
    }
    if (!token) return [];
    return commands.filter(
      (row) =>
        !query ||
        row.name.slice(1).toLowerCase().startsWith(query) ||
        row.keywords.some((keyword) => keyword.startsWith(query)) ||
        row.desc.toLowerCase().includes(query)
    );
  }, [commands, discussionLevel, levels, query, submenu, token]);

  const menuOpen = !dismissed && (token !== null || submenu);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    if (!submenu) return;
    if (!token) {
      setSubmenu(false);
      setSubmenuWord(null);
    }
  }, [submenu, token]);

  /* 输入变化后重新允许菜单出现，除非用户刚按 Esc 关掉了它 */
  useEffect(() => {
    if (!token && dismissed) setDismissed(false);
  }, [dismissed, token]);

  const applyCommand = useCallback(
    (key: string) => {
      if (key === "web") {
        const next = !webSearch;
        setWebSearch(next);
        say(next ? cp.commandWebOn : cp.commandWebOff);
      } else if (key === "deep") {
        const next = !deepThink;
        setDeepThink(next);
        if (next && discussionLevel !== "off") {
          setDiscussionLevel("off");
          say(cp.commandDeepPanel);
        } else {
          say(next ? cp.commandDeepOn : cp.commandDeepOff);
        }
      } else if (key === "clear") {
        setInput("");
        setAttachments([]);
        setHint(null);
      } else {
        const level = levels.find((item) => item.id === key);
        if (level) {
          setDiscussionLevel(level.id);
          say(cp.commandLevel(level.label));
        }
      }
      setSubmenu(false);
      setSubmenuWord(null);
      setDismissed(true);
      const current = token;
      if (current) {
        const withArgs = submenu && current.args.length > 0;
        const cut = withArgs ? current.wordEnd + 1 + current.args.length : current.wordEnd;
        setInput((draft) =>
          (draft.slice(0, current.start) + draft.slice(cut)).replace(/^ /, "").replace(/\s+$/, "")
        );
      }
      textareaRef.current?.focus();
    },
    [
      cp,
      deepThink,
      discussionLevel,
      levels,
      say,
      setAttachments,
      setDeepThink,
      setDiscussionLevel,
      setInput,
      setWebSearch,
      submenu,
      token,
      webSearch,
    ]
  );

  const onPick = useCallback(
    (key: string) => {
      if (key === "discuss" && !submenu) {
        setSubmenu(true);
        setSubmenuWord(token?.word ?? "");
        setActive(0);
        return;
      }
      applyCommand(key);
    },
    [applyCommand, submenu, token]
  );

  /* 一行放得下就把按钮留在输入行两端；一旦换行或挤不下，输入独占一行、按钮落到下一行 */
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const measure = measureRef.current;
    if (!shell || !measure) return;
    const reserved =
      (plusRef.current?.offsetWidth ?? 0) +
      (micRef.current?.offsetWidth ?? 0) +
      (sendRef.current?.offsetWidth ?? 0) +
      COMPOSER_ROW_GAP * 3 +
      COMPOSER_ROW_PADDING +
      COMPOSER_ROW_SLACK;
    setWide(input.includes("\n") || measure.offsetWidth > shell.clientWidth - reserved);
  }, [input, wide]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, [input, wide, dictation.listening]);

  /* 点击输入框之外任何位置都收起菜单 */
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: globalThis.PointerEvent) => {
      if ((event.target as Element).closest("[data-composer]")) return;
      setSubmenu(false);
      setSubmenuWord(null);
      setDismissed(true);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const patch = useCallback(
    (id: string, next: Partial<ComposerAttachmentItem>) =>
      setAttachments((current) =>
        current.map((item) => (item.id === id ? { ...item, ...next } : item))
      ),
    [setAttachments]
  );

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const files = Array.from(list);
      if (files.length === 0) return;
      const room = MAX_ATTACHMENTS - attachments.length;
      if (room <= 0) {
        say(cp.attachmentTooMany);
        return;
      }
      for (const file of files.slice(0, room)) {
        const id = attachmentId();
        const base = {
          id,
          name: file.name.slice(0, 120),
          mime: file.type || "",
          bytes: file.size,
          chars: 0,
          text: "",
          progress: 0,
        };
        if (kindOf(file) !== "text") {
          setAttachments((current) => [...current, { ...base, state: "error", note: "binary" }]);
          continue;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setAttachments((current) => [...current, { ...base, state: "error", note: "tooLarge" }]);
          continue;
        }
        setAttachments((current) => [...current, { ...base, state: "reading" }]);
        let lastPercent = -1;
        void readTextFile(file, (fraction) => {
          const percent = Math.round(fraction * 100);
          if (percent === lastPercent) return;
          lastPercent = percent;
          patch(id, { progress: percent });
        })
          .then((result) => {
            if (result.undecodable) {
              patch(id, { state: "error", note: "undecodable", progress: 100 });
            } else {
              patch(id, {
                state: "done",
                text: result.text,
                chars: result.chars,
                progress: 100,
                note: result.truncated ? "truncated" : undefined,
              });
            }
          })
          .catch(() => patch(id, { state: "error", note: "tooLarge", progress: 100 }));
      }
    },
    [attachments.length, cp, patch, say, setAttachments]
  );

  const onFilePick = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files);
  };

  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = event.clipboardData?.files;
    if (files && files.length > 0) {
      event.preventDefault();
      addFiles(files);
    }
  };

  const readyFiles = attachments.filter((item) => item.state === "done");
  const readingFiles = attachments.some((item) => item.state === "reading");
  const canSend = !loading && !readingFiles && (input.trim().length > 0 || readyFiles.length > 0);

  function submit() {
    onSubmit(readyFiles.map((item) => ({ name: item.name, mime: item.mime, text: item.text })));
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const composing = event.nativeEvent.isComposing;
    if (menuOpen && rows.length > 0 && !composing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((current) => (current + step + rows.length) % rows.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        onPick(rows[active].key);
        return;
      }
    }
    if (event.key === "Escape") {
      if (submenu) {
        event.preventDefault();
        setSubmenu(false);
        setSubmenuWord(null);
        return;
      }
      if (token) {
        event.preventDefault();
        setDismissed(true);
        return;
      }
      if (dictation.listening) {
        dictation.stop();
        return;
      }
    }
    /* 中文输入法回车选词不应该把消息发出去 */
    if (event.key === "Enter" && !event.shiftKey && !composing) {
      event.preventDefault();
      if (canSend) submit();
    }
  }

  return (
    <div
      data-composer
      ref={shellRef}
      className={cn("composer-shell", wide && "composer-shell-wide")}
      data-drag-active={dragging ? "true" : "false"}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <span ref={measureRef} className="composer-measure" aria-hidden="true">
        {input}
      </span>

      {menuOpen ? (
        <CommandMenu
          rows={rows}
          active={active}
          label={cp.slashMenu}
          emptyText={cp.slashEmpty(`/${query}`)}
          onHover={setActive}
          onPick={onPick}
        />
      ) : null}

      {attachments.length > 0 ? (
        <div className="composer-attachments">
          {attachments.map((item) => (
            <AttachmentChip
              key={item.id}
              item={item}
              locale={locale}
              onRemove={(id) =>
                setAttachments((current) => current.filter((one) => one.id !== id))
              }
            />
          ))}
        </div>
      ) : null}

      <button
        ref={plusRef}
        type="button"
        className="composer-attach"
        aria-label={cp.attach}
        title={cp.attach}
        disabled={loading}
        onClick={() => attachRef.current?.click()}
      >
        <Plus size={15} aria-hidden="true" />
      </button>
      <input
        ref={attachRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="composer-file-input"
        onChange={onFilePick}
        tabIndex={-1}
      />

      {dictation.listening ? (
        <div className="composer-voice" role="status" aria-live="polite">
          <span className="composer-voice-bars" aria-hidden="true">
            {Array.from({ length: 14 }, (_, index) => (
              <span key={index} style={{ animationDelay: `${(index % 7) * 90}ms` }} />
            ))}
          </span>
          <span className="composer-voice-time">
            {Math.floor(dictation.seconds / 60)}:{String(dictation.seconds % 60).padStart(2, "0")}
          </span>
          <span className="composer-voice-text">{dictation.interim || cp.voiceListening}</span>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => {
            const value = event.target.value;
            setInput(value);
            setDismissed(false);
            /* 继续补参数时留在子菜单里，只有换命令或删空才退回命令列表 */
            if (submenu && submenuWord && parseCommand(value)?.word !== submenuWord) {
              setSubmenu(false);
              setSubmenuWord(null);
            }
          }}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          rows={1}
          className="composer-textarea"
          placeholder={cp.placeholder}
          aria-label={cp.placeholder}
        />
      )}

      <div className="composer-tools">
        {webSearch ? null : (
          <button
            type="button"
            className="composer-offline"
            title={cp.offlineHint}
            onClick={() => setWebSearch(true)}
          >
            <WifiOff size={11} aria-hidden="true" />
            <span>{cp.offlineBadge}</span>
          </button>
        )}
        {dictation.supported ? (
          <button
            ref={micRef}
            type="button"
            className={cn("composer-mic", dictation.listening && "composer-mic-active")}
            aria-pressed={dictation.listening}
            aria-label={dictation.listening ? cp.dictateStop : cp.dictate}
            title={dictation.listening ? cp.dictateStop : cp.dictate}
            onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
          >
            <Mic size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <button
        ref={sendRef}
        className={cn(
          "send-button",
          paused && pauseFlash && "send-button-pause-flash",
          paused && !pauseFlash && "send-button-paused"
        )}
        onClick={paused ? undefined : loading ? onPause : canSend ? submit : undefined}
        disabled={paused || (!loading && !canSend)}
        type="button"
        aria-label={loading ? copy.stop : readingFiles ? cp.attachmentReading : copy.send}
        title={loading ? copy.stop : readingFiles ? cp.attachmentReading : copy.send}
      >
        {paused ? (
          <span className="pause-status-text">{copy.paused}</span>
        ) : loading ? (
          <CircleStop size={16} aria-hidden="true" />
        ) : (
          <SendHorizontal size={18} aria-hidden="true" />
        )}
      </button>

      {hint ? (
        <div className="composer-hint" role="status">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
