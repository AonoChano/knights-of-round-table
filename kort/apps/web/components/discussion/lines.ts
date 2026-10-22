import type { DialogueLine, DiscussionMessage, Participant } from './types';

const MAX_SPEAK_CHARS = 260;
/** 只在句子或段落边界收口，避免把 Markdown 标记、公式和代码围栏截成半截 */
const SPEAK_BREAKS = ['\n\n', '。', '！', '？', '；', '. ', '! ', '? ', '; ', '\n'];

function cutAtBoundary(text: string, limit: number): string {
  const head = text.slice(0, limit);
  let cut = -1;
  for (const mark of SPEAK_BREAKS) {
    cut = Math.max(cut, head.lastIndexOf(mark) + mark.length - 1);
  }
  return cut > limit * 0.5 ? head.slice(0, cut + 1).trimEnd() : head;
}

/** 长分析只取开场几句，气泡负责“说出来”，完整记录留给讨论记录面板 */
export function toSpeech(text: string): string {
  const flat = text.trim();
  if (flat.length <= MAX_SPEAK_CHARS) return flat;
  return `${cutAtBoundary(flat, MAX_SPEAK_CHARS)}…`;
}

function reactionsFor(
  message: DiscussionMessage,
  cast: Participant[]
): Record<string, 'reacting' | 'thinking'> | undefined {
  if (message.role !== 'critic') return undefined;
  const map: Record<string, 'reacting' | 'thinking'> = {};
  for (const seat of cast) {
    if (seat.id !== message.speaker) map[seat.id] = 'thinking';
  }
  return Object.keys(map).length ? map : undefined;
}

const ABSENT_UTTERANCE =
  /^\[[^\]]{0,60}(?:was unavailable|review unavailable|had no valid provider|encountered an unexpected error)\]$/;

/** 后端调用失败时给出的占位发言：桌面上留一把空椅子，而不是念占位符 */
export function isAbsentUtterance(text: string): boolean {
  return ABSENT_UTTERANCE.test(text.trim());
}

export function toDialogueLines(messages: DiscussionMessage[], cast: Participant[]): DialogueLine[] {
  return messages.map((message) => {
    const absent = isAbsentUtterance(message.text);
    return {
      speaker: message.speaker,
      text: absent ? '' : toSpeech(message.text),
      round: message.round,
      absent,
      reactions: absent ? undefined : reactionsFor(message, cast),
    };
  });
}

/** 没有 delegation 元数据时（例如旧会话），从发言反推席位 */
export function seedsFromMessages(messages: DiscussionMessage[]) {
  const seen = new Map<string, { name: string; nickname: string; role: string }>();
  for (const message of messages) {
    if (!seen.has(message.speaker)) {
      seen.set(message.speaker, {
        name: message.speaker,
        nickname: message.nickname,
        role: message.role,
      });
    }
  }
  return [...seen.values()];
}
