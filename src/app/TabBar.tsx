import { SCREENS, type Screen } from './screens';

export interface TabBarProps {
  active: Screen;
  onChange: (screen: Screen) => void;
}

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav className="tabbar">
      {SCREENS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`tabbar__item${s.id === active ? ' tabbar__item--active' : ''}`}
          aria-current={s.id === active ? 'page' : undefined}
          onClick={() => onChange(s.id)}
        >
          <span className="tabbar__icon">{s.icon}</span>
          <span className="tabbar__label">{s.label}</span>
        </button>
      ))}
    </nav>
  );
}
