/**
 * Крок 8.6: ручний цикл покращення даних.
 *
 *   1. Проїхав маршрут → експортував JSON з екрана «Логер».
 *   2. `npm run analyze -- traincov-….json` — цей скрипт групує мертві заміри
 *      в кластери по км і друкує готові сніпети для `manual-zones.json`.
 *   3. Вставив у manual-zones → `npm run pipeline` → зони оновилися для всіх.
 *
 * Це краудсорсинг з одного користувача: повний цикл продукту працює вже в MVP,
 * просто вручну.
 *
 * Схему експорту скрипт не імпортує з `src/core/measurements.ts`, а перевіряє
 * на вході: файл приходить ззовні, і довіряти йому на слово не можна.
 */
import { readFile } from 'node:fs/promises';

/** Розрив між сусідніми мертвими замірами, більший за який — це вже дві різні діри. */
const DEFAULT_GAP_KM = 0.8;
/** Одиничний фейл — це чхнув probe, а не мертва зона. */
const DEFAULT_MIN_COUNT = 2;
/** Схема, яку вміє читати цей скрипт (`LOG_SCHEMA` в src/core/measurements.ts). */
const SUPPORTED_SCHEMA = 1;

interface ExportedMeasurement {
  ts: number;
  routeKm: number | null;
  kmEstimated?: boolean;
  probeOk: boolean;
  probeRttMs: number | null;
  inZoneId?: string | null;
}

interface ExportedZone {
  id: string;
  fromKm: number;
  toKm: number;
  severity: string;
}

interface ExportedSession {
  id: string;
  tripId: string;
  tripName: string;
  carrier: string;
  operator: string | null;
  startedAt: number;
  lengthKm: number;
  zones: ExportedZone[];
  simulated: boolean;
}

interface SessionFile {
  schema: number;
  session: ExportedSession;
  measurements: ExportedMeasurement[];
}

interface Cluster {
  fromKm: number;
  toKm: number;
  /** Скільки мертвих замірів у кластері. */
  count: number;
  /** Скільки з них без GPS (dead reckoning) — це і є «справжній тунель». */
  estimated: number;
  /** Прогнозовані зони, з якими кластер перетинається. */
  matched: ExportedZone[];
}

function fail(message: string): never {
  console.error(`[analyze] ✖ ${message}`);
  process.exit(1);
}

function numberArg(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const value = Number(process.argv[i + 1]);
  if (!Number.isFinite(value) || value <= 0) fail(`${flag} очікує додатне число`);
  return value;
}

function parseFile(raw: string): SessionFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('файл не парситься як JSON');
  }
  const file = parsed as Partial<SessionFile>;
  if (file?.schema !== SUPPORTED_SCHEMA) {
    fail(`очікується schema: ${SUPPORTED_SCHEMA}, у файлі — ${String(file?.schema)}`);
  }
  if (!file.session || !Array.isArray(file.measurements)) {
    fail('у файлі немає session або measurements');
  }
  return file as SessionFile;
}

/**
 * Мертві заміри → кластери по км.
 *
 * Межі кластера розсуваються до середини між крайнім мертвим і найближчим живим
 * заміром: діра почалася десь у тій прогалині, і чесніше вважати її серединою,
 * ніж малювати зону рівно по точках, де ми випадково встигли поміряти.
 */
export function clusterDead(
  measurements: ExportedMeasurement[],
  zones: ExportedZone[],
  gapKm: number,
  minCount: number,
): Cluster[] {
  const located = measurements
    .filter((m) => typeof m.routeKm === 'number' && Number.isFinite(m.routeKm))
    .sort((a, b) => (a.routeKm as number) - (b.routeKm as number));

  const clusters: Cluster[] = [];
  let current: { from: number; to: number; count: number; estimated: number } | null = null;

  const flush = () => {
    if (!current) return;
    if (current.count >= minCount) {
      clusters.push({
        fromKm: current.from,
        toKm: current.to,
        count: current.count,
        estimated: current.estimated,
        matched: [],
      });
    }
    current = null;
  };

  for (const m of located) {
    const km = m.routeKm as number;
    if (m.probeOk) {
      // Живий замір усередині кластера рве його, тільки якщо кластер уже є.
      if (current && km - current.to > 0) flush();
      continue;
    }
    if (current && km - current.to <= gapKm) {
      current.to = km;
      current.count += 1;
      if (m.kmEstimated) current.estimated += 1;
    } else {
      flush();
      current = { from: km, to: km, count: 1, estimated: m.kmEstimated ? 1 : 0 };
    }
  }
  flush();

  // Розсування меж до середини прогалини + зіставлення з прогнозом.
  const alive = located.filter((m) => m.probeOk).map((m) => m.routeKm as number);
  for (const cluster of clusters) {
    const before = alive.filter((km) => km < cluster.fromKm).pop();
    const after = alive.find((km) => km > cluster.toKm);
    if (before !== undefined) cluster.fromKm = (before + cluster.fromKm) / 2;
    if (after !== undefined) cluster.toKm = (cluster.toKm + after) / 2;
    cluster.matched = zones.filter((z) => z.fromKm <= cluster.toKm && z.toKm >= cluster.fromKm);
  }

  return clusters;
}

