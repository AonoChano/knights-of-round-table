import type { ComponentType } from 'react';

/** 角色当前的动作状态 */
export type CharacterState = 'idle' | 'talking' | 'listening' | 'thinking' | 'reacting';

export type Facing = 'left' | 'right' | 'front';

export type ThemeMode = 'day' | 'night';

/**
 * 所有讨论者形象渲染器都会收到的 props。
 * 未来接入新形象时，只需实现一个接收这些 props 的组件，
 * 然后调用 registerCharacter('your-kind', YourComponent) 即可。
 */
export interface CharacterRenderProps {
  state: CharacterState;
  facing: Facing;
  /** 主色 */
  color: string;
  /** 饰品 id 列表，渲染器可自行解释 */
  accessories?: string[];
  theme: ThemeMode;
  /** 0-1 之间的随机种子，用于让动画错开 */
  seed: number;
  /** 渲染尺寸（px，宽度） */
  size: number;
}

export type CharacterRenderer = ComponentType<CharacterRenderProps>;

export interface CharacterDefinition {
  kind: string;
  displayName: string;
  renderer: CharacterRenderer;
  /** 宽高比（高 / 宽），用于排版 */
  aspect: number;
  /** 可选饰品清单，用于设置面板展示 */
  accessories?: { id: string; label: string }[];
}

/** 讨论参与者 */
export interface Participant {
  id: string;
  name: string;
  title: string;
  /** 对应注册表中的 kind，比如 'clawd' */
  kind: string;
  color: string;
  accessories?: string[];
  /** 座椅风格 */
  chair?: 'armchair' | 'wooden' | 'stool';
  chairColor?: string;
}

export interface DialogueLine {
  speaker: string;
  text: string;
  round: number;
  /** 该席位本轮没能给出内容（provider 失败等），只留空座位 */
  absent?: boolean;
  /** 其他人的反应 */
  reactions?: Record<string, 'reacting' | 'thinking'>;
  /** 说话人表情提示 */
  emote?: string;
}

/** 后端 discussion_message 事件（也用于历史轮次持久化数据） */
export interface DiscussionMessage {
  id: string;
  round: number;
  speaker: string;
  nickname: string;
  role: string;
  text: string;
}

export interface DiscussionParticipantSeed {
  name: string;
  nickname: string;
  role: string;
  model?: string;
}

export interface Discussion {
  topic: string;
  subtitle: string;
  participants: Participant[];
  lines: DialogueLine[];
}
