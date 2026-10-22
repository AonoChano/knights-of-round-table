import { shade } from './characters/color';
import { seedsFromMessages } from './lines';
import type { DiscussionMessage, DiscussionParticipantSeed, Participant } from './types';

const PALETTE = ['#D97757', '#5B8DEF', '#5FB37A', '#9B7BD4', '#E8B84A', '#4FA3A5'];
const CHAIRS = ['armchair', 'wooden', 'stool'] as const;

const TABLE_ROLES = new Set(['expert', 'critic']);

function isCjk(text: string) {
  return /[\u4e00-\u9fff]/.test(text);
}

/** 名牌只放得下两三个字，取昵称前缀或英文首字母 */
export function seatShortName(seed: DiscussionParticipantSeed): string {
  const base = (seed.nickname || seed.name).trim();
  if (base.length <= 4) return base;
  if (isCjk(base)) return base.slice(0, 2);
  const initials = base
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return initials.slice(0, 3) || base.slice(0, 3);
}

function pickAccessory(seed: DiscussionParticipantSeed): string {
  const haystack = `${seed.nickname} ${seed.name}`.toLowerCase();
  if (/critic|review|评审|批评|质检/.test(haystack)) return 'glasses';
  if (/logic|逻辑|严谨/.test(haystack)) return 'gradcap';
  if (/research|研究|调查/.test(haystack)) return 'headphones';
  if (/creative|创意|灵感/.test(haystack)) return 'beret';
  return seed.role === 'critic' ? 'monocle' : 'cap';
}

/** 参与讨论的专家与评审；主持人和合成器不上桌 */
export function tableAgents(agents: DiscussionParticipantSeed[]): DiscussionParticipantSeed[] {
  return agents.filter((agent) => TABLE_ROLES.has(agent.role));
}

export function buildCast(seeds: DiscussionParticipantSeed[]): Participant[] {
  return tableAgents(seeds).map((agent, index) => {
    const color = PALETTE[index % PALETTE.length];
    return {
      id: agent.name,
      name: seatShortName(agent),
      title: agent.nickname,
      kind: 'clawd',
      color,
      accessories: [pickAccessory(agent)],
      chair: CHAIRS[index % CHAIRS.length],
      chairColor: shade(color, -0.45),
    };
  });
}

/** 委派元数据与真实发言可能不一致（例如只读环境变量的 provider 不会出现在委派里），席位取两者并集 */
export function castSeeds(
  agents: DiscussionParticipantSeed[],
  messages: DiscussionMessage[]
): DiscussionParticipantSeed[] {
  const seeds = tableAgents(agents);
  const seated = new Set(seeds.map((agent) => agent.name));
  for (const speaker of seedsFromMessages(messages)) {
    if (!seated.has(speaker.name)) seeds.push(speaker);
  }
  return seeds;
}
