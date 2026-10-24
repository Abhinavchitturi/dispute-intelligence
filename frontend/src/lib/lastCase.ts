// The case the investigator opened most recently, so the "Investigation" link goes back to it instead of always the same case.
const KEY = 'resolveiq.lastCase';

export function getLastCase(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function setLastCase(id: string) {
  try { localStorage.setItem(KEY, id); } catch { /* storage unavailable: the link just falls back to the most urgent case */ }
}
