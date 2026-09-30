"""Check backup size and settings previews in a real, isolated extension page.

Run: python tests/library-roundtrip.py
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from package_release import RUNTIME


def roundtrip(context, worker):
    page = context.new_page()
    try:
        page.goto(f"chrome-extension://{worker.evaluate('() => chrome.runtime.id')}/library.html")
        page.locator('.lesson-card').wait_for()
        page.locator('#export-backup').click()
        with page.expect_download() as downloaded:
            page.locator('#download-backup').click()
        backup = Path(downloaded.value.path())
        size = backup.stat().st_size
        assert 9_000_000 < size <= 10_000_000, f'exported file exceeds import limit: {size} bytes'
        page.locator('#clear-data').click()
        page.locator('#confirm-action').click()
        expect(page.locator('.lesson-card')).to_have_count(0)
        page.locator('#backup-file').set_input_files(str(backup))
        expect(page.locator('#apply-import')).to_be_enabled(timeout=15000)
        page.locator('#apply-import').click()
        expect(page.locator('#import-dialog')).not_to_be_visible(timeout=15000)
        restored = worker.evaluate("""async () => {
          const lesson = (await chrome.storage.local.get('lesson:roundtrip01'))['lesson:roundtrip01'];
          return {count:lesson.tasks.length, first:lesson.tasks[0].text, last:lesson.tasks.at(-1).start};
        }""")
        assert restored == {'count': 5000, 'first': 'x' * 875, 'last': 9998}, restored
        print(f'PASS: {size}-byte downloaded backup imports and restores all 5000 tasks', flush=True)
    finally:
        page.close()


def preferences_preview(context, worker, temporary):
    backup = temporary / 'settings.json'
    backup.write_text(json.dumps({
        'format': 'lingo-practice-backup', 'version': 1, 'exportedAt': '2026-10-01T00:00:00Z',
        'preferences': {'fontSize': 22}, 'wordProfile': {'schema': 1, 'words': {}}, 'lessons': [],
    }), encoding='utf-8')
    page = context.new_page()
    try:
        page.goto(f"chrome-extension://{worker.evaluate('() => chrome.runtime.id')}/library.html")
        expect(page.locator('#load-status')).not_to_be_visible()
        # Delay only the second real preview request so its pending state is observable.
        page.evaluate("""() => {
          const send = chrome.runtime.sendMessage.bind(chrome.runtime);
          window.previewRequests = [];
          chrome.runtime.sendMessage = async message => {
            if (message.action === 'previewImport') {
              window.previewRequests.push(message.importPreferences);
              if (window.previewRequests.length > 1)
                await new Promise(resolve => { window.releasePreview = resolve; });
            }
            return send(message);
          };
        }""")
        page.locator('#backup-file').set_input_files(str(backup))
        expect(page.locator('#apply-import')).to_be_enabled()
        page.locator('#import-preferences').check()
        page.wait_for_function('() => window.previewRequests.length === 2', timeout=3000)
        expect(page.locator('#apply-import')).to_be_disabled()
        assert page.evaluate('() => window.previewRequests') == [False, True]
        page.evaluate('() => window.releasePreview()')
        expect(page.locator('#apply-import')).to_be_enabled()
        page.locator('#apply-import').click()
        expect(page.locator('#import-dialog')).not_to_be_visible()
        assert worker.evaluate("async () => (await chrome.storage.local.get('preferences')).preferences.fontSize") == 22
        print('PASS: settings checkbox refreshes preview and applies the chosen settings', flush=True)
    finally:
        page.close()


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='lingo-library-') as directory, sync_playwright() as playwright:
        temporary = Path(directory)
        extension = temporary / 'extension'
        for name in RUNTIME:
            destination = extension / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, destination)
        context = playwright.chromium.launch_persistent_context(
            str(temporary / 'profile'), channel='chromium', headless=True,
            args=[f'--disable-extensions-except={extension}', f'--load-extension={extension}'],
        )
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            worker.evaluate("""() => chrome.storage.local.set({
              wordProfile: {schema:1,words:{}}, preferences:LingoExercise.preferences({language:'en'}),
              'lesson:roundtrip01': {schema:2,videoId:'roundtrip01',title:'Large lesson',sourceLabel:'English',
                sourceSelection:'auto',approximate:false,difficulty:'balanced',gapFrequency:'dense',
                offset:0,position:0,updatedAt:10,tasks:Array.from({length:5000}, (_, id) => ({
                  id,start:id*2,end:id*2+1,text:'x'.repeat(875),before:'x'.repeat(875),answer:null,
                  after:'',value:'',status:'pending',mistakes:0,hints:0,
                }))},
            })""")
            failures = []
            for name, check in [('roundtrip', lambda: roundtrip(context, worker)),
                                ('settings preview', lambda: preferences_preview(context, worker, temporary))]:
                try:
                    check()
                except Exception as error:
                    failures.append(f'{name}: {error}')
                    print(f'FAIL: {name}: {error}', flush=True)
            if failures:
                raise SystemExit(1)
        finally:
            context.close()
