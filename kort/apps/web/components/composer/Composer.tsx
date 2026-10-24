"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type Dispatch,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Cpu,
  Eye,
  FileText,
  Globe,
  GlobeOff,
  Image as ImageIcon,
  ImageOff,
  Loader2,
  Mic,
  Plus,
  SendHorizontal,
  UsersRound,
  X,
} from "lucide-react";
import { t } from "../../app/locale";
import type { Locale } from "../../app/locale";
import { AgentGlyph } from "../agents/AgentGlyph";
import { ProfileIcon } from "../models/ProviderIcon";
import type { ProviderProfile } from "../models/types";
import {
  ATTACHMENT_ACCEPT,
  IMAGE_ACCEPT,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_IMAGE_INPUT_BYTES,
  kindOf,
  readImageFile,
  readTextFile,
} from "./attachmentFiles";
import { useDictation, type DictationErrorCode } from "./useDictation";

export type AttachmentNote =
  | "truncated"
  | "undecodable"
  | "binary"
  | "tooLarge"
  | "imageTooLarge"
  | "tooMany"
  | "imageFailed";

export type ComposerAttachmentItem = {
  id: string;
  kind: "text" | "image" | "other";
  name: string;
  mime: string;
  bytes: number;
  chars: number;
  text: string;
  data: string;
  width: number;
  height: number;
  state: "reading" | "done" | "error";
  progress: number;
  note?: AttachmentNote;
};

export type ComposerAttachmentPayload = {
  kind?: "text" | "image";
  name: string;
  mime: string;
  text?: string;
  data?: string;
  width?: number;
  height?: number;
  bytes?: number;
};

export type WebSearchMode = "auto" | "required" | "disabled";

export type ComposerModelOption = { name: string; label: string; model: string };

export type ComposerProviderModelOption = {
  id: string;
  provider: ProviderProfile;
  label: string;
  model: string;
  capabilities: string[];
};

export type ComposerModelMode = "agents" | "models";

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

/* ─────────────────────────────────────────────────────────
 * 联网搜索：主体在 auto / required 之间切换，箭头菜单列出三种状态
 * ───────────────────────────────────────────────────────── */
