export type ThemePreference = 'light' | 'dark' | 'system';
export const THEME_STORAGE_KEY = 'webzen-theme';

/** Script inline do layout (servidor): aplica o tema salvo antes da hidratação. */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_STORAGE_KEY}')||'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}})();`;