/**
 * `IC 6148/9 Oleńka Wrocław Główny → Warszawa Wschodnia`
 *   → `["IC 6148/9", "→ Warszawa Wschodnia"]`.
 *
 * Км у manual-zones — це км конкретного бандла, тому match зобов'язаний
 * зафіксувати напрямок. Номер потяга робить це надійніше за станцію
 * відправлення: у назві між номером і станцією ще стоїть ім'я потяга
 * («Oleńka»), і відрізати його від назви станції загальним правилом не вийде.
 */
export function tripNameContains(name: string): string[] {
  const [left = '', right = ''] = name.split('→');
  const train = /^\s*([A-ZĄĆĘŁŃÓŚŹŻ]{1,4}\s+[\d/]+)/.exec(left)?.[1];
  const destination = right.trim();
  if (!destination) return [name.trim()];
  const arrow = `→ ${destination}`;
  return train ? [train, arrow] : [left.trim(), arrow];
}

const round1 = (km: number) => Number(km.toFixed(1));

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.log('Використання: npm run analyze -- <file.json> [--gap 0.8] [--min 2]');
    process.exit(file ? 1 : 0);
  }

  const gapKm = numberArg('--gap', DEFAULT_GAP_KM);
  const minCount = numberArg('--min', DEFAULT_MIN_COUNT);

  const { session, measurements } = parseFile(await readFile(file, 'utf8').catch(() => fail(`не читається: ${file}`)));

  const dead = measurements.filter((m) => !m.probeOk).length;
  const located = measurements.filter((m) => m.routeKm !== null).length;

  console.log(`[analyze] ${session.tripName}`);
  console.log(
    `[analyze] ${new Date(session.startedAt).toISOString()} · оператор: ${session.operator ?? '—'} · довжина ${round1(session.lengthKm)} км`,
  );
  console.log(
    `[analyze] замірів: ${measurements.length} (з км: ${located}, dead: ${dead}) · прогнозованих зон: ${session.zones.length}`,
  );
  if (session.simulated) {
    console.log('[analyze] ⚠ сесія з симулятора (?sim=1) — у manual-zones.json такі дані НЕ несемо');
  }

  const clusters = clusterDead(measurements, session.zones, gapKm, minCount);
  if (!clusters.length) {
    console.log(`[analyze] кластерів немає (gap ${gapKm} км, мінімум ${minCount} замірів підряд)`);
    return;
  }

  console.log(`\n[analyze] кластери мертвих замірів (gap ${gapKm} км, мінімум ${minCount}):`);
  for (const c of clusters) {
    const known = c.matched.length
      ? `збігається з прогнозом (${c.matched.map((z) => z.id).join(', ')})`
      : 'НОВА — кандидат у manual-zones.json';
    console.log(
      `  ${round1(c.fromKm)}–${round1(c.toKm)} км · ${c.count} замірів (без GPS: ${c.estimated}) · ${known}`,
    );
  }

  const candidates = clusters.filter((c) => !c.matched.length);
  if (!candidates.length) {
    console.log('\n[analyze] нових зон немає: усе, що впало, вже є в пайплайні.');
    return;
  }

  const rule = {
    match: { tripNameContains: tripNameContains(session.tripName) },
    zones: candidates.map((c) => ({
      fromKm: round1(c.fromKm),
      toKm: round1(c.toKm),
      severity: 'none',
      note: `лог ${new Date(session.startedAt).toISOString().slice(0, 10)}, ${c.count} замірів dead${session.operator ? `, ${session.operator}` : ''}`,
    })),
  };

  console.log('\n[analyze] сніпет для scripts/pipeline/manual-zones.json → rules[]:\n');
  console.log(JSON.stringify(rule, null, 2));
  console.log('\n[analyze] перевір km і напрямок у match, потім `npm run pipeline`.');
}

// Імпорт із тесту не має запускати CLI.
if (process.argv[1]?.endsWith('analyze-session.ts')) {
  await main();
}