function AutoGlobeIcon({ size = 15 }: { size?: number }) {
  const maskId = `auto-globe-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">
          <rect width="16" height="16" fill="#fff" />
          <circle cx="11.9" cy="11.9" r="4.3" fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <circle cx="6.9" cy="7.2" r="5.6" />
        <path d="M1.3 7.2h11.2" />
        <path d="M6.9 1.6c1.7 1.7 2.5 3.5 2.5 5.6s-.8 3.9-2.5 5.6" />
        <path d="M6.9 1.6C5.2 3.3 4.4 5.1 4.4 7.2s.8 3.9 2.5 5.6" />
      </g>
      <text
        x="11.9"
        y="15"
        fill="currentColor"
        fontSize="9"
        fontWeight="800"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        textAnchor="middle"
      >
        A
      </text>
    </svg>
  );
}

function SearchStateIcon({ mode, size = 15 }: { mode: WebSearchMode; size?: number }) {
  if (mode === "auto") return <AutoGlobeIcon size={size} />;
  if (mode === "disabled") return <GlobeOff size={size} aria-hidden="true" />;
  return <Globe size={size} aria-hidden="true" />;
}

function SearchControl({
  mode,
  open,
  locale,
  onChangeMode,
  onToggleMenu,
}: {
  mode: WebSearchMode;
  open: boolean;
  locale: Locale;
  onChangeMode: (mode: WebSearchMode) => void;
  onToggleMenu: () => void;
}) {
  const cp = t(locale).composer;
  const hint =
    mode === "required" ? cp.searchHintRequired : mode === "disabled" ? cp.searchHintDisabled : cp.searchHintAuto;
  const rows: Array<{ value: WebSearchMode; name: string; desc: string }> = [
    { value: "auto", name: cp.searchAuto, desc: cp.searchAutoDesc },
    { value: "required", name: cp.searchRequired, desc: cp.searchRequiredDesc },
    { value: "disabled", name: cp.searchDisabled, desc: cp.searchDisabledDesc },
  ];
  return (
    <div
      className={cn(
        "composer-search",
        mode === "required" && "is-required",
        mode === "disabled" && "is-disabled",
        open && "is-open"
      )}
      data-menu-root="search"
    >
      <button
        type="button"
        className="composer-search-main"
        title={hint}
        aria-label={hint}
        aria-pressed={mode === "required"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() =>
          onChangeMode(mode === "auto" ? "required" : mode === "required" ? "disabled" : "auto")
        }
      >
        <SearchStateIcon mode={mode} />
      </button>
      <button
        type="button"
        className="composer-search-caret"
        title={cp.searchMenu}
        aria-label={cp.searchMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggleMenu}
      >
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? (
        <div className="composer-popover composer-popover-search" role="menu" aria-label={cp.searchMenu}>
          {rows.map((row) => (
            <button
              key={row.value}
              type="button"
              role="menuitemradio"
              aria-checked={mode === row.value}
              className={cn("composer-popover-row", mode === row.value && "is-active")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChangeMode(row.value)}
            >
              <span className="composer-popover-icon" aria-hidden="true">
                {row.value === "disabled" ? <GlobeOff size={14} /> : <Globe size={14} />}
              </span>
              <span className="composer-popover-copy">
                <span className="composer-popover-name">{row.name}</span>
                <span className="composer-popover-desc">{row.desc}</span>
              </span>
              {mode === row.value ? (
                <span className="composer-popover-check" aria-hidden="true">
                  <Check size={13} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * 普通模式：先选供应商，再在右侧展开它的模型
 * ───────────────────────────────────────────────────────── */
type ProviderGroup = { provider: ProviderProfile; options: ComposerProviderModelOption[] };

function groupProviders(options: ComposerProviderModelOption[]): ProviderGroup[] {
  const groups: ProviderGroup[] = [];
  const index = new Map<string, number>();
  for (const option of options) {
    const id = option.provider.provider_id;
    const at = index.get(id);
    if (at === undefined) {
      index.set(id, groups.length);
      groups.push({ provider: option.provider, options: [option] });
    } else {
      groups[at].options.push(option);
    }
  }
  return groups;
}

function ProviderModelMenu({
  options,
  value,
  autoLabel,
  autoHint,
  menuLabel,
  backLabel,
  visionLabel,
  onChange,
}: {
  options: ComposerProviderModelOption[];
  value: string;
  autoLabel: string;
  autoHint: string;
  menuLabel: string;
  backLabel: string;
  visionLabel: string;
  onChange: (value: string) => void;
}) {
  const groups = useMemo(() => groupProviders(options), [options]);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flyout, setFlyout] = useState<{
    providerId: string;
    top: number;
    side: "left" | "right";
  } | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setFlyout(null), 140);
  }

  function positionFlyout(providerId: string, row: HTMLElement) {
    const popover = popoverRef.current;
    if (!popover) return null;
    const popRect = popover.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const group = groups.find((entry) => entry.provider.provider_id === providerId);
    const height = Math.min(280, (group?.options.length ?? 1) * 32 + 8);
    const preferredTop = rowRect.top - popRect.top - 4;
    const maxTop = Math.max(0, window.innerHeight - 12 - height - popRect.top);
    const spaceRight = window.innerWidth - popRect.right;
    const spaceLeft = popRect.left;
    const side = spaceRight >= 216 || spaceRight >= spaceLeft ? "right" : "left";
    return {
      providerId,
      top: Math.min(Math.max(0, preferredTop), maxTop),
      side: side as "left" | "right",
    };
  }

  function openFlyout(providerId: string, row: HTMLElement) {
    cancelClose();
    activeRowRef.current = row;
    const next = positionFlyout(providerId, row);
    if (next) setFlyout(next);
  }

  function handleListScroll() {
    if (!flyout) return;
    const row = activeRowRef.current;
    const list = listRef.current;
    if (!row || !list) return;
    const rowRect = row.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (rowRect.bottom <= listRect.top + 2 || rowRect.top >= listRect.bottom - 2) {
      setFlyout(null);
      return;
    }
    const next = positionFlyout(flyout.providerId, row);
    if (next) setFlyout(next);
  }

  const activeGroup = flyout
    ? groups.find((entry) => entry.provider.provider_id === flyout.providerId) ?? null
    : null;

  return (
    <div
      ref={popoverRef}
      className="composer-popover composer-popover-model composer-popover-provider-menu"
      role="menu"
      aria-label={menuLabel}
    >
      <div ref={listRef} className="composer-provider-list" onScroll={handleListScroll}>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={!value}
          title={autoHint}
          className="composer-popover-row composer-provider-row"
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setFlyout(null)}
          onClick={() => onChange("")}
        >
          <span className="composer-provider-mark" aria-hidden="true">
            <Cpu size={15} />
          </span>
          <span className="composer-provider-name">{autoLabel}</span>
          {!value ? <Check size={13} className="composer-provider-check" aria-hidden="true" /> : null}
        </button>
        {groups.map((group) => {
          const selected = group.options.some((option) => option.id === value);
          const expanded = flyout?.providerId === group.provider.provider_id;
          return (
            <button
              key={group.provider.provider_id}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={expanded}
              className={cn("composer-popover-row", "composer-provider-row", selected && "is-active")}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={(event) => openFlyout(group.provider.provider_id, event.currentTarget)}
              onMouseLeave={scheduleClose}
              onFocus={(event) => openFlyout(group.provider.provider_id, event.currentTarget)}
              onClick={(event) => openFlyout(group.provider.provider_id, event.currentTarget)}
            >
              <span className="composer-provider-mark" aria-hidden="true">
                <ProfileIcon provider={group.provider} size={26} className="composer-provider-icon" />
              </span>
              <span className="composer-provider-name">
                {group.provider.label || group.provider.provider_id}
              </span>
              <ChevronRight size={13} className="composer-provider-caret" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {flyout && activeGroup ? (
        <div
          className={cn("composer-provider-models", flyout.side === "left" && "is-left")}
          style={{ top: flyout.top }}
          role="menu"
          aria-label={activeGroup.provider.label || activeGroup.provider.provider_id}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="composer-provider-models-head">
            <button
              type="button"
              className="composer-provider-back"
              aria-label={backLabel}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setFlyout(null)}
            >
              <ChevronLeft size={13} aria-hidden="true" />
            </button>
            <span className="composer-provider-models-title">
              {activeGroup.provider.label || activeGroup.provider.provider_id}
            </span>
          </div>
          {activeGroup.options.map((option) => {
            const selected = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={cn("composer-model-option", selected && "is-active")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChange(option.id)}
              >
                <span className="composer-model-option-name">{option.label}</span>
                {option.capabilities.includes("vision") ? (
                  <span className="composer-model-vision" title={visionLabel} aria-label={visionLabel}>
                    <Eye size={12} aria-hidden="true" />
                  </span>
                ) : null}
                {selected ? <Check size={12} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * 本轮作答模型：默认自动，也可以指定某位可用专家背后的模型
 * ───────────────────────────────────────────────────────── */
function ModelPicker({
  mode,
  options,
  providerOptions,
  value,
  open,
  locale,
  onChange,
  onToggleMenu,
}: {
  mode: ComposerModelMode;
  options: ComposerModelOption[];
  providerOptions: ComposerProviderModelOption[];
  value: string;
  open: boolean;
  locale: Locale;
  onChange: (value: string) => void;
  onToggleMenu: () => void;
}) {
  const cp = t(locale).composer;
  const agentCurrent = mode === "agents" ? options.find((option) => option.name === value) ?? null : null;
  const providerCurrent =
    mode === "models" ? providerOptions.find((option) => option.id === value) ?? null : null;
  const current = agentCurrent ?? providerCurrent;
  const [played, setPlayed] = useState<{ agent: string; nonce: number } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setHovered(null);
  }, [open]);
  const title = current
    ? `${cp.modelMenu}: ${current.label} · ${
        agentCurrent
          ? agentCurrent.model
          : providerCurrent
            ? providerCurrent.provider.label || providerCurrent.provider.provider_id
            : ""
      }`
    : mode === "agents"
      ? cp.modelAutoHint
      : cp.modelAutoModelHint;
  return (
    <div
      className={cn("composer-model", current && "is-selected", open && "is-open")}
      data-menu-root="model"
    >
      <button
        type="button"
        className="composer-model-trigger"
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggleMenu}
      >
        {agentCurrent ? (
          <AgentGlyph
            key={`${agentCurrent.name}:${played?.agent === agentCurrent.name ? played.nonce : 0}`}
            agent={agentCurrent.name}
            size={16}
            playing={played?.agent === agentCurrent.name}
          />
        ) : providerCurrent ? (
          <ProfileIcon provider={providerCurrent.provider} size={20} className="composer-provider-icon" />
        ) : (
          <Cpu size={14} aria-hidden="true" />
        )}
        <span className="composer-model-label">
          <span className="composer-model-name">{current ? current.label : cp.modelAuto}</span>
        </span>
        <ChevronDown size={12} aria-hidden="true" className="composer-model-caret" />
      </button>
      {open ? (
        mode === "agents" ? (
          <div className="composer-popover composer-popover-model" role="menu" aria-label={cp.modelMenu}>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!current}
              className={cn("composer-popover-row", !current && "is-active")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange("")}
            >
              <span className="composer-popover-icon" aria-hidden="true">
                <Cpu size={14} />
              </span>
              <span className="composer-popover-copy">
                <span className="composer-popover-name">{cp.modelAuto}</span>
                <span className="composer-popover-desc">{cp.modelAutoDesc}</span>
              </span>
              {!current ? (
                <span className="composer-popover-check" aria-hidden="true">
                  <Check size={13} />
                </span>
              ) : null}
            </button>
            {options.map((option) => {
              const selected = option.name === value;
              return (
                <button
                  key={option.name}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={cn("composer-popover-row", selected && "is-active")}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHovered(option.name)}
                  onMouseLeave={() => setHovered((current) => (current === option.name ? null : current))}
                  onClick={() => {
                    setPlayed((prev) => ({
                      agent: option.name,
                      nonce: (prev?.nonce ?? 0) + 1,
                    }));
                    onChange(option.name);
                  }}
                >
                  <span className="composer-popover-icon" aria-hidden="true">
                    <AgentGlyph agent={option.name} size={14} loop={hovered === option.name} />
                  </span>
                  <span className="composer-popover-copy">
                    <span className="composer-popover-name">{option.label}</span>
                    <span className="composer-popover-desc">{option.model}</span>
                  </span>
                  {selected ? (
                    <span className="composer-popover-check" aria-hidden="true">
                      <Check size={13} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <ProviderModelMenu
            options={providerOptions}
            value={value}
            autoLabel={cp.modelAuto}
            autoHint={cp.modelAutoModelDesc}
            menuLabel={cp.modelMenu}
            backLabel={cp.providerBack}
            visionLabel={cp.visionModel}
            onChange={onChange}
          />
        )
      ) : null}
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
    imageTooLarge: cp.attachmentImageTooLarge,
    tooMany: cp.attachmentTooMany,
    imageFailed: cp.attachmentImageFailed,
  };
  const error = item.state === "error";
  const image = item.kind === "image";
  const meta = error
    ? (item.note ? notes[item.note] : cp.attachmentFailed)
    : item.state === "reading"
      ? image
        ? cp.attachmentImageReading
        : `${Math.round(item.progress)}%`
      : image
        ? `${item.width}×${item.height} · ${humanSize(item.bytes)}`
        : (item.note ? notes[item.note] : humanSize(item.bytes));

  return (
    <div
      className={cn(
        "composer-attachment",
        image && "composer-attachment-image",
        error && "composer-attachment-error"
      )}
    >
      {image ? (
        item.state === "done" && item.data ? (
          <img className="composer-attachment-thumb" src={item.data} alt="" draggable={false} />
        ) : (
          <span
            className={cn(
              "composer-attachment-thumb",
              "composer-attachment-thumb-empty",
              item.state === "reading" && "is-reading"
            )}
            aria-hidden="true"
          >
            {item.state === "reading" ? <Loader2 size={14} /> : <ImageOff size={14} />}
          </span>
        )
      ) : (
        <span className="composer-attachment-icon" aria-hidden="true">
          {item.note === "binary" ? <ImageOff size={13} /> : <FileText size={13} />}
        </span>
      )}
      <span className="composer-attachment-label">
        <span className="composer-attachment-name" title={item.name}>
          {item.name}
        </span>
        <span className="composer-attachment-meta">{meta}</span>
      </span>
      {item.state === "reading" && !image ? (
        <span className="composer-attachment-spinner" aria-hidden="true">
          <Loader2 size={12} />
        </span>
      ) : (
        <button
          type="button"
          className="composer-attachment-remove"
          aria-label={`${cp.attachmentRemove} ${item.name}`}
          onMouseDown={(event) => event.preventDefault()}
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
  webSearchMode,
  setWebSearchMode,
  modelMode,
  modelOptions,
  providerModelOptions,
  modelValue,
  setModelValue,
  discussionOn,
  deepThink,
  onToggleDiscussion,
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
  webSearchMode: WebSearchMode;
  setWebSearchMode: Dispatch<SetStateAction<WebSearchMode>>;
  modelMode: ComposerModelMode;
  modelOptions: ComposerModelOption[];
  providerModelOptions: ComposerProviderModelOption[];
  modelValue: string;
  setModelValue: Dispatch<SetStateAction<string>>;
  discussionOn: boolean;
  deepThink: boolean;
  onToggleDiscussion: () => void;
  attachments: ComposerAttachmentItem[];
  setAttachments: Dispatch<SetStateAction<ComposerAttachmentItem[]>>;
  onSubmit: (files: ComposerAttachmentPayload[]) => void;
  onPause: () => void;
}) {
  const copy = t(locale).ui;
  const cp = t(locale).composer;
  const shellRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composingRef = useRef(false);
  const [openMenu, setOpenMenu] = useState<"attach" | "search" | "model" | null>(null);
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

  const focusTextarea = useCallback(() => {
    textareaRef.current?.focus();
  }, []);

  /* 菜单外的任何按下都收起菜单；工具栏按钮自己的点击不会丢焦点之外的草稿 */
  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(`[data-menu-root="${openMenu}"]`)) return;
      setOpenMenu(null);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, [input, dictation.listening]);

  useEffect(() => {
    setOpenMenu(null);
  }, [modelMode]);

  useEffect(() => {
    const fit = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`;
      textarea.style.overflowY =
        textarea.scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
    };
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

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
      let blockedImage = false;
      for (const file of files.slice(0, room)) {
        const id = attachmentId();
        const kind = kindOf(file);
        const base = {
          id,
          kind,
          name: file.name.slice(0, 120),
          mime: file.type || "",
          bytes: file.size,
          chars: 0,
          text: "",
          data: "",
          width: 0,
          height: 0,
          progress: 0,
        };
        if (kind === "image") {
          if (discussionOn) {
            blockedImage = true;
            continue;
          }
          if (file.size > MAX_IMAGE_INPUT_BYTES) {
            setAttachments((current) => [
              ...current,
              { ...base, state: "error", note: "imageTooLarge" },
            ]);
            continue;
          }
          setAttachments((current) => [...current, { ...base, state: "reading", progress: 30 }]);
          void readImageFile(file)
            .then((result) => {
              patch(id, {
                state: "done",
                data: result.data,
                mime: result.mime,
                bytes: result.bytes,
                width: result.width,
                height: result.height,
                progress: 100,
              });
            })
            .catch(() => patch(id, { state: "error", note: "imageFailed", progress: 100 }));
          continue;
        }
        if (kind !== "text") {
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
      if (blockedImage) say(cp.imageNeedsSingleModel);
    },
    [attachments.length, cp, discussionOn, patch, say, setAttachments]
  );

  const onFilePick = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
    focusTextarea();
  };

  const onImagePick = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
    focusTextarea();
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
  const hasImages = attachments.some((item) => item.kind === "image" && item.state !== "error");
  const selectedProviderModel = providerModelOptions.find((option) => option.id === modelValue) ?? null;
  const visionMissing =
    hasImages &&
    modelMode === "models" &&
    (modelValue
      ? !selectedProviderModel?.capabilities.includes("vision")
      : !providerModelOptions.some((option) => option.capabilities.includes("vision")));
  const imageBlocked = hasImages && (visionMissing || deepThink);
  const canSend =
    !loading &&
    !readingFiles &&
    !imageBlocked &&
    (input.trim().length > 0 || readyFiles.length > 0);

  function submit() {
    onSubmit(
      readyFiles.map((item) =>
        item.kind === "image"
          ? {
              kind: "image" as const,
              name: item.name,
              mime: item.mime,
              data: item.data,
              width: item.width,
              height: item.height,
              bytes: item.bytes,
            }
          : {
              kind: "text" as const,
              name: item.name,
              mime: item.mime,
              text: item.text,
            }
      )
    );
  }

  function pickSearchMode(mode: WebSearchMode) {
    setWebSearchMode(mode);
    setOpenMenu(null);
    focusTextarea();
  }

  function pickModel(value: string) {
    setModelValue(value);
    setOpenMenu(null);
    focusTextarea();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    /* 中文输入法回车选词不应该把消息发出去 */
    if (event.nativeEvent.isComposing || composingRef.current || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape" && dictation.listening) {
      dictation.stop();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) submit();
    }
  }

  return (
    <div
      data-composer
      ref={shellRef}
      className="composer-shell"
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
          onChange={(event) => setInput(event.target.value)}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          rows={1}
          className="composer-textarea"
          placeholder={cp.placeholder}
          aria-label={cp.placeholder}
        />
      )}

      {attachments.length > 0 ? (
        <div className="composer-context" aria-label={cp.attachments}>
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

      {imageBlocked ? (
        <div className="composer-vision-warning" role="status">
          <ImageIcon size={12} aria-hidden="true" />
          <span>{deepThink ? cp.imageNeedsStandardThink : cp.imageNeedsVision}</span>
        </div>
      ) : null}

      <div className="composer-toolbar">
        <div className="composer-toolbar-group">
          <div className="composer-attach" data-menu-root="attach">
            <button
              type="button"
              className={cn("composer-icon-button", openMenu === "attach" && "is-open")}
              aria-label={cp.attachMenu}
              aria-haspopup="menu"
              aria-expanded={openMenu === "attach"}
              title={cp.attachMenu}
              disabled={loading}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                setOpenMenu((current) => (current === "attach" ? null : "attach"))
              }
            >
              <Plus size={16} aria-hidden="true" />
            </button>
            {openMenu === "attach" ? (
              <div
                className="composer-popover composer-popover-attach"
                role="menu"
                aria-label={cp.attachMenu}
              >
                <button
                  type="button"
                  role="menuitem"
                  className={cn("composer-popover-row", "composer-attach-row", discussionOn && "is-disabled")}
                  aria-disabled={discussionOn}
                  title={discussionOn ? cp.imageNeedsSingleModel : cp.attachImageDesc}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (discussionOn) {
                      say(cp.imageNeedsSingleModel);
                      return;
                    }
                    setOpenMenu(null);
                    imageRef.current?.click();
                  }}
                >
                  <span className="composer-popover-icon" aria-hidden="true">
                    <ImageIcon size={15} />
                  </span>
                  <span className="composer-popover-copy">
                    <span className="composer-popover-name">{cp.attachImage}</span>
                    <span className="composer-popover-desc">{cp.attachImageDesc}</span>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="composer-popover-row composer-attach-row"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setOpenMenu(null);
                    attachRef.current?.click();
                  }}
                >
                  <span className="composer-popover-icon" aria-hidden="true">
                    <FileText size={15} />
                  </span>
                  <span className="composer-popover-copy">
                    <span className="composer-popover-name">{cp.attachFile}</span>
                    <span className="composer-popover-desc">{cp.attachFileDesc}</span>
                  </span>
                </button>
              </div>
            ) : null}
          </div>
          <input
            ref={attachRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="composer-file-input"
            onChange={onFilePick}
            tabIndex={-1}
          />
          <input
            ref={imageRef}
            type="file"
            multiple
            accept={IMAGE_ACCEPT}
            className="composer-file-input"
            onChange={onImagePick}
            tabIndex={-1}
          />
          <SearchControl
            mode={webSearchMode}
            open={openMenu === "search"}
            locale={locale}
            onChangeMode={pickSearchMode}
            onToggleMenu={() => setOpenMenu((current) => (current === "search" ? null : "search"))}
          />
          <button
            type="button"
            className={cn(
              "composer-icon-button",
              "composer-discussion-toggle",
              discussionOn && "is-active"
            )}
            aria-pressed={discussionOn}
            aria-label={discussionOn ? cp.discussionOn : cp.discussionOff}
            title={discussionOn ? cp.discussionOn : cp.discussionOff}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setOpenMenu(null);
              if (hasImages) {
                say(cp.imageNeedsSingleModel);
                return;
              }
              onToggleDiscussion();
              focusTextarea();
            }}
          >
            <UsersRound size={16} aria-hidden="true" />
          </button>
          <ModelPicker
            mode={modelMode}
            options={modelOptions}
            providerOptions={providerModelOptions}
            value={modelValue}
            open={openMenu === "model"}
            locale={locale}
            onChange={pickModel}
            onToggleMenu={() => setOpenMenu((current) => (current === "model" ? null : "model"))}
          />
        </div>
        <div className="composer-toolbar-group">
          {dictation.supported ? (
            <button
              type="button"
              className={cn("composer-icon-button", dictation.listening && "is-active")}
              aria-pressed={dictation.listening}
              aria-label={dictation.listening ? cp.dictateStop : cp.dictate}
              title={dictation.listening ? cp.dictateStop : cp.dictate}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
            >
              <Mic size={15} aria-hidden="true" />
            </button>
          ) : null}
          <button
            className={cn(
              "send-button",
              paused && pauseFlash && "send-button-pause-flash",
              paused && !pauseFlash && "send-button-paused"
            )}
            onMouseDown={(event) => event.preventDefault()}
            onClick={paused ? undefined : loading ? onPause : canSend ? submit : undefined}
            disabled={paused || (!loading && !canSend)}
            type="button"
            aria-label={loading ? copy.stop : readingFiles ? cp.attachmentReading : copy.send}
            title={loading ? copy.stop : readingFiles ? cp.attachmentReading : copy.send}
          >
            {paused ? (
              <span className="pause-status-text">{copy.paused}</span>
            ) : loading ? (
              <CircleStop size={15} aria-hidden="true" />
            ) : (
              <SendHorizontal size={16} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {hint ? (
        <div className="composer-hint" role="status">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
