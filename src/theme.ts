// Appearance: 'light' (default), 'dark', or 'auto' (follow the phone's setting). Saved per device.
export type ThemeChoice = 'light' | 'dark' | 'auto';

const KEY = 'ca.theme';
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'dark' || v === 'auto' || v === 'light') return v;
  } catch {
    /* storage unavailable */
  }
  return 'light';
}

export function applyTheme(choice: ThemeChoice = getTheme()) {
  const dark = choice === 'dark' || (choice === 'auto' && !!media?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#2a3d34' : '#557767');
}

export function setTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* storage unavailable: still applies for this visit */
  }
  applyTheme(choice);
}

// When set to Automatic, follow the phone switching between light and dark.
media?.addEventListener('change', () => {
  if (getTheme() === 'auto') applyTheme('auto');
});
