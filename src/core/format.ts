/** `14:35:00` → `14:35`; години ≥ 24 лишаємо як є (рейс перетинає північ). */
export function formatTime(time: string | null): string {
  return time ? time.slice(0, 5) : '—';
}

/** `407.8` → `408 км` — на картках дробові десятки не потрібні. */
export function formatKm(km: number): string {
  return `${Math.round(km)} км`;
}

/** `45.72` → `45.7` — у дорозі десята частка км уже щось значить. */
export function formatKm1(km: number): string {
  return km.toFixed(1);
}

/** `1754220000000` → `15:42` у локальному часі телефона. */
export function formatClock(epoch: number | null): string {
  if (epoch === null || !Number.isFinite(epoch)) return '—';
  const d = new Date(epoch);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Зворотний відлік. До години — `4:20` (секунди в дорозі важливі: діра близько),
 * далі — `1 год 12 хв`, бо секунди там усе одно нічого не означають.
 */
export function formatCountdown(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} год ${m} хв`;
  return `${m}:${String(total % 60).padStart(2, '0')}`;
}

/** Тривалість «крупними мазками»: `~7 хв`. Менше хвилини — `<1 хв`. */
export function formatMinutes(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 60_000) return '<1 хв';
  return `${Math.round(ms / 60_000)} хв`;
}

/**
 * Нормалізація для пошуку: діакритика геть, нижній регістр.
 * «wroclaw» має знаходити «Wrocław», «gdansk» — «Gdańsk».
 */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase();
}
