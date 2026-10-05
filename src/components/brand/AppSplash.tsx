import { AnimatedLogo } from "./AnimatedLogo";
import { SPLASH_KEY } from "./splash";
import { SplashGuard } from "./SplashGuard";

/**
 * Abertura do app: a logo animada em tela cheia ao abrir o CRMLABS (inclusive o app instalado no celular).
 * Aparece uma vez por sessão e some sozinha só com CSS, sem esperar o JavaScript.
 * O script roda antes da pintura: se a abertura já foi vista nesta sessão, esconde na hora. Vindo do login sem recarregar, o SplashGuard esconde.
 */
const hideIfSeen = `try{if(sessionStorage.getItem("${SPLASH_KEY}")){var s=document.createElement("style");s.textContent="#app-splash{display:none!important}";document.head.appendChild(s)}else{sessionStorage.setItem("${SPLASH_KEY}","1");window.__crmSplash=1}}catch(e){}`;

export function AppSplash() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: hideIfSeen }} />
      <div id="app-splash" className="app-splash" aria-hidden="true">
        <div className="flex flex-col items-center gap-5">
          <AnimatedLogo size={52} />
          <p className="app-splash-tagline text-[15px] text-muted">Relacionamentos que viram resultados.</p>
          <span className="app-splash-bar" />
        </div>
      </div>
      <SplashGuard />
    </>
  );
}
