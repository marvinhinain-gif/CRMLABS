"""QA funcional do Kanban no navegador: arrastar com mouse, mover pelo teclado e pelo menu,
persistência após recarregar e histórico registrado.
Uso: python3 scripts/qa/kanban_flow.py http://localhost:3000 email senha
"""
import sys
from playwright.sync_api import sync_playwright

base, email, pw = sys.argv[1:4]
ok = lambda c, m: print(("OK   " if c else "FALHA") + " " + m)

def column_names(page, stage):
    col = page.locator(f'section[aria-label^="Etapa {stage},"]')
    return col.locator("article p.truncate.text-\\[15px\\]").all_inner_texts()

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1600, "height": 1000}).new_page()
    page.goto(f"{base}/login"); page.wait_for_timeout(1500)
    page.fill("#email", email); page.fill("#password", pw); page.click("button[type=submit]")
    page.wait_for_url("**/dashboard"); page.goto(f"{base}/social-seller"); page.wait_for_timeout(2500)

    # 1) Arrastar Julia Alves de Engajado #1 para Seguidor Engajado #2 com o mouse
    card = page.locator("article", has_text="Julia Alves").first
    target = page.locator('section[aria-label^="Etapa Seguidor Engajado #2,"]')
    cb, tb = card.bounding_box(), target.bounding_box()
    page.mouse.move(cb["x"] + 60, cb["y"] + 30); page.mouse.down()
    page.mouse.move(cb["x"] + 90, cb["y"] + 40, steps=5)
    page.mouse.move(tb["x"] + tb["width"] / 2, tb["y"] + 120, steps=15)
    page.mouse.up(); page.wait_for_timeout(1800)
    page.reload(); page.wait_for_timeout(2500)
    ok("Julia Alves" in column_names(page, "Seguidor Engajado #2"), "arrastar e soltar persiste após recarregar")

    # 2) Mover pelo menu do cartão (alternativa ao arrastar)
    page.locator("article", has_text="Bruno Costa").first.get_by_role("button", name="Ações para Bruno Costa").click()
    page.get_by_role("menuitem", name="Mover para etapa").hover(); page.wait_for_timeout(400)
    page.get_by_role("menuitem", name="Em relacionamento").click(); page.wait_for_timeout(1800)
    page.reload(); page.wait_for_timeout(2500)
    ok("Bruno Costa" in column_names(page, "Em relacionamento"), "“Mover para etapa” no menu persiste")

    # 3) Teclado: foco no cartão, espaço, seta para a direita, espaço
    c = page.locator("article", has_text="Ana Souza").first
    c.focus(); page.keyboard.press("Space"); page.wait_for_timeout(300)
    page.keyboard.press("ArrowRight"); page.wait_for_timeout(300)
    page.keyboard.press("ArrowRight"); page.wait_for_timeout(300)
    page.keyboard.press("Space"); page.wait_for_timeout(1800)
    page.reload(); page.wait_for_timeout(2500)
    moved = "Ana Souza" not in column_names(page, "Engajado #1")
    ok(moved, "movimento por teclado (espaço + setas) persiste")

    # 4) Histórico no painel do contato
    page.locator("article", has_text="Julia Alves").first.click(); page.wait_for_timeout(1500)
    page.get_by_role("tab", name="Histórico").click(); page.wait_for_timeout(800)
    hist = page.locator("ol").last.inner_text()
    ok("Seguidor Engajado #2" in hist and "Marvin Hinain" in hist, "histórico registra etapa e autor")
    b.close()
