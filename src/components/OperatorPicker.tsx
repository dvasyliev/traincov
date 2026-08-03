import { OPERATORS, type OperatorId } from '../core/operators';

export interface OperatorPickerProps {
  value: OperatorId | null;
  onChange: (operator: OperatorId) => void;
}

export function OperatorPicker({ value, onChange }: OperatorPickerProps) {
  return (
    <section className="section">
      <h2 className="section__title">Оператор</h2>
      <div className="chips" role="radiogroup" aria-label="Мобільний оператор">
        {OPERATORS.map((operator) => (
          <button
            key={operator.id}
            type="button"
            role="radio"
            aria-checked={value === operator.id}
            className={`chip${value === operator.id ? ' chip--active' : ''}`}
            onClick={() => onChange(operator.id)}
          >
            {operator.label}
          </button>
        ))}
      </div>
      <p className="hint hint--tight">
        У MVP зони спільні для всіх операторів; вибір впливає на майбутні заміри.
      </p>
    </section>
  );
}
