export const THEME_STORAGE_KEY = "grac-theme";
export const THEME_EVENT = "grac-theme";

export type Theme = "light" | "dark";

export function themeAppliesToPath(pathname: string): boolean {
  return pathname.startsWith("/dashboard");
}

/** Explicit light/dark choice, or null when the user has not picked one. */
export function getExplicitTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Signed-in users default to dark. An explicit choice wins and is left in
 * localStorage across login and logout.
 */
export function resolveTheme(isAuthenticated: boolean): Theme {
  const explicit = getExplicitTheme();
  if (explicit) return explicit;
  return isAuthenticated ? "dark" : "light";
}

export function applyThemeForPath(theme: Theme, pathname: string) {
  const root = document.documentElement;
  if (theme === "dark" && themeAppliesToPath(pathname)) {
    root.setAttribute("data-theme", "dark");
  } else {
    root.removeAttribute("data-theme");
  }
}

export function setTheme(theme: Theme, pathname: string) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or a blocked storage API still updates the current view.
  }
  applyThemeForPath(theme, pathname);
  window.dispatchEvent(new Event(THEME_EVENT));
}
