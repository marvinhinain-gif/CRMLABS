"""Verifica que nenhuma página tem rolagem horizontal da página inteira em 390 px
(o quadro Kanban rola dentro do próprio contêiner)."""
import sys
from playwright.sync_api import sync_playwright
base, email, pw = sys.argv[1:4]
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_context(viewport={"width": 390, "height": 844}).new_page()
    page.goto(f"{base}/login"); page.wait_for_timeout(1500)
    page.fill("#email", email); page.fill("#password", pw); page.click("button[type=submit]"); page.wait_for_url("**/dashboard")
    for path in ["/dashboard", "/social-seller", "/social-seller?aba=direct", "/conversas", "/contatos", "/comercial", "/tarefas", "/configuracoes"]:
        page.goto(base + path); page.wait_for_timeout(3500)
        w = page.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)"); page.evaluate("window.scrollTo(400,0)"); sx = page.evaluate("window.scrollX")
        print(("OK   " if w <= 391 else "FALHA") + f" {path}: largura {w}px, scrollX {sx}")
    b.close()
