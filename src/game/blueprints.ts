import { isWarheadPart } from "./balance";
import type { WarheadPartId } from "./types";

/**
 * Known blueprints: parts a pilot has taken to Tier III in any earlier run.
 * This is a profile record, kept apart from the run save (run-save.ts), so a
 * finished or abandoned run never removes it. Known parts appear twice as often
 * in later blueprint offers; Daily Flare runs ignore them.
 */
const KEY = "helios-blueprints-v1";

export function loadKnownBlueprints(): WarheadPartId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const list: unknown[] = Array.isArray(raw?.known) ? raw.known : [];
    return [...new Set(list.filter(isWarheadPart))];
  } catch {
    return [];
  }
}

export function addKnownBlueprint(id: WarheadPartId) {
  try {
    const known = loadKnownBlueprints();
    if (known.includes(id)) return;
    localStorage.setItem(KEY, JSON.stringify({ version: 1, known: [...known, id] }));
  } catch {
    /* storage unavailable: the blueprint is simply not remembered */
  }
}
