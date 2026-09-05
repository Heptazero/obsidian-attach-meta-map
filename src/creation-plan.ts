import type { TFile } from 'obsidian';
import type { MappingGroup } from './types';

export type CreateChange =
  | { kind: 'move'; from: string; to: string }
  | { kind: 'create-note'; path: string }
  | { kind: 'update-source'; notePath: string; link: string };

export interface CreatePlan {
  attachment: TFile;
  group: MappingGroup;
  mode: 'create' | 'auxiliary';
  changes: CreateChange[];
}

export function planWithChanges(
  attachment: TFile,
  group: MappingGroup,
  mode: CreatePlan['mode'],
  changes: CreateChange[],
): CreatePlan | null {
  return changes.length > 0 ? { attachment, group, mode, changes } : null;
}

export function sameChanges(left: CreateChange[], right: CreateChange[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
