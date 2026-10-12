/** A relation resolved while both sides still existed; never guessed from names. */
export interface DeletionNote {
  path: string;
  managed: boolean;
  links: { target: string; path: string | null }[];
}

export type DeletionChange =
  | { kind: 'trash'; path: string }
  | { kind: 'unlink'; path: string; targets: string[] };

export interface DeletionPlan {
  origin: string;
  direction: 'resourceToNote' | 'noteToResources';
  changes: DeletionChange[];
  shared: string[];
}

/** Only managed notes can trigger a cascade; every note protects shared resources. */
export function planDeletion(
  origin: string,
  direction: DeletionPlan['direction'],
  notes: DeletionNote[],
  deletedNote?: DeletionNote,
): DeletionPlan {
  const changes: DeletionChange[] = [];
  const shared: string[] = [];
  if (direction === 'noteToResources') {
    if (deletedNote?.managed) {
      const paths = [...new Set(deletedNote.links.map(link => link.path)
        .filter((path): path is string => path !== null))];
      for (const path of paths) {
        if (notes.some(note => note.links.some(link => link.path === path))) shared.push(path);
        else changes.push({ kind: 'trash', path });
      }
    }
  } else {
    for (const note of notes) {
      if (!note.managed) continue;
      const removed = note.links.filter(link => link.path === origin);
      if (removed.length === 0) continue;
      if (removed.length === note.links.length) changes.push({ kind: 'trash', path: note.path });
      else changes.push({ kind: 'unlink', path: note.path, targets: removed.map(link => link.target) });
    }
  }
  changes.sort((a, b) => a.path.localeCompare(b.path));
  shared.sort();
  return { origin, direction, changes, shared };
}
