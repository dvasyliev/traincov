/** `14:35:00` → `14:35`; години ≥ 24 лишаємо як є (рейс перетинає північ). */
export function formatTime(time: string | null): string {
  return time ? time.slice(0, 5) : '—';
}

/** `407.8` → `408 км` — на картках дробові десятки не потрібні. */
export function formatKm(km: number): string {
  return `${Math.round(km)} км`;
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
