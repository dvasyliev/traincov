import { parse } from 'csv-parse';
import unzipper from 'unzipper';

export type GtfsRow = Record<string, string>;

/**
 * Стрімовий прохід по одному файлу всередині zip.
 * `stop_times.txt` — 40 МБ, `shapes.txt` — 76 МБ у розпакованому вигляді,
 * тому ніде не робимо readFile: колбек бачить рядок і вирішує, лишати його чи ні.
 *
 * `unzipper.Open.file` читає central directory, тому доступ до потрібного
 * ентрі — прямий, без прокручування всього архіву.
 */
export async function streamCsv(
  zipPath: string,
  entryName: string,
  onRow: (row: GtfsRow) => void,
): Promise<number> {
  const directory = await unzipper.Open.file(zipPath);
  const entry = directory.files.find((f) => f.path === entryName);
  if (!entry) throw new Error(`У ${zipPath} немає ${entryName}`);

  const parser = entry.stream().pipe(
    parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }),
  );

  let count = 0;
  for await (const row of parser) {
    onRow(row as GtfsRow);
    count++;
  }
  return count;
}

/** Для маленьких файлів (agency/routes/stops/calendar_dates/trips). */
export async function readCsv(zipPath: string, entryName: string): Promise<GtfsRow[]> {
  const rows: GtfsRow[] = [];
  await streamCsv(zipPath, entryName, (r) => rows.push(r));
  return rows;
}

/**
 * Нормалізація назви станції для матчингу:
 * регістр + діакритика геть, «ł» окремо (NFD її не розкладає),
 * пунктуація і кратні пробіли — в один пробіл.
 */
export function normalizeStopName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/gi, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * GTFS-час → секунди від опівночі доби відправлення.
 * `25:10:00` — це 01:10 наступного дня, тому ніякого Date тут бути не може.
 */
export function parseGtfsTime(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** `YYYYMMDD` → `YYYY-MM-DD`. */
export function isoDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** Локальна сьогоднішня дата у GTFS-форматі `YYYYMMDD`. */
export function todayYyyymmdd(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
}
