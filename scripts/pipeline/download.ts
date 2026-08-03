import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CACHE_DIR, CACHE_FILE, CACHE_TTL_MS, GTFS_URL } from './config.ts';

async function ageMs(file: string): Promise<number | null> {
  try {
    const s = await stat(file);
    return Date.now() - s.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Повертає шлях до zip у кеші, скачуючи його лише якщо файлу немає
 * або він старший за CACHE_TTL_MS. Завантаження — стрімом у .part,
 * щоб обірваний качок не залишив по собі биту «свіжу» копію.
 */
export async function ensureGtfs(force = false): Promise<string> {
  const dir = path.resolve(CACHE_DIR);
  const file = path.join(dir, CACHE_FILE);
  await mkdir(dir, { recursive: true });

  const age = await ageMs(file);
  if (!force && age !== null && age < CACHE_TTL_MS) {
    console.log(`[download] кеш свіжий (${Math.round(age / 3600_000)} год) → ${file}`);
    return file;
  }

  console.log(`[download] ${GTFS_URL} …`);
  const res = await fetch(GTFS_URL);
  if (!res.ok || !res.body) {
    if (age !== null) {
      console.warn(`[download] HTTP ${res.status}; працюємо на застарілому кеші`);
      return file;
    }
    throw new Error(`GTFS недоступний: HTTP ${res.status}`);
  }

  const part = `${file}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(part));
    await rename(part, file);
  } catch (err) {
    await unlink(part).catch(() => {});
    throw err;
  }

  const s = await stat(file);
  console.log(`[download] готово: ${(s.size / 1024 / 1024).toFixed(1)} МБ`);
  return file;
}
