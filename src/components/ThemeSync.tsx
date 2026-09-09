"use client";

import { useEffect } from "react";

// Minified inline script that runs before first paint, eliminating the
// flash-of-wrong-theme. Must be a string so it can be dangerouslySetInnerHTML'd
// from the Server Component layout without importing this module on the server.
export const THEME_BOOTSTRAP = `(function(){
  var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var contrast = window.matchMedia('(prefers-contrast: more)').matches;
  var cl = document.documentElement.classList;
  cl.toggle('pf-v6-theme-dark', dark);
  cl.toggle('pf-v6-theme-light', !dark);
  cl.toggle('pf-v6-theme-contrast', contrast);
})();`;

function applyTheme(): void {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const contrast = window.matchMedia("(prefers-contrast: more)").matches;
  const cl = document.documentElement.classList;
  cl.toggle("pf-v6-theme-dark", dark);
  cl.toggle("pf-v6-theme-light", !dark);
  cl.toggle("pf-v6-theme-contrast", contrast);
}

/**
 * Renders nothing visible. Attaches mediaquery change listeners so the PF
 * theme class on <html> stays in sync when the user changes their OS setting.
 * The initial state is set by the THEME_BOOTSTRAP script injected in layout.tsx.
 */
export function ThemeSync() {
  useEffect(() => {
    const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
    const contrastMq = window.matchMedia("(prefers-contrast: more)");
    darkMq.addEventListener("change", applyTheme);
    contrastMq.addEventListener("change", applyTheme);
    // Sync in case the media query changed between SSR and hydration.
    applyTheme();
    return () => {
      darkMq.removeEventListener("change", applyTheme);
      contrastMq.removeEventListener("change", applyTheme);
    };
  }, []);
  return null;
}
