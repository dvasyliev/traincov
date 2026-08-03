/**
 * Оператор у MVP — лише тег: карти покриття на оператора ще немає,
 * зони спільні. Значення потрібне для майбутніх замірів (задача 08).
 */
export const OPERATORS = [
  { id: 'orange', label: 'Orange' },
  { id: 'play', label: 'Play' },
  { id: 'plus', label: 'Plus' },
  { id: 't-mobile', label: 'T-Mobile' },
  { id: 'other', label: 'Інший' },
] as const;

export type OperatorId = (typeof OPERATORS)[number]['id'];

const IDS = new Set<string>(OPERATORS.map((o) => o.id));

/** Валідація значення з IndexedDB: схема налаштувань не типізована на рівні БД. */
export function isOperatorId(value: unknown): value is OperatorId {
  return typeof value === 'string' && IDS.has(value);
}

export function operatorLabel(id: OperatorId): string {
  return OPERATORS.find((o) => o.id === id)?.label ?? id;
}
