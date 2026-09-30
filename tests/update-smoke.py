"""Verify a real 0.4.2 -> current ZIP update in an isolated Chromium profile.

Run: python tests/update-smoke.py (uses an existing Python Playwright installation).
The YouTube page is a local fixture; this checks persistence, not YouTube availability.
"""

import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from package_release import RUNTIME, build_release

VIDEO_ID = "upgrade042"
VIDEO_URL = f"https://www.youtube.com/watch?v={VIDEO_ID}"
SUBTITLES = b"1\n00:00:01,000 --> 00:00:04,000\nElephants remember distant places.\n\n2\n00:00:05,000 --> 00:00:08,000\nPractice makes listening easier.\n"


def prepare_manifest(extension):
    path = extension / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    # Only the test copy gets host access to simulate the toolbar click.
    manifest["host_permissions"] = ["https://www.youtube.com/*"]
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return manifest["version"]


def open_browser(playwright, temporary, extension):
    context = playwright.chromium.launch_persistent_context(
        str(temporary / "profile"), channel="chromium", headless=True,
        args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}"],
        viewport={"width": 1440, "height": 1050}, locale="en-US",
    )
    context.route("https://www.youtube.com/**", lambda route: route.fulfill(
        content_type="text/html",
        body='<title>Update test</title><div id="movie_player"><video></video></div>',
    ))
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event(
        "serviceworker", timeout=15000
    )
    return context, worker


def open_lesson(context, worker):
    page = context.new_page()
    page.goto(VIDEO_URL)
    worker.evaluate("""async () => {
        const tabs = await chrome.tabs.query({url: 'https://www.youtube.com/watch*'});
        await toggleTab(tabs.at(-1));
    }""")
    page.locator("#lingo-practice-root").wait_for()
    return page


def snapshot(worker):
    return worker.evaluate("() => chrome.storage.local.get(null)")


def check_update(playwright, temporary):
    package = build_release(temporary)
    with ZipFile(package) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == set(RUNTIME) | {
            "README.md", "README.ru.md", "PRIVACY.md", "LICENSE",
        }
        packaged_manifest = json.loads(archive.read("manifest.json"))
        expected_version = packaged_manifest["version"]
        assert "host_permissions" not in packaged_manifest
        for name in archive.namelist():
            assert archive.read(name) == (ROOT / name).read_bytes(), name

    old_zip = subprocess.run(
        ["git", "archive", "--format=zip", "v0.4.2"], cwd=ROOT, check=True, capture_output=True,
    ).stdout
    extension = temporary / "extension"
    with ZipFile(io.BytesIO(old_zip)) as archive:
        for name in RUNTIME:
            archive.extract(name, extension)
    assert prepare_manifest(extension) == "0.4.2"
    context, worker = open_browser(playwright, temporary, extension)
    try:
        original_id = worker.evaluate("() => chrome.runtime.id")
        worker.evaluate("""() => chrome.storage.local.set({preferences: LingoExercise.preferences({
            onboardingSeen: true, language: 'en', fontSize: 22, gapFrequency: 'dense'
        })})""")
        page = open_lesson(context, worker)
        expect(page.locator("#lingo-practice-root select.language")).to_be_enabled()
        page.locator("#lingo-practice-root input[type=file]").set_input_files({
            "name": "update.srt", "mimeType": "text/plain", "buffer": SUBTITLES,
        })
        answer = page.locator("#lingo-practice-root input[data-cue='0']")
        answer.wait_for()
        expect(page.locator("#lingo-practice-root .save-status")).to_have_text("Saved on this device")
        correct = snapshot(worker)[f"lesson:{VIDEO_ID}"]["tasks"][0]["answer"]
        answer.fill("wrong-answer")
        answer.press("Enter")
        answer.fill(correct)
        answer.press("Enter")
        page.locator("#lingo-practice-root input[data-cue='1']").fill("unfinished draft")
        expect(page.locator("#lingo-practice-root .save-status")).to_have_text("Saved on this device")
        page.close()
        # A library request is queued after pending lesson saves in the actual worker.
        library = context.new_page()
        library.goto(f"chrome-extension://{original_id}/library.html")
        expect(library.locator(".lesson-card")).to_have_count(1)
        before = snapshot(worker)
        lesson = before[f"lesson:{VIDEO_ID}"]
        assert lesson["tasks"][0]["status"] == "correct"
        assert lesson["tasks"][0]["mistakes"] == 1
        assert lesson["tasks"][1]["value"] == "unfinished draft"
        assert before["wordProfile"]["words"]
    finally:
        context.close()

    with ZipFile(package) as archive:
        archive.extractall(extension)
    version = prepare_manifest(extension)
    assert version == expected_version
    context, worker = open_browser(playwright, temporary, extension)
    try:
        assert worker.evaluate("() => chrome.runtime.id") == original_id
        assert worker.evaluate("() => chrome.runtime.getManifest().version") == version
        assert snapshot(worker) == before, "Updating extension files changed saved data"
        page = open_lesson(context, worker)
        expect(page.locator("#lingo-practice-root input[data-cue='0']")).to_have_value(correct)
        expect(page.locator("#lingo-practice-root input[data-cue='1']")).to_have_value("unfinished draft")
        expect(page.locator("#lingo-practice-root select.language")).to_have_value("file")
        after = snapshot(worker)
        assert after["preferences"] == before["preferences"]
        assert after["wordProfile"] == before["wordProfile"]
        assert after[f"lesson:{VIDEO_ID}"]["tasks"] == lesson["tasks"]
        print(f"PASS: ZIP contents; 0.4.2 -> {version}; same ID, answers, draft, settings, word history")
    finally:
        context.close()


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="lingo-update-") as temporary:
        temporary = Path(temporary).resolve()
        assert temporary.is_relative_to(Path(tempfile.gettempdir()).resolve())
        with sync_playwright() as playwright:
            check_update(playwright, temporary)
