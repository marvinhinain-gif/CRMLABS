"""QA de celular: captura todas as telas em 375 px e 412 px, verifica rolagem horizontal
e alvos de toque pequenos. Uso: python3 scripts/qa/mobile_screens.py http://localhost:3000 email senha [pasta]
"""
import sys, os
from playwright.sync_api import sync_playwright

base, email, pw = sys.argv[1:4]
out = sys.argv[4] if len(sys.argv) > 4 else "qa-screenshots/mobile"
os.makedirs(out, exist_ok=True)
PAGES = ["/dashboard", "/social-seller", "/social-seller?aba=direct", "/social-seller?aba=comentarios", "/conversas", "/contatos", "/comercial", "/tarefas", "/configuracoes?aba=perfil", "/configuracoes?aba=equipe", "/configuracoes?aba=organizacao"]

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h in [(375, 812)]:
        ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.goto(f"{base}/login"); page.wait_for_timeout(1800)
        page.screenshot(path=f"{out}/{w}-login.png")
        page.fill("#email", email); page.fill("#password", pw); page.click("button[type=submit]"); page.wait_for_url("**/dashboard")
        for path in PAGES:
            page.goto(base + path); page.wait_for_timeout(2600)
            sw = page.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)")
            name = path.strip("/").replace("/", "_").replace("?aba=", "-") or "root"
            page.screenshot(path=f"{out}/{w}-{name}.png", full_page=True)
            small = page.evaluate("""() => [...document.querySelectorAll('button, a, input, select, [role=button]')]
              .filter(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
                 return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && (r.width < 32 || r.height < 32) && r.top < innerHeight * 3 })
              .slice(0, 6).map(e => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))""")
            print(("OK   " if sw <= w + 1 else "FALHA") + f" {w}px {path}: largura {sw}" + (f" | toque pequeno: {small}" if small else ""))
        ctx.close()
    b.close()
