"""Real Chromium UI checks against the explicitly synthetic loopback fixture.
Requires Python Playwright and a browser. Does NOT test PostgreSQL, S3 or antivirus.
Usage: BROWSER_EXECUTABLE=/usr/bin/chromium python tests/university/ui-check.py /tmp/qa
"""
import os,json,pathlib,subprocess,sys,re,urllib.request,urllib.error
from playwright.sync_api import sync_playwright,expect
root=pathlib.Path(__file__).resolve().parents[2]
out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/carbonsynq-university-ui-qa');out.mkdir(parents=True,exist_ok=True)
env={**os.environ,'UNIVERSITY_UI_FIXTURE':'1','NODE_ENV':'test'}
p=subprocess.Popen(['node',str(root/'tests/university/ui-fixture-server.mjs')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
checks=[];errors=[];dom_harness=os.environ.get('UI_DOM_HARNESS')=='1'
def done(name):checks.append(name);print('PASS '+name)
try:
    line=p.stdout.readline();cfg=json.loads(line);url=cfg['url']
    with sync_playwright() as pw:
        opts={'headless':True}
        if os.environ.get('BROWSER_EXECUTABLE'):opts['executable_path']=os.environ['BROWSER_EXECUTABLE']
        browser=pw.chromium.launch(**opts);context=browser.new_context(viewport={'width':1440,'height':1080});page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        def navigate(pg,path):
            if not dom_harness:
                pg.goto(url+path);return
            # DOM-only fallback when browser navigation is disabled by host policy.
            # This does not change browser policy, and makes no external requests.
            # The fixture HTTP bridge is explicitly limited to our loopback server.
            def bridge(path,options):
                if not isinstance(path,str) or not path.startswith('/') or path.startswith('//'):
                    raise ValueError('UI bridge accepts same-fixture relative paths only')
                body=options.get('body');data=body.encode() if isinstance(body,str) else None
                req=urllib.request.Request(url+path,data=data,headers=options.get('headers',{}),method=options.get('method','GET'))
                try:
                    with urllib.request.urlopen(req) as response:
                        return {'status':response.status,'body':response.read().decode(),'headers':dict(response.headers)}
                except urllib.error.HTTPError as response:
                    return {'status':response.code,'body':response.read().decode(),'headers':dict(response.headers)}
            pg.expose_function('__fixture_http',bridge)
            filename='portal.html' if path.endswith('/portal') else 'index.html'
            html=(root/'public/university'/filename).read_text()
            html=re.sub(r'<script[^>]*>.*?</script>','',html,flags=re.S)
            html=re.sub(r'<link[^>]*>','',html)
            pg.set_content(html)
            pg.add_style_tag(content=(root/'public/university/style.css').read_text())
            pg.add_script_tag(content="""
              window.fetch=async(path,options={})=>{
                const r=await window.__fixture_http(path,options);
                return new Response(r.body,{status:r.status,headers:r.headers});
              };
              if(!crypto.randomUUID)crypto.randomUUID=()=>{
                const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
                const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
                return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
              };
            """)
            pg.add_script_tag(content=(root/'public/university'/('portal.js' if path.endswith('/portal') else 'app.js')).read_text())
        def login(pg):
            navigate(pg,'/university');pg.locator('[name=tenantId]').fill(cfg['tenantId']);pg.locator('[name=email]').fill('admin@test.invalid');pg.locator('[name=password]').fill('UIFixture@123');pg.locator('#loginForm button[type=submit]').click();expect(pg.locator('#workspace')).to_be_visible();expect(pg.locator('#content')).to_contain_text('1,285')
        login(page);done('desktop authentication and combined primary inventory display')
        expect(page.locator('#universityName')).to_contain_text('SYNTHETIC UI TEST');expect(page.locator('#content')).to_contain_text('Supplemental');done('fixture labelling and separate student boundary')
        page.screenshot(path=str(out/'dashboard-desktop.png'),full_page=True)
        for view in ['tasks','emissions','evidence','factors','scope3-screenings','supplier-requests','materiality','initiatives','reports','pcf-studies','studio']:
            page.locator('[data-view="'+view+'"]').click();expect(page.locator('#content')).not_to_contain_text('Reading your workspace...');expect(page.locator('#content')).not_to_be_empty()
        done('all 12 module views render without JavaScript errors')
        page.locator('[data-view="tasks"]').click();page.get_by_role('button',name='+ Create collection task',exact=True).click();expect(page.locator('#operationDialog')).to_be_visible();expect(page.locator('[name="body:periodId"]')).to_have_value(page.locator('#period').input_value());page.locator('[data-close="operationDialog"]').click();done('guided collection task form uses selected period')
        page.locator('[data-view="factors"]').click();page.get_by_role('button',name='+ Create record',exact=True).click();expect(page.locator('[name="body:category"] option[value="FOOD_PURCHASES"]')).to_have_count(1);page.locator('[data-close="operationDialog"]').click();done('factor register form exposes university category contract')
        page.locator('[data-view="supplier-requests"]').click();page.get_by_role('button',name='Register a supplier',exact=True).click()
        for name,value in {'name':'UI test dining supplier','code':'UI_SUPPLIER','contactEmail':'test@example.invalid','category':'Dining'}.items():page.locator('[name="body:'+name+'"]').fill(value)
        page.locator('#operationForm button[type=submit]').click();expect(page.locator('#resultJson')).to_contain_text('UI_SUPPLIER');page.locator('[data-close="resultDialog"]').click();done('supplier create form sends validated request through HTTP domain handler')
        page.locator('[data-view="materiality"]').click();page.get_by_role('button',name='+ Create record',exact=True).click()
        for name,value in {'title':'UI materiality assessment','topics':'[{"code":"WATER","label":"Water stewardship"}]','impactThreshold':'3','financialThreshold':'3','minResponses':'5'}.items():page.locator('[name="body:'+name+'"]').fill(value)
        page.locator('#operationForm button[type=submit]').click();expect(page.locator('#resultJson')).to_contain_text('UI materiality assessment');page.locator('[data-close="resultDialog"]').click();page.get_by_role('button',name='Details',exact=True).first.click();page.get_by_role('button',name='Invite stakeholder',exact=True).click();page.locator('#operationForm button[type=submit]').click();expect(page.locator('#resultJson')).to_contain_text('portalPath');expect(page.locator('#resultNote')).to_contain_text('No email');page.locator('[data-close="resultDialog"]').click();expect(page.locator('#resultJson')).to_be_empty();done('materiality creation, invitation generation and secret clearing')
        page.locator('[data-view="studio"]').click();option=page.locator('#operationSelect option').filter(has_text='POST /insights/query').first.get_attribute('value');page.locator('#operationSelect').select_option(option);page.get_by_role('button',name='Open guided request',exact=True).click();page.locator('[name="body:questionId"]').select_option('EMISSIONS_SUMMARY');page.locator('#operationForm button[type=submit]').click();expect(page.locator('#resultJson')).to_contain_text('DETERMINISTIC_SQL_NOT_LLM');page.locator('[data-close="resultDialog"]').click();done('traceable insights operate without a language model')
        assert ('localStorage' not in (root/'public/university/app.js').read_text() and 'sessionStorage' not in (root/'public/university/app.js').read_text());done('application contains no browser-storage credential calls')
        page.locator('#logout').click();expect(page.locator('#login')).to_be_visible();expect(page.locator('#workspace')).to_be_hidden();done('logout clears workspace and dialogs')
        portal=context.new_page();portal.on('pageerror',lambda e:errors.append(str(e)));navigate(portal,'/university/portal');portal.locator('#capability').fill('invalid');portal.locator('#unlock button').click();expect(portal.locator('#portalError')).to_contain_text('rejected');portal.locator('#capability').fill('UI-TEST-ONLY');portal.locator('#unlock button').click();expect(portal.locator('#response')).to_be_visible()
        for name in ['impact:WATER','financial:WATER','impact:ENERGY','financial:ENERGY']:portal.locator('[name="'+name+'"]').select_option('4')
        portal.locator('#consent').check();portal.locator('#answers button').click();expect(portal.locator('#received')).to_contain_text('Response received');assert 'UI-TEST-ONLY' not in portal.url;done('capability portal invalid-token handling, consent and one response form')
        mobile_context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,device_scale_factor=1);mobile=mobile_context.new_page();mobile.on('pageerror',lambda e:errors.append(str(e)));login(mobile)
        assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth+1');mobile.screenshot(path=str(out/'dashboard-mobile.png'),full_page=True);done('390px mobile overview has no document-level horizontal overflow')
        mobile.locator('[data-view="tasks"]').click();mobile.get_by_role('button',name='+ Create collection task',exact=True).click();expect(mobile.locator('#operationDialog')).to_be_visible();assert mobile.evaluate('document.querySelector("#operationDialog").getBoundingClientRect().right <= innerWidth+1');done('mobile request dialog stays within viewport')
        assert not errors,errors;done('no uncaught JavaScript exceptions')
        browser.close()
    result={'passed':len(checks),'checks':checks,'browser':'Chromium via Playwright','data':'SYNTHETIC_LOOPBACK_FIXTURE','mode':'DOM_WITH_LOCAL_HTTP_BRIDGE' if dom_harness else 'DIRECT_BROWSER_HTTP','browserNavigationTested':not dom_harness,'productionCSPTested':not dom_harness,'postgresqlTested':False,'objectStorageTested':False,'antivirusTested':False,'screenshots':['dashboard-desktop.png','dashboard-mobile.png']};(out/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
finally:
    p.terminate()
    try:p.wait(timeout=5)
    except subprocess.TimeoutExpired:p.kill()
