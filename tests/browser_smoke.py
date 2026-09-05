"""Run against a local static server; external requests are blocked."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    for width in (1440, 390):
        page = browser.new_page(viewport={"width": width, "height": 950}, service_workers="block")
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith("http://127.0.0.1:8765/") else route.abort())
        page.goto("http://127.0.0.1:8765/")
        assert not errors, errors
        page.evaluate("""() => {
          DATA=defaultData();
          for(let m=1;m<=9;m++){
            const ch=getChannelObj(nowYear(),pad2(m),'phone');
            ch.monthly={yes:20+m,no:2,rec:1};
          }
          saveData();renderStats();
        }""")
        page.locator("#tabStats").click()
        assert page.locator(".monthCard").count() == 9
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal overflow"
        if width > 1050:
            summary = page.locator(".statsSummary").bounding_box()
            chart = page.locator(".trendCard").bounding_box()
            assert chart["x"] > summary["x"] + summary["width"]
        page.get_by_role("button", name="Backup e recupero", exact=True).click()
        assert page.locator("dialog").is_visible()
        page.locator(".recoveryClose").click()
        page.evaluate("preserveRecoveryCopy(DATA,'Browser test'); DATA.years[nowYear()].months['09'].channels.phone.monthly.yes=99;saveData()")
        page.get_by_role("button", name="Backup e recupero", exact=True).click()
        assert page.locator(".recoveryPreview").inner_text().find("Settembre") >= 0
        page.on("dialog", lambda dialog: dialog.accept())
        page.locator(".recoveryRestore").click()
        assert page.evaluate("DATA.years[nowYear()].months['09'].channels.phone.monthly.yes") == 29
        assert "Recupero completato" in page.locator(".recoveryStatus").inner_text()
        assert not errors, errors
        print(f"Browser {width}px: stats, recovery, no overflow, no page errors OK")
        page.close()
    browser.close()
