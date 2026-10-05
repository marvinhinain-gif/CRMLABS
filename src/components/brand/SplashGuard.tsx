"use client";

import { useLayoutEffect } from "react";

/** Ao entrar pelo login (navegação sem recarregar), a pessoa acabou de ver a logo animada: pula a abertura. */
export function SplashGuard() {
  useLayoutEffect(() => {
    if (!(window as unknown as { __crmSplash?: number }).__crmSplash) document.getElementById("app-splash")?.style.setProperty("display", "none");
  }, []);
  return null;
}
