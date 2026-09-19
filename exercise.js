(function (root) {
  'use strict';

  const normalizeAnswer = (value) =>
    String(value).normalize('NFKC').trim().toLocaleLowerCase('en').replace(/[’‘ʼ]/g, "'");
  const hasStarted = (task) =>
    Boolean(task) &&
    (Boolean(task.value) ||
      Number(task.mistakes) > 0 ||
      Number(task.hints) > 0 ||
      task.status !== 'pending');
  const hasUserWork = (tasks) => Array.isArray(tasks) && tasks.some(hasStarted);
  const matches = (value, answer) =>
    Boolean(normalizeAnswer(value)) && normalizeAnswer(value) === normalizeAnswer(answer);
  const spoken = (text) => /\p{L}/u.test(text.replace(/\[[^\]]*\]/g, ''));

  const common = new Set(
    'a an the i you he she it we they me him her us them my your his our their is am are was were be been being have has had do does did to of in on at for from by and or but if as with this that these those so not no yes can will would could should'.split(
      ' ',
    ),
  );
  const PROFILE_COUNTER_FIELDS = ['attempts', 'clean', 'mistakes', 'hints', 'misses'];
  const PROFILE_COUNTER_MAX = 1_000_000;
  const finished = (task) => ['correct', 'assisted', 'skipped', 'revealed'].includes(task.status);
  const isDifficult = (task, includeUnanswered = false) =>
    Boolean(task.answer) &&
    (task.mistakes > 0 ||
      task.hints > 0 ||
      ['skipped', 'revealed'].includes(task.status) ||
      (includeUnanswered && !finished(task)));
  const adaptiveWeight = (entry = {}) => {
    const need = (entry.mistakes ?? 0) + (entry.hints ?? 0) + 2 * (entry.misses ?? 0);
    return Math.min(8, Math.max(0.25, (1 + need) / (1 + (entry.clean ?? 0))));
  };
  const pickWeighted = (words, random, profile) => {
    const weighted = words.map((word) => [
      word,
      adaptiveWeight(profile.words[normalizeAnswer(word[0])]),
    ]);
    const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
    let cursor = Math.min(0.999999999999, Math.max(0, random())) * total;
    return weighted.find(([, weight]) => (cursor -= weight) < 0)?.[0] ?? weighted.at(-1)?.[0];
  };

  function createWithProfile(cue, random = Math.random, difficulty = 'random', profile) {
    // Keep contractions and hyphenated words intact; exclude bracketed cues and common sound labels.
    const excluded = [
      ...cue.text.matchAll(
        /\[[^\]]*\]|\((?:music|applause|laughter|laughing|cheering|inaudible|silence)\)|https?:\/\/\S+|&[a-z][a-z0-9]*;/gi,
      ),
    ];
    let words = [...cue.text.matchAll(/\p{L}[\p{L}\p{M}]*(?:['’‘ʼ-][\p{L}\p{M}]+)*/gu)].filter(
      (word) =>
        word[0].length <= 100 &&
        !/(.)\1{3,}/iu.test(word[0]) &&
        !excluded.some(
          (range) => word.index >= range.index && word.index < range.index + range[0].length,
        ),
    );
    // Common words and word length provide a rough difficulty estimate, not a CEFR level.
    const score = (word) => [...word[0]].length - (common.has(normalizeAnswer(word[0])) ? 6 : 0);
    if (words.length && difficulty === 'easy') {
      const min = Math.min(...words.map(score));
      words = words.filter((word) => score(word) <= min + 2);
    } else if (words.length && difficulty === 'hard') {
      const max = Math.max(...words.map(score));
      words = words.filter((word) => score(word) >= max - 2);
    }
    if (['balanced', 'adaptive'].includes(difficulty)) {
      const meaningful = words.filter(
        (word) => word[0].length >= 4 && !common.has(normalizeAnswer(word[0])),
      );
      if (meaningful.length) words = meaningful;
    }
    const word =
      difficulty === 'adaptive'
        ? pickWeighted(words, random, profile)
        : words[Math.min(words.length - 1, Math.max(0, Math.floor(random() * words.length)))];
    return {
      ...cue,
      before: word ? cue.text.slice(0, word.index) : cue.text,
      answer: word?.[0] ?? null,
      after: word ? cue.text.slice(word.index + word[0].length) : '',
      value: '',
      status: 'pending',
      mistakes: 0,
      hints: 0,
    };
  }

  function restoreWordProfile(value, strict = false) {
    if (!value || value.schema !== 1 || !value.words || Array.isArray(value.words))
      return strict ? null : { schema: 1, words: {} };
    const entries = [];
    for (const [word, raw] of Object.entries(value.words)) {
      const valid =
        Boolean(word) &&
        word === normalizeAnswer(word) &&
        word.length <= 100 &&
        PROFILE_COUNTER_FIELDS.every(
          (key) =>
            Number.isSafeInteger(raw?.[key]) && raw[key] >= 0 && raw[key] <= PROFILE_COUNTER_MAX,
        ) &&
        Number.isSafeInteger(raw?.lastSeenAt) &&
        raw.lastSeenAt >= 0;
      if (!valid) {
        if (strict) return null;
        else continue;
      }
      entries.push([word, { ...raw }]);
    }
    if (strict && entries.length > 2000) return null;
    entries.sort((a, b) => b[1].lastSeenAt - a[1].lastSeenAt || a[0].localeCompare(b[0]));
    return { schema: 1, words: Object.fromEntries(entries.slice(0, 2000)) };
  }

  function usableProfile(value) {
    return restoreWordProfile(value);
  }

  function create(cue, random = Math.random, difficulty = 'random', wordProfile = null) {
    return createWithProfile(cue, random, difficulty, usableProfile(wordProfile));
  }

  function createTasks(cues, options = {}) {
    const random = options.random ?? Math.random;
    const difficulty = preferences(options).difficulty;
    const gapFrequency = preferences(options).gapFrequency;
    const stride = { dense: 1, normal: 2, sparse: 3 }[gapFrequency];
    const wordProfile = usableProfile(options.wordProfile);
    const previous = Array.isArray(options.previousTasks) ? options.previousTasks : [];
    let eligible = 0;
    return cues.map((cue, id) => {
      const prior = previous[id];
      const candidate = createWithProfile({ ...cue, id }, random, difficulty, wordProfile);
      if (!candidate.answer) return candidate;
      const keep = eligible++ % stride === 0;
      if (prior && hasStarted(prior)) return { ...prior };
      return keep ? candidate : { ...candidate, before: candidate.text, answer: null, after: '' };
    });
  }

  function updateWordProfile(profile, previousTasks = [], nextTasks = [], now = Date.now()) {
    const result = structuredClone(restoreWordProfile(profile));
    const samePrompt = (a, b) =>
      a?.id === b.id &&
      a.start === b.start &&
      a.end === b.end &&
      a.text === b.text &&
      normalizeAnswer(a.answer) === normalizeAnswer(b.answer);
    const add = (value, amount) => Math.min(PROFILE_COUNTER_MAX, value + amount);
    for (const [index, next] of nextTasks.entries()) {
      const previous = previousTasks[index];
      if (
        !next?.answer ||
        !finished(next) ||
        (previous && samePrompt(previous, next) && finished(previous))
      )
        continue;
      const key = normalizeAnswer(next.answer);
      const entry = result.words[key] ?? {
        attempts: 0,
        clean: 0,
        mistakes: 0,
        hints: 0,
        misses: 0,
        lastSeenAt: 0,
      };
      entry.attempts = add(entry.attempts, 1);
      entry.clean = add(
        entry.clean,
        next.status === 'correct' && next.mistakes === 0 && next.hints === 0 ? 1 : 0,
      );
      entry.mistakes = add(entry.mistakes, Math.min(5, next.mistakes));
      entry.hints = add(entry.hints, next.hints);
      entry.misses = add(entry.misses, ['skipped', 'revealed'].includes(next.status) ? 1 : 0);
      entry.lastSeenAt = now;
      result.words[key] = entry;
    }
    return restoreWordProfile(result);
  }

  function buildWordProfile(lessons) {
    return [...lessons]
      .sort((a, b) => a.updatedAt - b.updatedAt || a.videoId.localeCompare(b.videoId))
      .reduce((profile, lesson) => updateWordProfile(profile, [], lesson.tasks, lesson.updatedAt), {
        schema: 1,
        words: {},
      });
  }

  function normalizeCues(raw, rolling = true) {
    const result = [];
    let previous = null;
    for (const item of raw
      .filter(
        (c) =>
          Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end > c.start,
      )
      .sort((a, b) => a.start - b.start)) {
      const fullText = String(item.text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!spoken(fullText)) continue;
      let text = fullText;
      if (rolling && previous && item.start < previous.end) {
        // Match overlapping words in rolling captions; timings still belong to whole segments.
        const oldWords = previous.text.split(' '),
          newWords = text.split(' ');
        for (let count = Math.min(oldWords.length, newWords.length); count > 0; count--) {
          if (oldWords.slice(-count).join(' ') === newWords.slice(0, count).join(' ')) {
            text = newWords.slice(count).join(' ');
            break;
          }
        }
      }
      previous = { text: fullText, end: item.end };
      if (!text) {
        if (result.length) result[result.length - 1].end = Math.max(result.at(-1).end, item.end);
        continue;
      }
      if (result.length && result.at(-1).end > item.start) result.at(-1).end = item.start;
      result.push({ start: item.start, end: item.end, text });
    }
    return result.filter((c) => c.end > c.start).map((cue, id) => ({ ...cue, id }));
  }

  function parseJson3(data) {
    const raw = [];
    for (const event of data.events ?? []) {
      if (!Array.isArray(event.segs)) continue;
      const text = event.segs.map((s) => s.utf8 ?? '').join('');
      if (!text.trim()) continue;
      const start = Number(event.tStartMs) / 1000;
      const end = start + Number(event.dDurationMs ?? 3000) / 1000;
      if (event.aAppend && raw.length) {
        raw.at(-1).text += text;
        raw.at(-1).end = Math.max(raw.at(-1).end, end);
      } else raw.push({ start, end, text });
    }
    return normalizeCues(raw);
  }

  function activeIndex(cues, time) {
    let lo = 0,
      hi = cues.length - 1,
      candidate = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= time) {
        candidate = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return candidate >= 0 && time < cues[candidate].end ? candidate : -1;
  }

  function parseSubtitles(input) {
    if (typeof input !== 'string' || input.length > 2_000_000)
      throw new Error('Файл слишком большой: максимум 2 МБ.');
    const clock = (value) => {
      const parts = value.replace(',', '.').split(':').map(Number);
      if (parts.at(-1) >= 60 || parts.at(-2) >= 60)
        throw new Error('Некорректный таймкод в файле субтитров.');
      return parts.reduce((result, part) => result * 60 + part, 0);
    };
    const entities = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' ',
      lrm: '\u200e',
      rlm: '\u200f',
      rsquo: '’',
      lsquo: '‘',
      rdquo: '”',
      ldquo: '“',
      ndash: '–',
      mdash: '—',
      hellip: '…',
    };
    const decoder = typeof document !== 'undefined' ? document.createElement('textarea') : null;
    const clean = (value) => {
      const stripped = value.replace(/<[^>]*>/g, '');
      // The browser's inert textarea decoder handles the complete HTML character-reference set.
      if (decoder) {
        decoder.innerHTML = stripped;
        return decoder.value.replace(/\s+/g, ' ').trim();
      }
      return stripped
        .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, code) => {
          if (!code.startsWith('#')) return entities[code.toLowerCase()] ?? full;
          const number =
            code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
          return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
            ? String.fromCodePoint(number)
            : '\ufffd';
        })
        .replace(/\s+/g, ' ')
        .trim();
    };
    const raw = [];
    const blocks = input
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .trim()
      .split(/\n[ \t]*\n/)
      .map((block) => block.trim())
      .filter(Boolean);
    for (const [blockIndex, block] of blocks.entries()) {
      const lines = block.split('\n');
      if (
        (blockIndex === 0 && /^WEBVTT(?:\s|$)/.test(lines[0])) ||
        /^NOTE(?:\s|$)/.test(lines[0]) ||
        (/^(STYLE|REGION)$/.test(lines[0]) && !block.includes('-->'))
      )
        continue;
      const at = lines.findIndex((line) => line.includes('-->'));
      if (at < 0 || at > 1)
        throw new Error('Не удалось прочитать SRT/VTT: проверьте формат файла.');
      const timing = lines[at].match(
        /^\s*((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$/,
      );
      if (!timing) throw new Error('Некорректный таймкод в файле субтитров.');
      const start = clock(timing[1]),
        end = clock(timing[2]),
        text = clean(lines.slice(at + 1).join(' '));
      if (end <= start || text.length > 2000)
        throw new Error('Некорректный фрагмент субтитров: проверьте время и текст.');
      if (!text) continue;
      raw.push({ start, end, text });
      if (raw.length > 5000) throw new Error('Слишком много фрагментов: максимум 5000.');
    }
    // Simultaneous lines are one exercise; do not lose a line with the same start timestamp.
    const merged = [];
    for (const cue of raw.sort((a, b) => a.start - b.start)) {
      if (merged.at(-1)?.start === cue.start) {
        merged.at(-1).text += ' ' + cue.text;
        merged.at(-1).end = Math.max(merged.at(-1).end, cue.end);
      } else merged.push(cue);
    }
    if (merged.some((cue) => cue.text.length > 4000))
      throw new Error('Слишком длинный объединённый фрагмент: максимум 4000 символов.');
    const cues = normalizeCues(merged, false);
    if (!cues.length) throw new Error('В файле нет речевых субтитров для тренировки.');
    return cues;
  }

  function resultCounts(tasks) {
    const counts = { total: 0, independent: 0, assisted: 0, revealed: 0, skipped: 0, remaining: 0 };
    for (const task of tasks) {
      if (!task.answer) continue;
      counts.total++;
      if (task.status === 'correct') counts.independent++;
      else if (['assisted', 'revealed', 'skipped'].includes(task.status)) counts[task.status]++;
      else counts.remaining++;
    }
    return counts;
  }

  function preferences(value = {}) {
    const number = (key, fallback, min, max) =>
      Number.isFinite(Number(value[key]))
        ? Math.min(max, Math.max(min, Number(value[key])))
        : fallback;
    return {
      difficulty: ['easy', 'balanced', 'hard', 'adaptive'].includes(value.difficulty)
        ? value.difficulty
        : 'balanced',
      gapFrequency: ['dense', 'normal', 'sparse'].includes(value.gapFrequency)
        ? value.gapFrequency
        : 'dense',
      language: ['ru', 'en'].includes(value.language) ? value.language : 'auto',
      videoSize: ['small', 'medium', 'large'].includes(value.videoSize)
        ? value.videoSize
        : 'medium',
      fontSize: number('fontSize', 18, 14, 26),
      visibleRows: Math.round(number('visibleRows', 5, 3, 7)),
      autoPause: value.autoPause === true,
      onboardingSeen: value.onboardingSeen === true,
    };
  }

  function restoreSession(saved, videoId) {
    if (
      !saved ||
      saved.schema !== 2 ||
      saved.videoId !== videoId ||
      !Array.isArray(saved.tasks) ||
      !saved.tasks.length ||
      saved.tasks.length > 5000
    )
      return null;
    const tasks = [];
    for (const [id, item] of saved.tasks.entries()) {
      if (
        !item ||
        !Number.isFinite(item.start) ||
        !Number.isFinite(item.end) ||
        item.start < 0 ||
        item.end <= item.start ||
        (tasks.length && item.start < tasks.at(-1).end) ||
        typeof item.text !== 'string' ||
        item.text.length > 4000 ||
        typeof item.before !== 'string' ||
        typeof item.after !== 'string' ||
        (item.answer !== null && typeof item.answer !== 'string') ||
        item.before + (item.answer ?? '') + item.after !== item.text ||
        typeof item.value !== 'string' ||
        item.value.length > 100 ||
        !['pending', 'wrong', 'correct', 'assisted', 'skipped', 'revealed'].includes(item.status)
      )
        return null;
      if (finished(item) && (!item.answer || !matches(item.value, item.answer))) return null;
      tasks.push({
        id,
        start: item.start,
        end: item.end,
        text: item.text,
        before: item.before,
        after: item.after,
        answer: item.answer,
        value: item.value,
        status: item.status,
        mistakes: Math.max(0, Math.min(1000, Math.floor(Number(item.mistakes) || 0))),
        hints: Math.max(0, Math.min(3, Math.floor(Number(item.hints) || 0))),
      });
    }
    return {
      schema: 2,
      videoId,
      tasks,
      title: String(saved.title ?? '').slice(0, 500),
      sourceLabel: String(saved.sourceLabel ?? '').slice(0, 300),
      sourceSelection: /^(auto|transcript|file|\d+)$/.test(saved.sourceSelection)
        ? saved.sourceSelection
        : 'auto',
      approximate: saved.approximate === true,
      difficulty: preferences(saved).difficulty,
      gapFrequency: preferences(saved).gapFrequency,
      offset: Number.isFinite(saved.offset) ? Math.max(-30, Math.min(30, saved.offset)) : 0,
      position: Number.isFinite(saved.position) ? Math.max(0, Math.min(604800, saved.position)) : 0,
      updatedAt: Number(saved.updatedAt) || 0,
    };
  }

  const api = {
    matches,
    create,
    createTasks,
    restoreWordProfile,
    updateWordProfile,
    buildWordProfile,
    normalizeAnswer,
    hasStarted,
    hasUserWork,
    normalizeCues,
    parseJson3,
    parseSubtitles,
    activeIndex,
    finished,
    isDifficult,
    resultCounts,
    preferences,
    restoreSession,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LingoExercise = api;
})(globalThis);
