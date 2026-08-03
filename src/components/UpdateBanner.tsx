/**
 * Банер «є нова версія». Показується тільки коли поїздка не йде —
 * рішення оновлюватись під час дороги користувач приймає сам, і не в тунелі.
 */
export function UpdateBanner({ onApply }: { onApply: () => void }) {
  return (
    <div className="update-banner" role="status">
      <span className="update-banner__text">Є нова версія застосунку</span>
      <button type="button" className="update-banner__button" onClick={onApply}>
        Оновити
      </button>
    </div>
  );
}
