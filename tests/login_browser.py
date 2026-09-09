"""Local UI checks; all external traffic blocked, authentication simulated."""
from pathlib import Path
import tempfile
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    print('Launching test browser',flush=True)
    browser=p.chromium.launch(channel='chrome',headless=True)
    for width,height in [(1440,950),(390,844),(360,640)]:
        print(f'Opening {width}px',flush=True)
        page=browser.new_page(viewport={'width':width,'height':height},service_workers='block')
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:8765/') else route.abort())
        page.goto('http://127.0.0.1:8765/')
        print('Page loaded',flush=True)
        page.wait_for_function("typeof setAuthMode==='function'")
        page.locator('#loginBtn').click()
        print('Login open',flush=True)
        assert page.locator('#modalOverlay').is_visible()
        assert page.locator('#btnGoogle,#btnResetPass,#btnResendVerification,#btnLogout').count()==0
        assert page.locator('#emailInput').evaluate('(el)=>el===document.activeElement')
        page.locator('#emailInput').fill('test@example.test')
        page.locator('#passInput').fill('test-password')
        page.locator('#togglePassword').click()
        assert page.locator('#passInput').get_attribute('type')=='text'
        page.locator('#togglePassword').click()
        page.evaluate("""() => {
          window.authCalls=[];firebaseEnabled=true;
          auth={signInWithEmailAndPassword:async()=>{authCalls.push('login');throw {code:'auth/invalid-credential'};},
            createUserWithEmailAndPassword:async()=>{authCalls.push('signup');}};
        }""")
        page.locator('#passInput').press('Enter')
        print('Submitted',flush=True)
        page.wait_for_function("document.querySelector('#loginError').textContent.includes('non corrette')")
        assert page.evaluate('authCalls.join()')=='login'
        page.screenshot(path=str(Path(tempfile.gettempdir())/f'nello-login-{width}.png'),animations='disabled')
        page.locator('[data-auth-mode="signup"]').click()
        page.locator('#confirmPassInput').fill('different')
        page.locator('#authSubmit').click()
        assert 'non coincidono' in page.locator('#loginError').inner_text()
        assert page.evaluate('authCalls.length')==1
        page.locator('#confirmPassInput').fill('test-password')
        page.locator('#authSubmit').click()
        page.wait_for_function("!document.querySelector('#modalOverlay').open")
        assert page.evaluate('authCalls.join()')=='login,signup'
        assert page.locator('#passInput').input_value()==''
        page.locator('#loginBtn').click()
        page.keyboard.press('Escape')
        assert not page.locator('#modalOverlay').is_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not errors,errors
        print(f'Login {width}x{height}: modes, validation, Enter, Escape, password visibility OK',flush=True)
        page.close()
    browser.close()
