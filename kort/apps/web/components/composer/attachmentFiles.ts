export type AttachmentKind = "text" | "image" | "other";

export type AttachmentPick = {
  name: string;
  mime: string;
  bytes: number;
  kind: AttachmentKind;
};

export type AttachmentRead = AttachmentPick & {
  text: string;
  chars: number;
  truncated: boolean;
  undecodable: boolean;
};

export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 512 * 1024;
export const MAX_ATTACHMENT_CHARS = 20_000;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "env",
  "log", "xml", "html", "htm", "css", "sql", "py", "js", "jsx", "ts", "tsx", "go", "rs", "java",
  "c", "h", "cpp", "hpp", "sh", "bash", "rb", "php", "swift", "kt", "tex", "srt", "vtt",
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif"]);

function extension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function kindOf(file: File): AttachmentKind {
  if (file.type.startsWith("image/") && file.type !== "image/svg+xml") return "image";
  if (file.type.startsWith("text/")) return "text";
  const ext = extension(file.name);
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "other";
}

export const ATTACHMENT_ACCEPT = [...TEXT_EXTENSIONS].map((ext) => `.${ext}`).join(",");

/**
 * Read a file as UTF-8 text with real progress, stopping once the character
 * budget is spent so a huge log never blocks the composer.
 */
export async function readTextFile(
  file: File,
  onProgress: (fraction: number) => void
): Promise<AttachmentRead> {
  const pick: AttachmentPick = {
    name: file.name.slice(0, 120),
    mime: file.type || "",
    bytes: file.size,
    kind: kindOf(file),
  };
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const reader = file.stream().getReader();
  let text = "";
  let readBytes = 0;
  let truncated = false;
  let replacement = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    readBytes += value?.byteLength ?? 0;
    onProgress(file.size > 0 ? Math.min(1, readBytes / file.size) : 1);
    if (text.length >= MAX_ATTACHMENT_CHARS) {
      truncated = true;
      void reader.cancel();
      break;
    }
    const chunk = decoder.decode(value ?? new Uint8Array(), { stream: true });
    replacement += (chunk.match(/\uFFFD/g) ?? []).length;
    text += chunk;
  }
  if (text.length > MAX_ATTACHMENT_CHARS) {
    text = text.slice(0, MAX_ATTACHMENT_CHARS);
    truncated = true;
  }
  onProgress(1);
  return {
    ...pick,
    text,
    chars: text.length,
    truncated,
    /* a run of replacement chars means the bytes were not UTF-8 at all */
    undecodable: text.length > 0 && replacement / text.length > 0.03,
  };
}
