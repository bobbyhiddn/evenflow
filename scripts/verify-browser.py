"""Run with: uv run --with playwright==1.60.0 python scripts/verify-browser.py [URL] [output directory]."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5187'
out = Path(sys.argv[2] if len(sys.argv) > 2 else 'qa')
out.mkdir(parents=True, exist_ok=True)
host = r'''(() => {
  const h = window.__host = {active:0,maxActive:0,calls:0,startups:0,rebuilds:0,shutdowns:0,delay:35,rejectParallel:false};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text}}});
  window.flutter_inappwebview = {callHandler:async (handler,wire) => {
    const message=JSON.parse(wire), method=message.method;
    if (method==='createStartUpPageContainer') {h.startups++; return 0}
    if (method==='rebuildPageContainer') {if(h.active) throw Error('Rebuild overlapped image calls'); h.rebuilds++; return true}
    if (method==='shutDownPageContainer') {if(h.active) throw Error('Exit overlapped image calls'); h.shutdowns++; return true}
    if (method==='updateImageRawData') {
      h.active++; h.calls++; h.maxActive=Math.max(h.maxActive,h.active);
      const refused=h.rejectParallel && h.active>1;
      await new Promise(resolve=>setTimeout(resolve,h.delay));
      h.active--; return refused ? 'sendFailed' : 'success';
    }
    return true;
  }};
})()'''

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 900, 'height': 1100})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.goto(base + '/test/pixels.html')
    page.wait_for_function('document.body.dataset.result', timeout=60000)
    assert page.locator('body').get_attribute('data-result') == 'passed', page.locator('#result').inner_text()
    pixels = json.loads(page.locator('#result').inner_text())
    page.screenshot(path=str(out / 'browser-pixels.png'), full_page=True)
    print('Pixels:', json.dumps(pixels), flush=True)

    page.add_init_script(host)
    page.goto(base)
    page.wait_for_function("document.querySelector('#play')?.textContent === 'Pause'")
    page.wait_for_function('window.__host.calls >= 8')
    assert page.evaluate('window.__host.maxActive') == 1
    page.locator('#play').click()
    page.wait_for_function("document.querySelector('#play').textContent === 'Play'")
    assert page.evaluate('window.__host.active') == 0
    page.screenshot(path=str(out / 'phone-desktop.png'), full_page=True)

    page.locator('#parallel').check()
    page.locator('#play').click()
    page.wait_for_function('window.__host.maxActive === 4')
    page.locator('#play').click()
    page.wait_for_function("document.querySelector('#play').textContent === 'Play'")
    assert page.evaluate('window.__host.active') == 0
    print('Parallel: four overlapping calls; pause drained them', flush=True)

    page.locator('#check').click()
    page.wait_for_selector('#check-result', state='visible')
    page.locator('#match').click()
    page.get_by_role('button', name='Export', exact=True).click()
    page.wait_for_function('window.__copied')
    session = json.loads(page.evaluate('window.__copied'))
    assert session['sectorChecks'][-1]['mode'] == 'parallel'
    assert session['sectorChecks'][-1]['result'] == 'match'
    assert session['opticalRefreshMeasured'] is False
    assert page.get_by_role('button', name='Export', exact=True).count() == 1

    page.evaluate('window.__host.rejectParallel = true')
    page.locator('#play').click()
    page.wait_for_function("!document.querySelector('#parallel').checked", timeout=15000)
    page.wait_for_function("document.querySelector('#status').textContent.includes('concurrent image call failed')")
    page.locator('#play').click()
    page.wait_for_function("document.querySelector('#play').textContent === 'Play'")
    assert page.evaluate('window.__host.active') == 0
    print('Refusal: live playback fell back to serial after draining', flush=True)

    page.evaluate('window.__host.rejectParallel = false')
    page.locator('#compare').click()
    page.wait_for_function("document.querySelectorAll('#comparisons tbody tr').length === 12", timeout=90000)
    page.wait_for_function("document.querySelector('#play').textContent === 'Play'")
    page.get_by_role('button', name='Export', exact=True).click()
    page.wait_for_function('JSON.parse(window.__copied).comparisons.length === 12')
    session = json.loads(page.evaluate('window.__copied'))
    assert len({(row['mode'], row['detail'], row['pass']) for row in session['comparisons']}) == 12
    assert all(row['valid'] and row['completed'] == 8 and row['calls'] == 32 and row['refused'] == 0 for row in session['comparisons']), session['comparisons']
    assert all(row['maxInFlight'] <= 4 for row in session['recentFrames'])
    assert session['totals']['refused'] > 0
    print('Comparison: 12 trials, 96 complete scenes, expected 32 calls per trial', flush=True)

    page.set_viewport_size({'width': 375, 'height': 900})
    page.evaluate('document.activeElement?.blur()')
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.screenshot(path=str(out / 'phone-mobile.png'), full_page=True)

    # The actual SDK event path, including exit cancellation and page restoration.
    page.evaluate("window._listenEvenAppMessage({method:'evenHubEvent',data:{type:'sysEvent',data:{eventType:3}}})")
    page.wait_for_function('window.__host.shutdowns === 1')
    page.locator('#play').click()
    page.wait_for_function('window.__host.rebuilds === 1')
    page.wait_for_function("document.querySelector('#play').textContent === 'Pause'")
    page.locator('#play').click()
    page.wait_for_function("document.querySelector('#play').textContent === 'Play'")
    assert page.evaluate('window.__host.startups') == 1
    assert page.evaluate('window.__host.active') == 0
    assert not errors, errors
    report = {'passed': True, 'browser': 'Chromium / Playwright 1.60.0', 'pixels': pixels,
              'sdkBridgeMock': {'parallelPeak': 4, 'drainedOnPauseAndExit': True, 'automaticSerialFallback': True,
                               'comparisonTrials': 12, 'comparisonScenes': 96, 'oneExportButton': True,
                               'sectorObservationExported': True, 'resumeAfterExitDialog': True},
              'consoleErrors': errors, 'hardwarePerformanceValidated': False}
    (out / 'browser-verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print('PASS:', json.dumps(report), flush=True)
    browser.close()
