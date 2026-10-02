"""Real Chromium UI checks against the explicitly synthetic loopback fixture.
Requires Python Playwright and a browser. Does NOT test PostgreSQL, S3 or antivirus.
Usage: BROWSER_EXECUTABLE=/usr/bin/chromium python tests/university/ui-check.py /tmp/qa
"""
import os,json,pathlib,subprocess,sys,re,urllib.request,urllib.error
from playwright.sync_api import sync_playwright,expect
root=pathlib.Path(__file__).resolve().parents[2]
out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/carbonsynq-university-ui-qa');out.mkdir(parents=True,exist_ok=True)
env={**os.environ,'CARBON_UI_FIXTURE':'1','NODE_ENV':'test'}
p=subprocess.Popen(['node',str(root/'tests/carbon/ui-fixture-server.mjs')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
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
        def login(pg,role='admin'):
            if not pg.locator('#loginForm').count():navigate(pg,'/university')
            pg.locator('[name=tenantId]').fill(cfg['tenantId']);pg.locator('[name=email]').fill(role+'@test.invalid');pg.locator('[name=password]').fill('UIFixture@123');pg.locator('#loginForm button[type=submit]').click();expect(pg.locator('#workspace')).to_be_visible();pg.locator('[data-view="carbon"]').click();expect(pg.locator('#content')).to_contain_text('Source accounting workspace')
        login(page);done('authenticated Scope1/2 section loads through the real HTTP middleware and memory domain fixture')
        expect(page.locator('#universityName')).to_contain_text('SYNTHETIC TEST');expect(page.locator('#content')).to_contain_text('70,000');expect(page.locator('#content')).to_contain_text('54,000');expect(page.locator('#content')).to_contain_text('72,680');done('location and market methods remain separate with correct primary total')
        page.screenshot(path=str(out/'scope12-desktop.png'),full_page=True)
        for tab in ['Sources','Boundaries','Factors','Instruments','Actions','Voids','Records']:
            page.locator('#carbonTabs').get_by_role('button',name=tab,exact=True).click();expect(page.locator('#carbonTabs .primary')).to_have_text(tab)
        done('all seven source accounting resource tabs load')
        page.get_by_role('button',name='Create Records',exact=True).click();expect(page.locator('[name="body:sourceId"] option')).to_have_count(3);expect(page.locator('[name="body:quantityInput"]')).to_have_value(re.compile('DIRECT'));page.locator('[data-close="operationDialog"]').click();done('guided consumption entry exposes source picker and quantity-method JSON')
        page.get_by_role('button',name='Quantity calculator',exact=True).click();page.locator('[name="body:mode"]').select_option('FUEL_STOCK')
        for name,value in {'unit':'litre','opening':'100','received':'250','transfersIn':'20','closing':'80','transfersOut':'10'}.items():page.locator('[name="body:'+name+'"]').fill(value)
        page.locator('#operationForm button[type=submit]').click();expect(page.locator('#resultJson')).to_contain_text('280.000000');expect(page.locator('#resultJson')).to_contain_text('persisted');page.locator('[data-close="resultDialog"]').click();done('fuel stock preview submits to HTTP and returns exact 280 litres without writes')
        page.locator('[data-carbon-id]').first.click();expect(page.locator('#resultJson')).to_contain_text('provenance');expect(page.locator('#resultJson')).to_contain_text('INTERNAL_MAKER_CHECKER_ONLY');page.locator('[data-close="resultDialog"]').click();done('record details expose factor and evidence provenance')
        page.locator('#carbonTabs').get_by_role('button',name='Boundaries',exact=True).click();page.get_by_role('button',name='Create Boundaries',exact=True).click();expect(page.locator('[name="body:screening"]')).to_have_value(re.compile('DG_BOILERS_KITCHENS'));page.locator('[data-close="operationDialog"]').click();done('boundary form contains campus source-screening checklist')
        page.locator('#carbonTabs').get_by_role('button',name='Instruments',exact=True).click();page.get_by_role('button',name='Create Instruments',exact=True).click();expect(page.locator('[name="body:qualityChecks"]')).to_have_value(re.compile('RETIRED_FOR_TENANT'));assert '"assessment": "PASS"' not in page.locator('[name="body:qualityChecks"]').input_value();page.locator('[data-close="operationDialog"]').click();done('instrument criteria require actual assessment rather than default verified claims')
        page.locator('#logout').click();login(page,'leadership');expect(page.get_by_role('button',name='Create Instruments',exact=True)).to_have_count(0);expect(page.get_by_role('button',name='Install 10 extra KPIs',exact=True)).to_have_count(0);done('leadership console has no mutation controls')
        mobile_context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,device_scale_factor=1);mobile=mobile_context.new_page();mobile.on('pageerror',lambda e:errors.append(str(e)));login(mobile);assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth+1');mobile.screenshot(path=str(out/'scope12-mobile.png'),full_page=True);done('mobile Scope1/2 section has no document-level horizontal overflow')
        assert not errors,errors;done('no uncaught JavaScript errors in tested workflow');browser.close()
    result={'passed':len(checks),'checks':checks,'browser':'Chromium via Playwright','data':'SYNTHETIC_LOOPBACK_FIXTURE','mode':'DOM_WITH_LOCAL_HTTP_BRIDGE' if dom_harness else 'DIRECT_BROWSER_HTTP','browserNavigationTested':not dom_harness,'productionCSPTested':not dom_harness,'postgresqlTested':False,'objectStorageTested':False,'antivirusTested':False};(out/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
finally:
    p.terminate()
    try:p.wait(timeout=5)
    except subprocess.TimeoutExpired:p.kill()
