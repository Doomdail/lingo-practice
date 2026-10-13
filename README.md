# Lingo Practice

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

English · [Русский](README.ru.md) · [Download 0.4.6](https://github.com/Doomdail/lingo-practice/releases/tag/v0.4.6) · [Issues](https://github.com/Doomdail/lingo-practice/issues)

Practice listening with YouTube videos. Fill in missing words, replay a line, and revisit difficult parts while keeping your progress on your device.

The `main` branch and release ZIP contain **version 0.4.6**, which opens exercises in a separate extension window.

## Features

- Exercises from YouTube captions, its transcript panel, or a local SRT/VTT file.
- A separate extension window for exercises, answers, settings and subtitle imports.
- Three hints: first letter, replay at 0.75× speed, then reveal the word.
- Separate counts for answers without hints, assisted answers, revealed words, and skips.
- Line replay, optional auto-pause, and mistake review that preserves your main result.
- Adjustable difficulty, subtitle timing, video size, text size, and visible lines.
- Local progress for each video, with protection against conflicting saves from another tab.
- English and Russian interface, selected automatically or manually.
- A lesson library, difficult-word list, CSV export, and local JSON backup and restore.

No account, API key, server, build step, or runtime dependency is required.

## Install

1. Download [lingo-practice-0.4.6.zip](https://github.com/Doomdail/lingo-practice/releases/download/v0.4.6/lingo-practice-0.4.6.zip).
2. Extract it into a permanent folder and find the folder containing `manifest.json`.
3. Open `chrome://extensions`, `opera://extensions`, or `edge://extensions` and enable **Developer mode**.
4. Choose **Load unpacked** and select the folder containing `manifest.json`.
5. Open a regular video at `https://www.youtube.com/watch?...`, wait for the player to load, and click the Lingo Practice extension icon. Version 0.4.6 opens a separate practice window. Keep the video tab open and arrange the two windows side by side. Pin the icon from the browser's extensions menu for easier access.

To update, replace the files in the same installed folder, reload the extension on the extensions page, and reload the YouTube tab. Include `manifest.json`, all extension scripts and pages, `_locales`, and `icons`. Check that the displayed version is **0.4.6**. Removing the extension deletes its local progress; an ordinary update does not require removal.

## Version 0.4.6

- All exercise text, answer fields, settings and file imports run in an independent extension window. YouTube page scripts cannot read keyboard events inside that window.
- The YouTube tab receives media commands, video size and numeric fragment boundaries. It does not receive lesson answers, imported text, file names, word statistics or stored settings objects.
- Caption retrieval still uses YouTube's page context. The site continues to control its player and captions.
- Existing lessons and backups keep the same data format. The `activeTab`, `scripting` and `storage` permissions, Chromium 106 minimum, 8 MB subtitle limit and 10 MB backup limit are unchanged.

Local Chromium 147 checks passed for typing/paste isolation, imports, restored lessons, review, backup, paused seeking, window navigation/reload, worker restart and a suspended practice window. A separate smoke check used YouTube's real player for playback, seeking, slow replay and close cleanup. Automated activation used a temporary test-only host grant; the native toolbar button, Chromium 106 and other browsers still need manual verification.

Download the installable ZIP from [Release 0.4.6](https://github.com/Doomdail/lingo-practice/releases/tag/v0.4.6).

## Version 0.4.5

- Completed exercises and answers without hints are visibly distinguished, including assisted, revealed and skipped answers.
- **My lessons** is available in the practice header. Library cards say **Open video** and explain clicking the extension icon to resume.
- The first-use help starts with listening when exercises are already loaded.
- Missing-caption guidance explains exiting practice, opening YouTube's transcript and returning, with other-video and SRT/VTT alternatives.
- A stalled YouTube transcript panel is reported as a loading failure with recovery steps.
- Fixed practice clicks blocked by YouTube's page transition animations.

Download the installable ZIP from [Release 0.4.5](https://github.com/Doomdail/lingo-practice/releases/tag/v0.4.5).

## Version 0.4.4

This security update blocks forged exercise actions from page scripts, restricts direct storage access, fixes reserved-word handling in statistics, and bounds subtitle parsing and network responses. It preserves existing lessons and requires Chromium 106 or later.

A follow-up review also fixed reopening lessons after YouTube navigation, saving settings before captions load, and backup restoration. Source changes now keep the current lesson until the replacement has been saved successfully.

SRT/VTT files and caption responses are limited to **8 MB** (8,000,000 bytes). Backup JSON files are limited to **10 MB**. Existing progress is preserved by updating in the same installed folder.

Before publication, local checks covered subtitle parsing, storage conflicts, security boundaries, large backup restoration, and an update from 0.4.2. Development plans, test files, and packaging helpers are kept locally and excluded from the public repository.

## Use

### Answers and playback

Type the missing word and press **Enter** or **NumPad Enter**. Matching ignores letter case, surrounding spaces, and typographic apostrophes. You can correct a wrong answer. **Skip** reveals the word and records a skip.

Use **↶ Replay line** or a timestamp to play a line again. **Go to current line** brings the list back to the video's position. Automatic scrolling pauses while an answer field has focus. Optional **Pause at the end of a line** stops playback when that line still needs an answer.

Enter answers and use the practice controls in the separate extension window. Video playback stays in the YouTube tab. **Exit** or closing the practice window restores the page and YouTube's shortcuts. Clicking the extension icon again focuses the existing practice window. After moving to another video, reopen practice with the icon to work on that video. Saved lessons remain in the library.

YouTube's own captions are hidden over the video during practice so they cannot reveal missing words. Their CC setting is left unchanged and the captions reappear after you exit if they were enabled.

### Hints and review

Successive presses of the hint button show the first letter, replay the fragment at **0.75×**, and reveal the answer. The previous playback speed returns when the slow replay ends, playback pauses, or practice closes.

In 0.4.5, **Completed / total exercises** shows progress, including assisted, revealed and skipped answers. Separate visible counts explain answers without hints, assisted answers, revealed words and skips. **Review mistakes** also shows unanswered exercises. A corrected answer without hints counts as independent, while its earlier mistake remains in the review. The published 0.4.4 release displays independent answers / total exercises as its main score.

**Review mistakes** shows the original phrases and mistake/hint counts. Unanswered exercises are included after the video or captions finish. Replay a single fragment or choose **Repeat difficult parts** for a separate practice queue. It waits for an answer at the end of each unfinished fragment. **Back to practice** restores your original answers and playback position; review does not overwrite the main result.

### Settings and languages

**Settings → Interface language** offers English, Russian, or the browser language. Automatic mode uses Russian for `ru` browser locales and English otherwise. Switching languages keeps your answers, drafts, hints, and playback position. Subtitle language is selected separately.

Settings include three video sizes, text from **14–26 px**, and an area for **3–7 lines**. Smaller windows and wrapped text may fit fewer lines; the list, settings, and review can scroll.

**Easy / Balanced / Hard** use word length and a small list of common English words. This is a selection heuristic, not a CEFR assessment. A difficulty change affects only exercises you have not started.

The subtitle offset ranges from **−30 to +30 seconds**, in 0.1-second steps. **Positive values delay subtitles; negative values show them earlier.** For example, `+1.5` delays them by one and a half seconds. Replay and auto-pause use the same offset.

## Subtitle sources

**Automatically** prefers an English track, favoring authored captions over automatic captions, then falls back to the first available track. If direct caption text is unavailable, it tries YouTube's transcript panel. Selecting a particular language requests that track and reports an error if it cannot be loaded.

**YouTube transcript** uses the current language of YouTube's transcript panel. Some transcript timestamps are rounded to seconds, with line endings inferred from the next timestamp. Timing and auto-pause are approximate in that case.

If loading fails, exit practice, expand the video's description, open **Show transcript**, and wait for its text. Start practice again and select **YouTube transcript**, or import a subtitle file.

If a caption request fails, **Copy diagnostics** creates a short report with an error code and technical availability flags. It does not include the video address, title, caption text, answers, or file names. Review the report before sharing it. If clipboard access is blocked, a dialog lets you select and copy the text manually. The current lesson remains available after a failed source change.

**Open SRT/VTT** accepts a UTF-8 `.srt` or `.vtt` file with these limits:

- 8 MB, meaning **8,000,000 bytes**.
- **5,000 segments**, with up to **2,000 characters** per segment.
- Segments starting at the same time are combined, up to **4,000 characters**.
- Timestamps must include milliseconds, and each end must follow its start.

Formatting is removed and multiline text is joined. Invalid files keep the current lesson. A successful source change starts a new lesson for that video and resets its offset. Imported files are read locally and are not uploaded by the extension.

## Progress and privacy

The extension stores one lesson per video and your settings in `chrome.storage.local` in the current browser profile. Saved data includes caption text, selected gaps, answers, mistakes, hints, the source, subtitle offset, and playback position. Imported text is restored without selecting the file again.

The footer shows save status and storage errors. If another tab has newer progress, reopen practice in the older tab to load it. Old lessons do not expire automatically, and progress is not synced between devices.

The 8 MB subtitle file limit is separate from the browser's storage quota: saved tasks also include answers and text fragments. If a replacement cannot be saved, the current lesson stays open. Free space by exporting a backup and deleting unneeded lessons in **My lessons**. JSON backup files are limited to 10 MB.

Open **My lessons** from the practice header or the extension's options page. **Open video** opens YouTube at the saved position; click the Lingo Practice icon there to restore the exercise in its practice window. You can delete individual lessons, search and sort difficult words, and download a CSV word list. **Export backup** downloads a local JSON file containing captions and answers. **Import backup** previews changes before applying them; importing settings is optional. **Delete all data** removes lessons, word statistics, and settings from this browser profile. Keep backup files private and delete them separately when no longer needed.

`activeTab` and `scripting` allow access to the current tab after you click the icon; `storage` saves progress locally. There is no analytics or developer-operated service. Caption requests go to YouTube in the current page's context, and YouTube's normal playback and network activity continue.

The separate practice window belongs to the extension's origin. YouTube scripts cannot read its keyboard events or answer fields, and saved lesson access is restricted to the registered practice window and library. This boundary does not protect against a compromised operating system or another privileged extension. YouTube still controls the video and supplies untrusted captions. Local data and exported backups are not encrypted by Lingo Practice.

Removing the extension or using **Delete all data** clears its saved local data. Exiting practice or disabling the extension does not. See the [Privacy Policy](PRIVACY.md) for details.

## Compatibility

The published 0.4.5 line's YouTube caption loading and lesson reopening were checked in **Chromium, Edge, and Opera GX on Windows**. Its Chromium scenario also checked conflicting tabs and backup restoration after deleting data. Layouts covered desktop and compact windows, including 1440×1050 and 780×800. These results do not establish compatibility of the new 0.4.6 practice window; its local verification results are described above.

Local automation grants YouTube access only in its temporary extension copies to simulate activation. It tests caption hiding with a synthetic caption element. The toolbar button and real YouTube captions in branded Chrome still need a manual check.

Shorts, live streams, mobile YouTube, other video sites, and full-screen practice are unsupported. Exercise tracking is suspended during ads, but not every advertising variant has been tested. Caption availability and accuracy depend on YouTube and the video. Difficulty is optimized for English; there is no dedicated Chinese or Japanese word segmentation.

## Support and license

Report bugs and suggest improvements through [GitHub Issues](https://github.com/Doomdail/lingo-practice/issues). Include the browser version, reproduction steps, and any relevant error message.

Created by [doomdail](https://github.com/Doomdail). Released under the [MIT License](LICENSE).
