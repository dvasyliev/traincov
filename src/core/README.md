# Чиста логіка без React.

- `types.ts` — формат route bundle і index.json. **Єдине джерело типів**:
  той самий файл імпортує і апка, і `scripts/pipeline/`, тож несумісність
  ловиться на typecheck, а не в рантаймі.
- `linref.ts` / `speed.ts` / `eta.ts` / `probe.ts` зʼявляться в задачах 04–08.
