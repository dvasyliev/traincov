/**
 * Віддати файл користувачу: share sheet, де він є, і звичайне завантаження, де немає.
 *
 * Пастка iOS: `navigator.share` вимагає жест користувача, а «транзитна
 * активація» живе лічені секунди. Тому дані для експорту готуються заздалегідь
 * (екран логера тримає заміри обраної сесії в пам'яті), а сюди приходить
 * готовий об'єкт — між тапом і викликом share не має бути жодного await.
 */

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

function download(file: File): ShareOutcome {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Одразу revoke ламає завантаження в частині браузерів — даємо їм дочитати блоб.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}

export async function shareJson(fileName: string, payload: unknown): Promise<ShareOutcome> {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const file = new File([blob], fileName, { type: 'application/json' });

  // Web Share Level 2 (файли) немає ні в Firefox, ні в старших Safari — там одразу download.
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return 'shared';
    } catch (err) {
      // AbortError — користувач закрив шит; підсовувати йому ще й завантаження
      // після цього було б грубо.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Решта (NotAllowedError на десктопі, share без файлів) — тихо в download.
    }
  }

  return download(file);
}
