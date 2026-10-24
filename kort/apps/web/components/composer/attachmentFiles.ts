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

export type ImageAttachmentRead = {
  name: string;
  mime: string;
  bytes: number;
  kind: "image";
  data: string;
  width: number;
  height: number;
};

export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 512 * 1024;
export const MAX_ATTACHMENT_CHARS = 20_000;
export const MAX_IMAGE_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;
const IMAGE_QUALITY = 0.86;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "env",
  "log", "xml", "html", "htm", "css", "sql", "py", "js", "jsx", "ts", "tsx", "go", "rs", "java",
  "c", "h", "cpp", "hpp", "sh", "bash", "rb", "php", "swift", "kt", "tex", "srt", "vtt",
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);

function extension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function kindOf(file: File): AttachmentKind {
  if (file.type === "image/svg+xml" || extension(file.name) === "svg") return "other";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("text/")) return "text";
  const ext = extension(file.name);
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "other";
}

export const ATTACHMENT_ACCEPT = [...TEXT_EXTENSIONS].map((ext) => `.${ext}`).join(",");
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif";

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

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to the <img> path, e.g. formats the bitmap decoder skips */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Normalise any picked raster image to a bounded JPEG data URL so the request body,
 * the conversation file and every provider see the same compact payload.
 */
export async function readImageFile(file: File): Promise<ImageAttachmentRead> {
  const source = await decodeImage(file);
  const sourceWidth = "width" in source ? source.width : 0;
  const sourceHeight = "height" in source ? source.height : 0;
  if (!sourceWidth || !sourceHeight) throw new Error("image has no pixels");
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas is unavailable");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  if ("close" in source) source.close();
  const mime = "image/jpeg";
  const data = canvas.toDataURL(mime, IMAGE_QUALITY);
  const base64 = data.slice(data.indexOf(",") + 1);
  return {
    kind: "image",
    name: file.name.slice(0, 120) || "image.jpg",
    mime,
    bytes: Math.round((base64.length * 3) / 4),
    data,
    width,
    height,
  };
}
