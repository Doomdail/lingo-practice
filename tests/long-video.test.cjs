const assert = require('node:assert/strict');
const test = require('node:test');
const exercise = require('../exercise.js');

test('YouTube captions over the storage limit cannot become an unsavable lesson', () => {
  const cues = exercise.parseJson3({
    events: Array.from({ length: 5001 }, (_, index) => ({
      tStartMs: index * 2000,
      dDurationMs: 1000,
      segs: [{ utf8: 'practice' }],
    })),
  });

  assert.equal(cues.length, 5001);
  assert.equal(exercise.createTasks(cues.slice(0, 5000)).length, 5000);
  assert.throws(() => exercise.createTasks(cues), /5000/);
});

test('YouTube captions with oversized text cannot become an unsavable lesson', () => {
  const caption = (length) =>
    exercise.parseJson3({
      events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'practice ' + 'a'.repeat(length - 9) }] }],
    });

  assert.equal(exercise.createTasks(caption(4000))[0].answer, 'practice');
  assert.throws(() => exercise.createTasks(caption(4001)), /4000/);
});
