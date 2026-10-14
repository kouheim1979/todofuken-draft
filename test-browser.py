"""Normal-navigation smoke test for local HTTP or the deployed Pages site.
No Storage adapter is used here. Run after installing Playwright browsers.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, Error as PlaywrightError

BASE = os.environ.get('GAME_BASE_URL', 'http://127.0.0.1:8000/')
PUBLIC = BASE.startswith('https:')
OUT = Path('browser-report')
OUT.mkdir(exist_ok=True)
results = []
errors = []
coverage_gaps = []

def context(browser, width=390):
    ctx = browser.new_context(viewport={'width': width, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    return ctx

def page_for(ctx):
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE, wait_until='domcontentloaded', timeout=45000)
    page.locator('[data-action=solo]').wait_for()
    assert '2.0.0-rc.1' in page.locator('.pagefooter').inner_text()
    return page

with sync_playwright() as p:
    for engine in ['chromium', 'webkit']:
        browser = getattr(p, engine).launch(headless=True)
        ctx = context(browser)
        page = page_for(ctx)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(OUT / (engine + '-home.png')), full_page=True)
        page.locator('[data-action=solo]').click()
        page.locator('[data-action=preset][data-n="3"]').click()
        page.locator('[data-name="0"]').fill('検証プレイヤー')
        page.locator('[data-home="0"]').select_option('14')
        page.locator('[data-action=start]').click()
        page.locator('#search').fill('カナガワ')
        assert page.locator('#cardgrid .prefcard').count() == 1
        page.locator('#cardgrid .prefcard').click()
        page.locator('[data-dialog-action="0"]').click()
        page.wait_for_function('!game.players[Engine.turn(game)].cpu', timeout=10000)
        count = page.evaluate('game.selectionLog.length')
        page.reload(wait_until='domcontentloaded')
        page.locator('[data-action=resume]').click()
        assert page.evaluate('game.selectionLog.length') == count
        page.locator('#search').fill('')
        while not page.evaluate('Engine.allPicked(game)'):
            page.wait_for_function('Engine.allPicked(game) || !game.players[Engine.turn(game)].cpu', timeout=10000)
            if page.evaluate('Engine.allPicked(game)'):
                break
            page.locator('.prefcard:not(.owned)').first.click()
            page.locator('[data-dialog-action="0"]').click()
        assert page.evaluate('game.phase') == 'draft'
        page.locator('[data-action=toOrder]').click()
        page.locator('[data-action=down]').first.click()
        page.locator('[data-action=order-next]').click()
        page.wait_for_function('game.phase === "battle"', timeout=10000)
        for r in range(3):
            page.locator('[data-action=fight]').click()
            assert page.evaluate('game.resolved') == r + 1
            page.locator('[data-action=next]').click()
        assert page.evaluate('game.phase') == 'result'
        assert page.evaluate('histories().length') == 1
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(OUT / (engine + '-result.png')), full_page=True)
        offline = {'status': 'NOT_REQUESTED'}
        if PUBLIC:
            page.wait_for_function('navigator.serviceWorker.controller !== null', timeout=30000)
            assert page.evaluate("caches.has('tdb-v2-2.0.0-rc.1')")
            try:
                ctx.set_offline(True)
                page.reload(wait_until='domcontentloaded')
                page.locator('[data-action=history]').click()
                assert page.locator('.historycard').count() == 1
                offline = {'status': 'PASS'}
            except PlaywrightError as error:
                # A known automation defect is NOT a successful offline test.
                # Unexpected errors still fail this run; retain the exact coverage gap.
                if engine != 'webkit' or 'WebKit encountered an internal error' not in str(error):
                    raise
                offline = {'status': 'NOT_VERIFIED',
                           'reason': 'WebKit offline-emulation internal error',
                           'upstream': 'https://github.com/microsoft/playwright/issues/42775'}
                coverage_gaps.append({'browser': engine, 'check': 'offline navigation', **offline})
            finally:
                ctx.set_offline(False)
        scenario = {'browser': engine, 'normalNavigation': True, 'persistentStorageReload': True,
                    'completeGame': True, 'serviceWorkerOffline': offline}
        results.append(scenario)
        print(json.dumps(scenario, ensure_ascii=False), flush=True)
        ctx.close()
        browser.close()
    assert not errors, errors
    report = {'result': 'PASS_WITH_COVERAGE_GAP' if coverage_gaps else 'PASS',
              'base': BASE, 'scenarios': results, 'pageErrors': errors, 'coverageGaps': coverage_gaps}
    (OUT / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
