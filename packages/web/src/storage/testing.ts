import { IDBFactory } from 'fake-indexeddb';
import { closeDb } from './db.ts';

/** Gives a test a clean, empty IndexedDB. */
export async function resetDb(): Promise<void> {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
}
