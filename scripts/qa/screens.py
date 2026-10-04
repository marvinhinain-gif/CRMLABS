"""QA visual: captura login, dashboard e Social Seller (desktop e celular).
Uso: python3 scripts/qa/screens.py http://localhost:3000 email senha
"""
import sys, os
from playwright.sync_api import sync_playwright

base, email, pw = sys.argv[1], sys.argv[2], sys.argv[3]
out = os.path.join(os.path.dirname(__file__), "..", "..", "qa-screenshots")
os.makedirs(out, exist_ok=True)
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    for label, vp in [("desktop", {"width": 1512, "height": 945}), ("mobile", {"width": 390, "height": 844})]:
        ctx = b.new_context(viewport=vp, device_scale_factor=1, locale="pt-BR", timezone_id="America/Bahia")
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"[{label}] console.{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"[{label}] pageerror: {e}"))
        page.goto(f"{base}/login", wait_until="load")
        page.screenshot(path=f"{out}/{label}-1-login.png", full_page=False)
        page.fill("#email", email)
        page.fill("#password", pw)
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard", timeout=30000)
        page.wait_for_timeout(1500)
        page.wait_for_timeout(2200)
        page.screenshot(path=f"{out}/{label}-2-dashboard.png", full_page=True)
        page.goto(f"{base}/social-seller", wait_until="load")
        page.wait_for_timeout(2200)
        page.screenshot(path=f"{out}/{label}-3-social-seller.png", full_page=False)
        if label == "desktop":
            for path, name in [("/conversas", "4-conversas"), ("/contatos", "5-contatos"), ("/comercial", "6-comercial"), ("/tarefas", "7-tarefas"), ("/configuracoes?aba=integracoes", "8-integracoes")]:
                page.goto(f"{base}{path}", wait_until="load")
                page.wait_for_timeout(2200)
                page.screenshot(path=f"{out}/{label}-{name}.png", full_page=False)
            # abre a primeira conversa e o painel de contato
            page.goto(f"{base}/conversas", wait_until="load")
            page.locator("aside ul li button").first.click()
            page.wait_for_timeout(1200)
            page.screenshot(path=f"{out}/{label}-9-conversa-aberta.png")
            page.goto(f"{base}/social-seller", wait_until="load")
            page.locator("article").first.click()
            page.wait_for_timeout(1200)
            page.screenshot(path=f"{out}/{label}-10-painel-contato.png")
        ctx.close()
    b.close()

print("\n".join(errors) if errors else "Sem erros de console.")
