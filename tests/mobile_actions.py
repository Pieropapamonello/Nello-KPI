"""Check action buttons remain reachable above the mobile navigation."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import tempfile

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    for width,height in [(390,844),(360,640),(600,800)]:
        page=browser.new_page(viewport={'width':width,'height':height},service_workers='block',reduced_motion='reduce')
        page.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:8765/') else r.abort())
        page.goto('http://127.0.0.1:8765/')
        page.wait_for_function("typeof loadIntoInputs==='function'")
        page.evaluate("""() => {
          channel='phone';mode='weekly';
          getChannelObj(selectedYear,selectedMonth,'phone').weeks[0].yes=6;
          document.querySelector('#btnWeekly').click();
          document.querySelectorAll('*').forEach(el=>el.style.scrollBehavior='auto');
        }""")
        for button in ['#calcBtn','#shareImgBtn']:
            page.locator(button).evaluate("el=>el.scrollIntoView({block:'end',behavior:'instant'})")
            page.wait_for_timeout(100)
            rect=page.locator(button).bounding_box()
            dock=page.locator('.mobileDock').bounding_box()
            assert rect['y']>=0 and rect['y']+rect['height']<dock['y'],(button,rect,dock)
            assert page.locator(button).evaluate("el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}")
            if button=='#calcBtn':page.locator(button).click()
        page.screenshot(path=str(Path(tempfile.gettempdir())/f'nello-actions-{width}.png'))
        print(f'{width}x{height}: result and share buttons clear of navigation',flush=True)
        page.close()
    browser.close()
