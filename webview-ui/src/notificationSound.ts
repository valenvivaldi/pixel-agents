import {
  NOTIFICATION_NOTE_1_HZ,
  NOTIFICATION_NOTE_2_HZ,
  NOTIFICATION_NOTE_1_START_SEC,
  NOTIFICATION_NOTE_2_START_SEC,
  NOTIFICATION_NOTE_DURATION_SEC,
  NOTIFICATION_VOLUME,
  KAMEHAMEHA_CHARGE_SEC,
  KAMEHAMEHA_CHARGE_FREQ_START_HZ,
  KAMEHAMEHA_CHARGE_FREQ_END_HZ,
  KAMEHAMEHA_CHARGE_VOLUME,
  KAMEHAMEHA_CHARGE_VOLUME_END,
  KAMEHAMEHA_FIRE_SEC,
  KAMEHAMEHA_BLAST_FREQ_START_HZ,
  KAMEHAMEHA_BLAST_FREQ_END_HZ,
  KAMEHAMEHA_BLAST_VOLUME,
  KAMEHAMEHA_BLAST2_FREQ_START_HZ,
  KAMEHAMEHA_BLAST2_FREQ_END_HZ,
  KAMEHAMEHA_BLAST2_VOLUME,
} from './constants.js'

let soundEnabled = true
let audioCtx: AudioContext | null = null

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled
}

export function isSoundEnabled(): boolean {
  return soundEnabled
}

function playNote(ctx: AudioContext, freq: number, startOffset: number): void {
  const t = ctx.currentTime + startOffset
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, t)

  gain.gain.setValueAtTime(NOTIFICATION_VOLUME, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + NOTIFICATION_NOTE_DURATION_SEC)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(t)
  osc.stop(t + NOTIFICATION_NOTE_DURATION_SEC)
}

export async function playDoneSound(): Promise<void> {
  if (!soundEnabled) return
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext()
    }
    // Resume suspended context (webviews suspend until user gesture)
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume()
    }
    // Ascending two-note chime: E5 → B5
    playNote(audioCtx, NOTIFICATION_NOTE_1_HZ, NOTIFICATION_NOTE_1_START_SEC)
    playNote(audioCtx, NOTIFICATION_NOTE_2_HZ, NOTIFICATION_NOTE_2_START_SEC)
  } catch {
    // Audio may not be available
  }
}

export async function playKamehamehaSound(): Promise<void> {
  if (!soundEnabled) return
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') await audioCtx.resume()

    const now = audioCtx.currentTime

    // Charge phase: rising sine sweep
    const chargeOsc = audioCtx.createOscillator()
    const chargeGain = audioCtx.createGain()
    chargeOsc.type = 'sine'
    chargeOsc.frequency.setValueAtTime(KAMEHAMEHA_CHARGE_FREQ_START_HZ, now)
    chargeOsc.frequency.exponentialRampToValueAtTime(KAMEHAMEHA_CHARGE_FREQ_END_HZ, now + KAMEHAMEHA_CHARGE_SEC)
    chargeGain.gain.setValueAtTime(KAMEHAMEHA_CHARGE_VOLUME, now)
    chargeGain.gain.linearRampToValueAtTime(KAMEHAMEHA_CHARGE_VOLUME_END, now + KAMEHAMEHA_CHARGE_SEC)
    chargeOsc.connect(chargeGain).connect(audioCtx.destination)
    chargeOsc.start(now)
    chargeOsc.stop(now + KAMEHAMEHA_CHARGE_SEC)

    // Fire phase: sawtooth burst
    const fireTime = now + KAMEHAMEHA_CHARGE_SEC
    const blastOsc = audioCtx.createOscillator()
    const blastGain = audioCtx.createGain()
    blastOsc.type = 'sawtooth'
    blastOsc.frequency.setValueAtTime(KAMEHAMEHA_BLAST_FREQ_START_HZ, fireTime)
    blastOsc.frequency.exponentialRampToValueAtTime(KAMEHAMEHA_BLAST_FREQ_END_HZ, fireTime + KAMEHAMEHA_FIRE_SEC)
    blastGain.gain.setValueAtTime(KAMEHAMEHA_BLAST_VOLUME, fireTime)
    blastGain.gain.exponentialRampToValueAtTime(0.001, fireTime + KAMEHAMEHA_FIRE_SEC)
    blastOsc.connect(blastGain).connect(audioCtx.destination)
    blastOsc.start(fireTime)
    blastOsc.stop(fireTime + KAMEHAMEHA_FIRE_SEC)

    // Fire phase: low square wave for depth
    const blast2 = audioCtx.createOscillator()
    const blast2Gain = audioCtx.createGain()
    blast2.type = 'square'
    blast2.frequency.setValueAtTime(KAMEHAMEHA_BLAST2_FREQ_START_HZ, fireTime)
    blast2.frequency.exponentialRampToValueAtTime(KAMEHAMEHA_BLAST2_FREQ_END_HZ, fireTime + KAMEHAMEHA_FIRE_SEC)
    blast2Gain.gain.setValueAtTime(KAMEHAMEHA_BLAST2_VOLUME, fireTime)
    blast2Gain.gain.exponentialRampToValueAtTime(0.001, fireTime + KAMEHAMEHA_FIRE_SEC)
    blast2.connect(blast2Gain).connect(audioCtx.destination)
    blast2.start(fireTime)
    blast2.stop(fireTime + KAMEHAMEHA_FIRE_SEC)
  } catch {
    // Audio may not be available
  }
}

/** Call from any user-gesture handler to ensure AudioContext is unlocked */
export function unlockAudio(): void {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext()
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }
  } catch {
    // ignore
  }
}
