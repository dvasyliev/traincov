/**
 * Попередження «діра через 2 хвилини»: вібрація + короткий тихий сигнал.
 *
 * Web Notifications свідомо не використовуємо: на iOS вони працюють лише для
 * PWA, встановленої на home screen, а телефон у поїзді і так лежить екраном угору.
 */

const BEEP_HZ = 880;
const BEEP_MS = 180;
/** Гучність низька навмисне: це підказка сусідові по столику, а не будильник. */
const BEEP_GAIN = 0.06;
const VIBRATE_MS = 200;

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/**
 * Розбудити звук у обробнику тапу: iOS не дає створити/відновити AudioContext
 * поза жестом користувача, а сам сигнал прилетить через півгодини їзди.
 */
export function primeAlerts(): void {
  const audio = audioContext();
  if (audio && audio.state === 'suspended') void audio.resume();
}

export function fireAlert(): void {
  navigator.vibrate?.(VIBRATE_MS);

  const audio = audioContext();
  if (!audio || audio.state !== 'running') return;

  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = BEEP_HZ;
  osc.type = 'sine';
  // Різкий старт/стоп дає клац — тому коротка атака і згасання.
  const now = audio.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(BEEP_GAIN, now + 0.02);
  gain.gain.linearRampToValueAtTime(0, now + BEEP_MS / 1000);
  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + BEEP_MS / 1000 + 0.02);
}
