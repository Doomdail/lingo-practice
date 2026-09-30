"""Inspect closed extension UI via privileged test driver; interact with real input."""
import time


class LessonUI:
    def __init__(self, page, worker, tab_id):
        self.page, self.worker, self.tab_id = page, worker, tab_id

    def nodes(self, selector, scroll=False):
        return self.worker.evaluate('''async ({tabId, selector, scroll}) =>
          (await chrome.scripting.executeScript({target:{tabId}, args:[selector, scroll],
            func:(selector, scroll) => {
              const host = document.getElementById('lingo-practice-root');
              const root = host && chrome.dom.openOrClosedShadowRoot(host);
              return [...(root?.querySelectorAll(selector) ?? [])].map(node => {
                if (scroll) node.scrollIntoView({block:'center'});
                const r = node.getBoundingClientRect();
                return {text:node.textContent, value:node.value, disabled:node.disabled,
                  attributes:Object.fromEntries([...node.attributes].map(a => [a.name,a.value])),
                  x:r.x+r.width/2, y:r.y+r.height/2};
              });
            }
          }))[0].result''', {'tabId':self.tab_id, 'selector':selector, 'scroll':scroll})

    def wait(self, selector, predicate=lambda node: True, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            nodes = self.nodes(selector)
            if nodes and predicate(nodes[0]):
                return nodes[0]
            self.page.wait_for_timeout(100)
        raise AssertionError(f'Lesson UI condition timed out: {selector}')

    def click(self, selector):
        self.wait(selector, lambda node: not node.get('disabled'))
        node = self.nodes(selector, scroll=True)[0]
        self.page.mouse.click(node['x'], node['y'])

    def fill(self, selector, value):
        self.click(selector)
        self.page.keyboard.press('Control+a')
        self.page.keyboard.insert_text(value)

    def press(self, key):
        self.page.keyboard.press(key)
