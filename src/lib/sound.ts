/**
 * Browser sound notifications using Web Audio API.
 * No external audio files needed — generates tones programmatically.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return audioCtx;
}

/**
 * Play a short notification beep sequence.
 * Three ascending tones — attention-grabbing but not harsh.
 */
export function playSessionEndingAlert(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume context if suspended (browsers require user interaction first)
  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const now = ctx.currentTime;
  const frequencies = [660, 880, 1100]; // Three ascending tones
  const duration = 0.15;
  const gap = 0.08;

  frequencies.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0, now + i * (duration + gap));
    gain.gain.linearRampToValueAtTime(0.3, now + i * (duration + gap) + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + i * (duration + gap) + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + i * (duration + gap));
    osc.stop(now + i * (duration + gap) + duration + 0.01);
  });
}
