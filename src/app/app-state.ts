import { createContext, useContext } from 'react';
import type { RouteBundle, TripIndexEntry } from '../core/types';
import type { OperatorId } from '../core/operators';
import type { Screen } from './screens';

export interface AppState {
  /** Поки `false`, ще читаємо IndexedDB — Home не має блимати порожнім станом. */
  hydrated: boolean;
  operator: OperatorId | null;
  /** Обраний рейс; переживає перезапуск (settings.lastTripId + бандл із Dexie). */
  currentTrip: RouteBundle | null;
  screen: Screen;
  /** tripId усіх бандлів у Dexie — бейдж «збережено» і робота офлайн. */
  savedTripIds: string[];
  /** tripId рейсу, який зараз завантажується (індикатор на картці). */
  loadingTripId: string | null;
  toast: string | null;
}

export type AppAction =
  | { type: 'hydrated'; operator: OperatorId | null; trip: RouteBundle | null; saved: string[] }
  | { type: 'operator'; operator: OperatorId }
  | { type: 'screen'; screen: Screen }
  | { type: 'select-start'; tripId: string }
  | { type: 'select-done'; bundle: RouteBundle; screen: Screen }
  | { type: 'select-fail'; message: string }
  | { type: 'bundles-cleared' }
  | { type: 'toast'; message: string | null };

export const initialAppState: AppState = {
  hydrated: false,
  operator: null,
  currentTrip: null,
  screen: 'home',
  savedTripIds: [],
  loadingTripId: null,
  toast: null,
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'hydrated':
      return {
        ...state,
        hydrated: true,
        operator: action.operator,
        currentTrip: action.trip,
        savedTripIds: action.saved,
      };
    case 'operator':
      return { ...state, operator: action.operator };
    case 'screen':
      return { ...state, screen: action.screen };
    case 'select-start':
      return { ...state, loadingTripId: action.tripId, toast: null };
    case 'select-done':
      return {
        ...state,
        loadingTripId: null,
        currentTrip: action.bundle,
        screen: action.screen,
        savedTripIds: state.savedTripIds.includes(action.bundle.tripId)
          ? state.savedTripIds
          : [...state.savedTripIds, action.bundle.tripId],
      };
    case 'select-fail':
      return { ...state, loadingTripId: null, toast: action.message };
    // Екран не чіпаємо: якщо це був Trip, App сам поверне на Home (currentTrip зник).
    case 'bundles-cleared':
      return { ...state, savedTripIds: [], currentTrip: null };
    case 'toast':
      return { ...state, toast: action.message };
  }
}

export interface AppActions {
  setOperator: (operator: OperatorId) => void;
  setScreen: (screen: Screen) => void;
  /** Бандл із Dexie або з мережі → Dexie → екран Trip. */
  selectTrip: (entry: TripIndexEntry) => Promise<void>;
  /** «Продовжити»: бандл уже в пам'яті, лишається перейти на Trip. */
  openCurrentTrip: () => void;
  clearBundles: () => Promise<void>;
  dismissToast: () => void;
}

export const AppStateContext = createContext<AppState | null>(null);
export const AppActionsContext = createContext<AppActions | null>(null);

export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error('useAppState поза <AppStateProvider>');
  return state;
}

export function useAppActions(): AppActions {
  const actions = useContext(AppActionsContext);
  if (!actions) throw new Error('useAppActions поза <AppStateProvider>');
  return actions;
}
