/**
 * Script de incorporação com ajuste automático de altura:
 *   <div data-crmlabs-form="SLUG"></div>
 *   <script src="https://DOMINIO/forms/embed.js" async></script>
 * Repassa as UTMs da página do site para o formulário (atribuição comercial).
 */
const SCRIPT = `(function () {
  var cur = document.currentScript;
  var base = cur ? new URL(cur.src).origin : "";
  var KEYS = ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","fbclid","gclid","ad_id","ad_name","adset_name","campaign_name","platform"];
  function params() {
    var sp = new URLSearchParams(window.location.search), out = new URLSearchParams({ embed: "1" });
    KEYS.forEach(function (k) { var v = sp.get(k); if (v) out.set(k, v); });
    return out.toString();
  }
  function mount(el) {
    if (el.getAttribute("data-crmlabs-ready")) return;
    var slug = el.getAttribute("data-crmlabs-form");
    if (!slug || !/^[a-z0-9-]{3,60}$/.test(slug)) return;
    el.setAttribute("data-crmlabs-ready", "1");
    var f = document.createElement("iframe");
    f.src = base + "/forms/" + slug + "?" + params();
    f.title = el.getAttribute("data-title") || "Formulário";
    f.setAttribute("loading", "lazy");
    f.setAttribute("allow", "fullscreen");
    f.style.cssText = "border:0;width:100%;display:block;border-radius:16px;transition:height .25s ease;min-height:420px;";
    f.height = el.getAttribute("data-height") || "720";
    el.appendChild(f);
  }
  window.addEventListener("message", function (e) {
    if (e.origin !== base || !e.data || e.data.type !== "crmlabs-form:height") return;
    var frames = document.querySelectorAll("[data-crmlabs-form] iframe");
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) frames[i].style.height = Math.max(420, Number(e.data.height) || 0) + "px";
    }
  });
  function scan() { var els = document.querySelectorAll("[data-crmlabs-form]"); for (var i = 0; i < els.length; i++) mount(els[i]); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
})();
`;

export function GET() {
  return new Response(SCRIPT, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=600" } });
}
