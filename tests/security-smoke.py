"""Check real browser security boundaries in an isolated profile. No production hooks.

Run: python tests/security-smoke.py
"""
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from package_release import RUNTIME

VIDEO = 'security01'


def check(playwright, temporary):
    extension = temporary / 'extension'
    for name in RUNTIME:
        target = extension / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    manifest_path = extension / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    # Host access only simulates the browser toolbar click in this temporary copy.
    manifest['host_permissions'] = ['https://www.youtube.com/*']
    manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
    context = playwright.chromium.launch_persistent_context(
        str(temporary / 'profile'), channel='chromium', headless=True,
        args=[f'--disable-extensions-except={extension}', f'--load-extension={extension}'],
        viewport={'width':1440, 'height':1000}, locale='en-US',
    )
    try:
        context.route('https://www.youtube.com/**', lambda route: route.fulfill(
            content_type='text/html', body='<title>Security fixture</title><div id="movie_player"><video></video></div>'))
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate('''() => chrome.storage.local.set({
          preferences: LingoExercise.preferences({language:'en', onboardingSeen:true}),
          'lesson:security01': {schema:2, videoId:'security01', title:'Private lesson',
            sourceLabel:'private.srt', sourceSelection:'file', updatedAt:10, tasks:[
              {id:0,start:0,end:2,text:'Hello world',before:'',answer:'Hello',after:' world',
               value:'private draft',status:'pending',mistakes:0,hints:0}
            ]}
        })''')
        page = context.new_page()
        page.goto(f'https://www.youtube.com/watch?v={VIDEO}')
        tab_id = worker.evaluate('''async () => {
          const tab = (await chrome.tabs.query({url:'https://www.youtube.com/watch*'}))[0];
          await toggleTab(tab); return tab.id;
        }''')

        def probe(selector):
            return worker.evaluate('''async ({tabId, selector}) => (await chrome.scripting.executeScript({
              target:{tabId}, args:[selector], func: selector => {
                const root = chrome.dom.openOrClosedShadowRoot(document.getElementById('lingo-practice-root'));
                const node = root?.querySelector(selector);
                if (!node) return null;
                const r = node.getBoundingClientRect();
                return {value:node.value, text:node.textContent, disabled:node.disabled,
                  x:r.x+r.width/2, y:r.y+r.height/2, open:node.open};
              }
            }))[0].result''', {'tabId':tab_id, 'selector':selector})

        def wait_for(predicate):
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                result = predicate()
                if result:
                    return result
                page.wait_for_timeout(50)
            raise AssertionError('Browser condition timed out')

        def record():
            return worker.evaluate("async () => (await chrome.storage.local.get('lesson:security01'))['lesson:security01']")

        answer = 'input[data-cue="0"]'
        wait_for(lambda: probe(answer))
        assert page.evaluate("document.getElementById('lingo-practice-root').shadowRoot === null"), 'page can read lesson DOM'
        assert probe(answer)['value'] == 'private draft'

        # Even code with a DOM reference cannot forge user actions. The privileged test
        # driver retrieves closed roots; ordinary website scripts cannot use chrome.dom.
        worker.evaluate('''async tabId => chrome.scripting.executeScript({target:{tabId}, func: () => {
          const root = chrome.dom.openOrClosedShadowRoot(document.getElementById('lingo-practice-root'));
          const input = root.querySelector('input[data-cue="0"]');
          input.value = 'forged'; input.dispatchEvent(new Event('input', {bubbles:true}));
          root.querySelector('[data-action="skip"]').click();
        }})''', tab_id)
        assert record()['tasks'][0]['value'] == 'private draft'
        assert record()['tasks'][0]['status'] == 'pending'
        denied = worker.evaluate('''async tabId => (await chrome.scripting.executeScript({target:{tabId}, func: async () => {
          try { await chrome.storage.local.get(null); return false; } catch { return true; }
        }}))[0].result''', tab_id)
        assert denied, 'content script can bypass worker storage checks'

        # Genuine mouse and keyboard input must still save and submit through a closed root.
        bounds = probe(answer)
        page.mouse.click(bounds['x'], bounds['y'])
        page.keyboard.press('Control+a')
        page.keyboard.type('Hello')
        page.keyboard.press('Enter')
        wait_for(lambda: record()['tasks'][0]['status'] == 'correct')

        # DevTools sets the file input through the browser, including its trusted change event.
        subtitle = temporary / 'valid.vtt'
        prefix = b'WEBVTT\n\nNOTE '
        suffix = b'\n\n00:00:00.000 --> 00:00:02.000\nFresh useful words\n'
        subtitle.write_bytes(prefix + b'x' * (8_000_000 - len(prefix) - len(suffix)) + suffix)
        client = context.new_cdp_session(page)

        def file_node(node):
            attrs = dict(zip(node.get('attributes', [])[::2], node.get('attributes', [])[1::2]))
            if node.get('nodeName') == 'INPUT' and attrs.get('type') == 'file':
                return node['backendNodeId']
            for child in node.get('children', []) + node.get('shadowRoots', []):
                found = file_node(child)
                if found:
                    return found

        node_id = file_node(client.send('DOM.getDocument', {'depth':-1, 'pierce':True})['root'])
        assert node_id
        client.send('DOM.setFileInputFiles', {'files':[str(subtitle)], 'backendNodeId':node_id})
        wait_for(lambda: probe('.source-dialog')['open'])
        worker.evaluate('''async tabId => chrome.scripting.executeScript({target:{tabId}, func: () => {
          chrome.dom.openOrClosedShadowRoot(document.getElementById('lingo-practice-root'))
            .querySelector('.source-dialog').close('confirm');
        }})''', tab_id)
        wait_for(lambda: not probe('.source-dialog')['open'])
        wait_for(lambda: not probe('select.language')['disabled'])
        page.wait_for_timeout(100)  # Flush the async close handler and its storage message.
        assert record()['tasks'][0]['text'] == 'Hello world', 'forged dialog returnValue replaced lesson'
        client.send('DOM.setFileInputFiles', {'files':[str(subtitle)], 'backendNodeId':node_id})
        wait_for(lambda: probe('.source-dialog')['open'])
        bounds = probe('.source-dialog button.primary')
        page.mouse.click(bounds['x'], bounds['y'])
        wait_for(lambda: record()['tasks'][0]['text'] == 'Fresh useful words')
        oversized = temporary / 'oversized.vtt'
        oversized.write_bytes(subtitle.read_bytes() + b' ')
        client.send('DOM.setFileInputFiles', {'files':[str(oversized)], 'backendNodeId':node_id})
        wait_for(lambda: 'limit is 8 MB' in probe('.notice')['text'])
        assert record()['tasks'][0]['text'] == 'Fresh useful words'
        print('PASS: closed UI, forged actions and storage denied; answer and 8 MB import saved; larger file rejected')
    finally:
        context.close()


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='lingo-security-') as directory:
        with sync_playwright() as playwright:
            check(playwright, Path(directory))
