(function (root) {
  'use strict';

  const exercise =
    typeof module !== 'undefined' && module.exports ? require('./exercise.js') : root.LingoExercise;
  const limits = { backupBytes: 10_000_000, lessons: 1000, tasks: 5000, words: 2000 };

  function vocabulary(profileValue, lessons) {
    const profile = exercise.restoreWordProfile(profileValue);
    const contexts = new Map();
    for (const lesson of [...lessons].sort((a, b) => b.updatedAt - a.updatedAt)) {
      for (const task of [...lesson.tasks].reverse()) {
        if (!task.answer || !exercise.isDifficult(task)) continue;
        const word = exercise.normalizeAnswer(task.answer);
        if (!contexts.has(word))
          contexts.set(word, {
            text: task.text,
            time: task.start + lesson.offset,
            videoTitle: lesson.title,
            videoId: lesson.videoId,
            source: lesson.sourceLabel,
          });
      }
    }
    const words = new Set([...Object.keys(profile.words), ...contexts.keys()]);
    return [...words]
      .map((word) => {
        const entry = Object.hasOwn(profile.words, word)
          ? profile.words[word]
          : {
              attempts: 0,
              clean: 0,
              mistakes: 0,
              hints: 0,
              misses: 0,
              lastSeenAt: 0,
            };
        return {
          word,
          attempts: entry.attempts,
          clean: entry.clean,
          mistakes: entry.mistakes,
          hints: entry.hints,
          misses: entry.misses,
          lastSeenAt: entry.lastSeenAt,
          score: entry.mistakes + entry.hints + 2 * entry.misses,
          context: contexts.get(word) ?? null,
        };
      })
      .filter((entry) => entry.score > 0 || entry.context);
  }

  const csvCell = (value) => {
    let text = String(value ?? '').replace(/\r\n?|\n/g, '\r\n');
    if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };

  function createVocabularyCsv(entries) {
    const columns = [
      'word',
      'context',
      'attempts',
      'clean',
      'mistakes',
      'hints',
      'misses',
      'time',
      'video_title',
      'video_id',
      'source',
    ];
    const rows = entries.map((entry) =>
      [
        entry.word,
        entry.context?.text ?? entry.context,
        entry.attempts,
        entry.clean,
        entry.mistakes,
        entry.hints,
        entry.misses,
        entry.context?.time ?? entry.time,
        entry.context?.videoTitle ?? entry.videoTitle,
        entry.context?.videoId ?? entry.videoId,
        entry.context?.source ?? entry.source,
      ]
        .map(csvCell)
        .join(','),
    );
    return '\uFEFF' + columns.join(',') + '\r\n' + rows.join('\r\n') + (rows.length ? '\r\n' : '');
  }

  function canonicalWordProfile(value, strict = false) {
    if (
      strict &&
      (!value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !Object.hasOwn(value, 'schema') ||
        !Object.hasOwn(value, 'words') ||
        !value.words ||
        typeof value.words !== 'object' ||
        Array.isArray(value.words))
    )
      return null;
    const restored = exercise.restoreWordProfile(value, strict);
    if (!restored) return null;
    return {
      schema: 1,
      words: Object.fromEntries(
        Object.entries(restored.words).map(([word, entry]) => [
          word,
          {
            attempts: entry.attempts,
            clean: entry.clean,
            mistakes: entry.mistakes,
            hints: entry.hints,
            misses: entry.misses,
            lastSeenAt: entry.lastSeenAt,
          },
        ]),
      ),
    };
  }

  function validLesson(raw) {
    if (
      !raw ||
      raw.schema !== 2 ||
      typeof raw.videoId !== 'string' ||
      !raw.videoId ||
      !Array.isArray(raw.tasks) ||
      !raw.tasks.length ||
      raw.tasks.length > limits.tasks ||
      typeof raw.title !== 'string' ||
      raw.title.length > 500 ||
      typeof raw.sourceLabel !== 'string' ||
      raw.sourceLabel.length > 300 ||
      !/^(auto|transcript|file|\d+)$/.test(raw.sourceSelection) ||
      typeof raw.approximate !== 'boolean' ||
      !['easy', 'balanced', 'hard', 'adaptive'].includes(raw.difficulty) ||
      !['dense', 'normal', 'sparse'].includes(raw.gapFrequency) ||
      !Number.isFinite(raw.offset) ||
      raw.offset < -30 ||
      raw.offset > 30 ||
      !Number.isFinite(raw.position) ||
      raw.position < 0 ||
      raw.position > 604800 ||
      !Number.isFinite(raw.updatedAt) ||
      raw.updatedAt < 0
    )
      return false;
    return raw.tasks.every(
      (task, id) =>
        task &&
        task.id === id &&
        Number.isFinite(task.start) &&
        Number.isFinite(task.end) &&
        task.start >= 0 &&
        task.end > task.start &&
        (id === 0 || task.start >= raw.tasks[id - 1].end) &&
        typeof task.text === 'string' &&
        task.text.length <= 4000 &&
        typeof task.before === 'string' &&
        typeof task.after === 'string' &&
        (task.answer === null || typeof task.answer === 'string') &&
        task.before + (task.answer ?? '') + task.after === task.text &&
        typeof task.value === 'string' &&
        task.value.length <= 100 &&
        ['pending', 'wrong', 'correct', 'assisted', 'skipped', 'revealed'].includes(task.status) &&
        Number.isSafeInteger(task.mistakes) &&
        task.mistakes >= 0 &&
        task.mistakes <= 1000 &&
        Number.isSafeInteger(task.hints) &&
        task.hints >= 0 &&
        task.hints <= 3 &&
        (!exercise.finished(task) ||
          (Boolean(task.answer) && exercise.matches(task.value, task.answer))),
    );
  }

  function createBackup(state, exportedAt = new Date().toISOString()) {
    return {
      format: 'lingo-practice-backup',
      version: 1,
      exportedAt,
      preferences: exercise.preferences(state.preferences),
      wordProfile: canonicalWordProfile(state.wordProfile),
      lessons: state.lessons.map((lesson) => exercise.restoreSession(lesson, lesson.videoId)),
    };
  }

  function validPreferences(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const normalized = exercise.preferences(value);
    return [
      'difficulty',
      'gapFrequency',
      'language',
      'videoSize',
      'fontSize',
      'visibleRows',
      'autoPause',
      'onboardingSeen',
    ].every((key) => !Object.hasOwn(value, key) || value[key] === normalized[key]);
  }

  function parseBackup(value) {
    const fail = (message) => ({ ok: false, message });
    let encoded;
    try {
      encoded = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
      return fail('Не удалось прочитать JSON резервной копии.');
    }
    if (encoded > limits.backupBytes)
      return fail('Резервная копия слишком большая: максимум 10 МБ.');
    if (!value || value.format !== 'lingo-practice-backup' || value.version !== 1)
      return fail('Неподдерживаемый формат резервной копии.');
    if (
      typeof value.exportedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.exportedAt)) ||
      !value.preferences ||
      typeof value.preferences !== 'object' ||
      Array.isArray(value.preferences) ||
      !validPreferences(value.preferences) ||
      !Array.isArray(value.lessons) ||
      value.lessons.length > limits.lessons
    )
      return fail('Резервная копия повреждена или превышает лимиты.');
    const ids = new Set();
    const lessons = [];
    for (const raw of value.lessons) {
      if (!validLesson(raw))
        return fail('Резервная копия содержит неверное или повторяющееся занятие.');
      const lesson = exercise.restoreSession(raw, raw.videoId);
      if (!lesson || ids.has(lesson.videoId))
        return fail('Резервная копия содержит неверное или повторяющееся занятие.');
      ids.add(lesson.videoId);
      lessons.push(lesson);
    }
    const wordProfile = canonicalWordProfile(value.wordProfile, true);
    if (!wordProfile) return fail('Резервная копия содержит неверный профиль слов.');
    return {
      ok: true,
      backup: {
        format: 'lingo-practice-backup',
        version: 1,
        exportedAt: value.exportedAt,
        preferences: exercise.preferences(value.preferences),
        wordProfile,
        lessons,
      },
    };
  }

  function mergeWords(localValue, importedValue, summary) {
    const local = canonicalWordProfile(localValue);
    const imported = canonicalWordProfile(importedValue, true);
    for (const [word, entry] of Object.entries(imported.words)) {
      if (!Object.hasOwn(local.words, word) || entry.lastSeenAt > local.words[word].lastSeenAt) {
        Object.defineProperty(local.words, word, {
          value: { ...entry },
          enumerable: true,
          writable: true,
          configurable: true,
        });
        summary.wordsUpdated++;
      }
    }
    return canonicalWordProfile(local);
  }

  function planBackupImport(current, backup, importPreferences = false) {
    const localById = new Map(current.lessons.map((lesson) => [lesson.videoId, lesson]));
    const nextLessons = [...current.lessons];
    const changedLessons = [];
    const summary = { added: 0, updated: 0, skipped: 0, wordsUpdated: 0 };
    for (const lesson of backup.lessons) {
      const local = localById.get(lesson.videoId);
      if (!local) {
        nextLessons.push(lesson);
        changedLessons.push(lesson);
        summary.added++;
      } else if (lesson.updatedAt > local.updatedAt) {
        nextLessons[nextLessons.indexOf(local)] = lesson;
        changedLessons.push(lesson);
        summary.updated++;
      } else summary.skipped++;
    }
    return {
      summary,
      changedLessons,
      next: {
        lessons: nextLessons,
        preferences: importPreferences ? backup.preferences : current.preferences,
        wordProfile: mergeWords(current.wordProfile, backup.wordProfile, summary),
      },
    };
  }

  const api = {
    limits,
    vocabulary,
    createVocabularyCsv,
    createBackup,
    parseBackup,
    planBackupImport,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LingoData = api;
})(globalThis);
