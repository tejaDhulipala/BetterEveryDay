import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('bettereveryday.db');

db.execSync(`
  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    color       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 1
  );
`);

db.execSync(`
  CREATE TABLE IF NOT EXISTS entries (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    date           TEXT    NOT NULL,
    tracking_date  TEXT    NOT NULL,
    category_id    INTEGER NOT NULL REFERENCES categories(id),
    description    TEXT    NOT NULL DEFAULT '',
    start_ms       INTEGER NOT NULL,
    end_ms         INTEGER NOT NULL,
    elapsed_ms     INTEGER NOT NULL
  );
`);

export interface CategoryRow {
  id: number;
  name: string;
  color: string;
  description: string;
  is_active: number;
}

export interface Entry {
  categoryId: number;
  description: string;
  startMs: number;
  endMs: number;
  elapsedMs: number;
}

export interface EntryRow {
  id: number;
  date: string;
  tracking_date: string;
  category_id: number;
  category_name: string;
  category_color: string;
  description: string;
  start_ms: number;
  end_ms: number;
  elapsed_ms: number;
}

function toDateString(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const TRACKING_CUTOFF_MS = (4 * 60 + 30) * 60 * 1000; // 4:30 AM

function toTrackingDateString(ms: number): string {
  const d = new Date(ms);
  const msFromMidnight = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) * 1000;
  return toDateString(msFromMidnight < TRACKING_CUTOFF_MS ? ms - 86400000 : ms);
}

export function getCategories(): CategoryRow[] {
  return db.getAllSync<CategoryRow>(
    'SELECT * FROM categories WHERE is_active = 1 ORDER BY id ASC',
  );
}

export function insertCategory(name: string, color: string, description: string): number {
  const result = db.runSync(
    'INSERT INTO categories (name, color, description) VALUES (?, ?, ?)',
    name, color, description,
  );
  return result.lastInsertRowId;
}

export function updateCategory(id: number, name: string, description: string): void {
  db.runSync(
    'UPDATE categories SET name=?, description=? WHERE id=?',
    name, description, id,
  );
}

export function deactivateCategory(id: number): void {
  db.runSync('UPDATE categories SET is_active=0 WHERE id=?', id);
}

export function saveEntry(entry: Entry): void {
  db.runSync(
    'INSERT INTO entries (date, tracking_date, category_id, description, start_ms, end_ms, elapsed_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
    toDateString(entry.startMs),
    toTrackingDateString(entry.startMs),
    entry.categoryId,
    entry.description,
    entry.startMs,
    entry.endMs,
    entry.elapsedMs,
  );
}

const ENTRY_SELECT = `
  SELECT e.id, e.date, e.tracking_date, e.category_id,
    c.name  AS category_name,
    c.color AS category_color,
    e.description, e.start_ms, e.end_ms, e.elapsed_ms
  FROM entries e
  JOIN categories c ON e.category_id = c.id
`;

export function getEntriesByDate(date: string): EntryRow[] {
  return db.getAllSync<EntryRow>(
    `${ENTRY_SELECT} WHERE e.date = ? ORDER BY e.start_ms ASC`,
    date,
  );
}

export function getEntriesByTrackingDate(date: string): EntryRow[] {
  return db.getAllSync<EntryRow>(
    `${ENTRY_SELECT} WHERE e.tracking_date = ? ORDER BY e.start_ms ASC`,
    date,
  );
}

export function getEntriesForTrackingDateRange(startDate: string, endDate: string): EntryRow[] {
  return db.getAllSync<EntryRow>(
    `${ENTRY_SELECT} WHERE e.tracking_date >= ? AND e.tracking_date <= ? ORDER BY e.start_ms ASC`,
    startDate,
    endDate,
  );
}

export function getAllEntries(): EntryRow[] {
  return db.getAllSync<EntryRow>(`${ENTRY_SELECT} ORDER BY e.start_ms DESC`);
}

export function updateEntry(id: number, startMs: number, endMs: number, description: string): void {
  db.runSync(
    'UPDATE entries SET start_ms=?, end_ms=?, elapsed_ms=?, date=?, tracking_date=?, description=? WHERE id=?',
    startMs,
    endMs,
    endMs - startMs,
    toDateString(startMs),
    toTrackingDateString(startMs),
    description,
    id,
  );
}

export function deleteEntry(id: number): void {
  db.runSync('DELETE FROM entries WHERE id=?', id);
}
