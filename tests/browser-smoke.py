"""Run a live YouTube smoke check in isolated Chromium browser profiles.

Requires an existing Python Playwright installation. Run: python tests/browser-smoke.py
"""

import json
import os
import re
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright
from lesson_ui import LessonUI


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from package_release import RUNTIME

VIDEO_ID = "jNQXAC9IVRw"
VIDEO_URL = f"https://www.youtube.com/watch?v={VIDEO_ID}"
BROWSERS = {
    "Chromium": None,
    "Edge": Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    "Opera GX": Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Opera GX/opera.exe",
}


def wait_for_record(worker, predicate, page):
    record = None
    for _ in range(40):
        record = worker.evaluate(
            f"async () => (await chrome.storage.local.get('lesson:{VIDEO_ID}'))['lesson:{VIDEO_ID}']"
        )
        if record and predicate(record):
            return record
        page.wait_for_timeout(250)
    raise AssertionError(
        f"lesson was not saved; revision={record.get('revision') if record else None}"
    )


def activate(worker):
    return worker.evaluate("""async () => {
        const tabs = await chrome.tabs.query({url: 'https://www.youtube.com/watch*'});
        await toggleTab(tabs.at(-1));
        return tabs.at(-1).id;
    }""")


def check_data_durability(context, worker, page, ui, answer_index):
    """Exercise real tabs and the library's export, clear, and import controls."""
    second = context.new_page()
    second.goto(VIDEO_URL, wait_until="domcontentloaded", timeout=45000)
    second.locator("#movie_player video").wait_for(timeout=30000)
    second_ui = LessonUI(second, worker, activate(worker))
    second_ui.wait(f"input[data-cue='{answer_index}']")
    fresh = wait_for_record(worker, lambda r: len(r["tasks"]) > answer_index + 1, page)
    next_index = next(
        i for i, task in enumerate(fresh["tasks"])
        if i != answer_index and task["answer"] and task["status"] == "pending"
    )
    selector = f"input[data-cue='{next_index}']"
    second_ui.fill(selector, fresh["tasks"][next_index]["answer"])
    second_ui.press("Enter")
    saved = wait_for_record(worker, lambda r: r["tasks"][next_index]["status"] == "correct", page)
    ui.fill(selector, saved["tasks"][next_index]["answer"])
    ui.press("Enter")
    ui.wait('.save-status.error')
    assert wait_for_record(worker, lambda r: r["revision"] == saved["revision"], page) == saved

    extension_id = worker.evaluate("() => chrome.runtime.id")
    library = context.new_page()
    library.goto(f"chrome-extension://{extension_id}/library.html")
    library.locator(".lesson-card").wait_for(timeout=10000)
    library.locator("#export-backup").click()
    with library.expect_download() as download_info:
        library.locator("#download-backup").click()
    backup_file = download_info.value.path()
    backup = json.loads(Path(backup_file).read_text(encoding="utf-8"))
    exported = next(lesson for lesson in backup["lessons"] if lesson["videoId"] == VIDEO_ID)
    assert exported["tasks"][next_index]["status"] == "correct"

    library.locator("#clear-data").click()
    library.locator("#confirm-dialog[open] #confirm-action").click()
    library.get_by_text("Сохранённых занятий пока нет.").wait_for(timeout=10000)
    assert worker.evaluate("async () => (await chrome.storage.local.get(null)).storageEpoch") == 1
    stale_index = next(
        i for i, task in enumerate(saved["tasks"])
        if i not in (answer_index, next_index) and task["answer"] and task["status"] == "pending"
    )
    second_ui.fill(f"input[data-cue='{stale_index}']", saved["tasks"][stale_index]["answer"])
    second_ui.press("Enter")
    second_ui.wait('.save-status.error')
    assert worker.evaluate(
        f"async () => (await chrome.storage.local.get('lesson:{VIDEO_ID}'))['lesson:{VIDEO_ID}']"
    ) is None

    library.locator("#backup-file").set_input_files(str(backup_file))
    library.locator("#apply-import").wait_for(state="visible", timeout=10000)
    library.locator("#apply-import").click()
    library.locator(".lesson-card").wait_for(timeout=10000)
    restored = wait_for_record(worker, lambda r: r["tasks"][next_index]["status"] == "correct", page)
    assert restored["tasks"][answer_index]["status"] == "correct"
    assert restored["tasks"][stale_index]["status"] == "pending"
    library.close()
    second.close()


