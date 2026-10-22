import { Plug } from "lucide-react";
import {
  siAlibabacloud,
  siAnthropic,
  siBaidu,
  siClaude,
  siClaudecode,
  siDeepseek,
  siGooglegemini,
  siMinimax,
  siMistralai,
  siMoonshotai,
  siOllama,
  siOpenrouter,
  siPerplexity,
  siQwen,
  siXiaomi,
  type SimpleIcon,
} from "simple-icons";

import type { CatalogProvider, ProviderIconKind } from "./catalog";
import { catalogFor } from "./managed";
import type { ProviderProfile } from "./types";

const BRAND_ICONS: Record<string, SimpleIcon> = {
  alibabacloud: siAlibabacloud,
  anthropic: siAnthropic,
  baidu: siBaidu,
  claude: siClaude,
  claudecode: siClaudecode,
  deepseek: siDeepseek,
  googlegemini: siGooglegemini,
  minimax: siMinimax,
  mistralai: siMistralai,
  moonshotai: siMoonshotai,
  ollama: siOllama,
  openrouter: siOpenrouter,
  perplexity: siPerplexity,
  qwen: siQwen,
  xiaomi: siXiaomi,
};

/** Names simple-icons no longer ships, matched by keyword so older profiles keep their mark. */
const KEYWORD_ICONS: Array<{ match: RegExp; icon: ProviderIconKind; color: string }> = [
  { match: /claude[- ]?code/, icon: { kind: "brand", key: "claudecode" }, color: "#D97757" },
  { match: /claude/, icon: { kind: "brand", key: "claude" }, color: "#D97757" },
  { match: /anthropic/, icon: { kind: "brand", key: "anthropic" }, color: "#191919" },
  { match: /gemini|google/, icon: { kind: "brand", key: "googlegemini" }, color: "#4285F4" },
  { match: /mistral/, icon: { kind: "brand", key: "mistralai" }, color: "#FA5300" },
  { match: /perplexity/, icon: { kind: "brand", key: "perplexity" }, color: "#20B8CD" },
  { match: /baidu|ernie/, icon: { kind: "brand", key: "baidu" }, color: "#2932E1" },
  { match: /ollama|local/, icon: { kind: "brand", key: "ollama" }, color: "#1C1C1C" },
  { match: /openrouter/, icon: { kind: "brand", key: "openrouter" }, color: "#76A9C4" },
  { match: /minimax/, icon: { kind: "brand", key: "minimax" }, color: "#E73562" },
  { match: /deepseek/, icon: { kind: "brand", key: "deepseek" }, color: "#5786FE" },
  { match: /moonshot|kimi/, icon: { kind: "brand", key: "moonshotai" }, color: "#000000" },
  { match: /qwen|alibaba|bailian|dashscope|qianwen/, icon: { kind: "brand", key: "qwen" }, color: "#6950EF" },
  { match: /xiaomi|mimo/, icon: { kind: "brand", key: "xiaomi" }, color: "#FF6900" },
  { match: /openai|gpt|chatgpt/, icon: { kind: "monogram", char: "AI" }, color: "#0F1115" },
];

type IconSpec = { icon: ProviderIconKind; color: string };

function catalogIconSpec(provider: CatalogProvider): IconSpec {
  return { icon: provider.icon, color: provider.color };
}

function profileIconSpec(provider: ProviderProfile): IconSpec {
  const catalog = catalogFor(provider);
  if (catalog) return catalogIconSpec(catalog);

  const haystack = `${provider.provider_id} ${provider.provider_type} ${provider.label}`.toLowerCase();
  const keyword = KEYWORD_ICONS.find((entry) => entry.match.test(haystack));
  if (keyword) return keyword;

  return { icon: { kind: "monogram", char: initials(provider.label || provider.provider_id) }, color: "#6B6B63" };
}

function initials(value: string): string {
  const letters = value.replace(/[^\p{L}\p{N}]/gu, " ").trim();
  if (!letters) return "?";
  if (/[\u3400-\u9FFF]/u.test(letters)) return letters.slice(0, 1);
  return letters
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function IconTile({
  icon,
  color,
  size = 30,
  className = "",
}: {
  icon: ProviderIconKind;
  color: string;
  size?: number;
  className?: string;
}) {
  const glyph = Math.round(size * 0.6);

  if (icon.kind === "brand") {
    const brand = BRAND_ICONS[icon.key];
    if (brand) {
      return (
        <span
          className={`provider-icon provider-icon-brand ${className}`}
          style={{ width: size, height: size, color }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" width={glyph} height={glyph} focusable="false">
            <path fill="currentColor" d={brand.path} />
          </svg>
        </span>
      );
    }
  }

  if (icon.kind === "monogram") {
    return (
      <span
        className={`provider-icon provider-icon-monogram ${className}`}
        style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.42) }}
        aria-hidden="true"
      >
        {icon.char}
      </span>
    );
  }

  return (
    <span className={`provider-icon provider-icon-generic ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <Plug size={glyph} />
    </span>
  );
}

export function CatalogIcon({ provider, size = 30 }: { provider: CatalogProvider; size?: number }) {
  const spec = catalogIconSpec(provider);
  return <IconTile icon={spec.icon} color={spec.color} size={size} />;
}

export function ProfileIcon({
  provider,
  size = 30,
  className = "",
}: {
  provider: ProviderProfile;
  size?: number;
  className?: string;
}) {
  const spec = profileIconSpec(provider);
  return <IconTile icon={spec.icon} color={spec.color} size={size} className={className} />;
}
