import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MemoryGraphStore } from "./memoryStore.js";

/**
 * File-backed graph store. Loads its state from a JSON file on construction and
 * persists on `save()`. Lets the CLI keep graph state across separate process
 * invocations (ingest in one command, connect in the next) without a database.
 */
export class FileGraphStore extends MemoryGraphStore {
  constructor(private readonly path: string) {
    super();
    if (existsSync(path)) {
      try {
        this.importState(JSON.parse(readFileSync(path, "utf8")));
      } catch {
        // Corrupt/empty file → start fresh.
      }
    }
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.exportState(), null, 2));
  }
}
