import type { DialogueLine, DiscussionMessage, Participant } from './types';

const SENTENCE_SPLIT = /([。！？?!；;]\s*|\.\s+|\?\s+|!\s+)/;
const MAX_SPEAK_CHARS = 168;

function clean(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 长分析只取开场几句，气泡负责“说出来”，完整记录留给讨论记录面板 */
export function toSpeech(text: string): string {
  const flat = clean(text);
  if (!flat) return '';
  if (flat.length <= MAX_SPEAK_CHARS) return flat;

  const parts = flat.split(SENTENCE_SPLIT);
  let spoken = '';
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = `${parts[i] ?? ''}${parts[i + 1] ?? ''}`;
    if (!sentence.trim()) continue;
    if ((spoken + sentence).length > MAX_SPEAK_CHARS) break;
    spoken += sentence;
  }
  if (!spoken.trim()) spoken = flat.slice(0, MAX_SPEAK_CHARS);
  return `${spoken.trim()}…`;
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
