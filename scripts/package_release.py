"""Create an installable ZIP using only Python's standard library.

Run: python scripts/package_release.py
"""

import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = (
    "manifest.json", "background.js", "youtube.js", "exercise.js", "data.js",
    "content.js", "i18n.js", "styles.css", "library.html", "library.js",
    "library.css", "_locales/en/messages.json", "_locales/ru/messages.json",
    *(f"icons/icon{size}.png" for size in (16, 32, 48, 128)),
)


def build_release(output_dir):
    files = {
        name: (ROOT / name).read_bytes()
        for name in (*RUNTIME, "README.md", "README.ru.md", "PRIVACY.md", "LICENSE")
    }
    version = json.loads(files["manifest.json"])["version"]
    if not re.fullmatch(r"\d+(?:\.\d+){0,3}", version):
        raise ValueError("Invalid manifest version")
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / f"lingo-practice-{version}.zip"
    with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return destination


if __name__ == "__main__":
    print(build_release(ROOT / "dist"))
