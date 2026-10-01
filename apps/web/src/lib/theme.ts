'use client';

import { useCallback, useEffect, useState } from 'react';

import { THEME_STORAGE_KEY as STORAGE_KEY, type ThemePreference } from './theme-script';

export type { ThemePreference };

function apply(preference: ThemePreference): void {
  const dark =
    preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Preferência de tema (claro, escuro ou do sistema), salva no navegador. */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    setPreference(read());
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (read() === 'system') apply('system');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const choose = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Navegação privada: o tema vale só nesta aba.
    }
    apply(next);
    setPreference(next);
  }, []);

  return { preference, choose };
}
