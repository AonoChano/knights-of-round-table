import type { CharacterDefinition } from '../types';

const registry = new Map<string, CharacterDefinition>();

/** 注册一个新的讨论者形象 */
export function registerCharacter(def: CharacterDefinition) {
  registry.set(def.kind, def);
}

export function getCharacter(kind: string): CharacterDefinition | undefined {
  return registry.get(kind);
}

export function listCharacters(): CharacterDefinition[] {
  return [...registry.values()];
}
