export type Screen = 'home' | 'trip' | 'log';

export const SCREENS: { id: Screen; label: string; icon: string }[] = [
  { id: 'home', label: 'Рейс', icon: '🚆' },
  { id: 'trip', label: 'Дорога', icon: '🗺️' },
  { id: 'log', label: 'Логер', icon: '📶' },
];