def smoke(playwright, name, executable):
    with tempfile.TemporaryDirectory(prefix="lingo-smoke-") as temporary:
        temporary = Path(temporary).resolve()
        assert temporary.is_relative_to(Path(tempfile.gettempdir()).resolve())
        extension = temporary / "extension"
        for relative in RUNTIME:
            destination = extension / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)
        # Playwright cannot click the browser toolbar; grant its activeTab access in this copy only.
        manifest = extension / "manifest.json"
        settings = json.loads(manifest.read_text(encoding="utf-8"))
        settings["host_permissions"] = ["https://www.youtube.com/*"]
        manifest.write_text(json.dumps(settings), encoding="utf-8")
        launch = {"channel": "chromium"} if executable is None else {"executable_path": str(executable)}
        context = playwright.chromium.launch_persistent_context(
            str(temporary / "profile"), headless=True, **launch,
            args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}"],
            viewport={"width": 1440, "height": 1050}, locale="ru-RU",
        )
        page = None
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event(
                "serviceworker", timeout=15000
            )
            page = context.new_page()
            page.add_init_script("""document.addEventListener('play', event => {
                if (event.target instanceof HTMLVideoElement) event.target.pause();
            }, true);""")
            page.goto(VIDEO_URL, wait_until="domcontentloaded", timeout=45000)
            consent = page.get_by_role("button", name=re.compile("Reject all|Запретить использование файлов cookie"))
            try:
                consent.click(timeout=2000)
            except PlaywrightTimeout:
                pass
            page.locator("#movie_player video").wait_for(timeout=30000)
            worker.evaluate("() => chrome.storage.local.set({preferences: {onboardingSeen: true}})")
            ui = LessonUI(page, worker, activate(worker))
            ui.wait('input[data-cue]')
            page.evaluate("""() => {
                const caption = document.createElement('div');
                caption.id = 'lingo-smoke-caption';
                caption.className = 'caption-window-container';
                caption.style.display = 'block';
                document.querySelector('#movie_player').append(caption);
            }""")
            caption = page.locator("#lingo-smoke-caption")
            assert caption.evaluate("node => getComputedStyle(node).display") == "none"
            ui.click('select.language')
            ui.press('Home')
            ui.press('ArrowDown')
            ui.press('Enter')
            ui.wait('select.language', lambda node: node['value'] == 'transcript' and not node['disabled'])
            answer = ui.wait('input[data-cue]')
            rows = len(ui.nodes('input[data-cue]'))
            index = int(answer['attributes']['data-cue'])
            record = wait_for_record(worker, lambda r: len(r["tasks"]) > index, page)
            expected = record["tasks"][index]["answer"]
            assert expected
            ui.fill(f"input[data-cue='{index}']", expected)
            ui.press("Enter")
            wait_for_record(worker, lambda r: r["tasks"][index]["status"] == "correct", page)
            activate(worker)
            page.wait_for_function("() => !document.querySelector('#lingo-practice-root')")
            assert caption.evaluate("node => getComputedStyle(node).display") != "none"
            activate(worker)
            ui.wait(f"input[data-cue='{index}']", lambda node: node['value'] == expected)
            assert caption.evaluate("node => getComputedStyle(node).display") == "none"
            if name == "Chromium":
                check_data_durability(context, worker, page, ui, index)
            activate(worker)
            page.wait_for_function("() => !document.querySelector('#lingo-practice-root')")
            assert caption.evaluate("node => getComputedStyle(node).display") != "none"
            return f"{name}: PASS; {rows} exercises, transcript, captions, resume" + (
                ", two tabs, backup, clear, restore" if name == "Chromium" else ""
            )
        except Exception as error:
            notice = ""
            if page and not page.is_closed():
                try:
                    notice = ui.nodes('.notice')
                except Exception:
                    pass
            raise AssertionError(f"{name}: {error}; notice={notice!r}") from error
        finally:
            context.close()


if __name__ == "__main__":
    failures = []
    with sync_playwright() as playwright:
        for name, executable in BROWSERS.items():
            if executable is not None and not executable.is_file():
                print(f"{name}: SKIP (browser not installed)")
                continue
            try:
                print(smoke(playwright, name, executable), flush=True)
            except Exception as error:
                failures.append(str(error))
                print(f"{name}: FAIL {error}", flush=True)
                traceback.print_exception(error)
    print("Chrome: SKIP (branded Chrome blocks command-line extension loading)")
    if failures:
        raise SystemExit(1)
