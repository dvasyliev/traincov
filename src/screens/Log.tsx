export function Log() {
  return (
    <div className="screen screen--padded">
      <h1 className="title">Логер</h1>
      <p className="subtitle">Заміри якості зв'язку</p>

      <section className="card">
        <div className="card__label">Статус</div>
        <div className="card__value">Вимкнено</div>
        <div className="card__meta">Probe RTT + експорт JSON з'являться в задачі 08.</div>
      </section>
    </div>
  );
}
