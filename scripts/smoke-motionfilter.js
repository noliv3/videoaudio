#!/usr/bin/env node
const assert = require('assert');
const { buildMotionFilterSpec, createMotionVideoFromImage } = require('../src/runner/ffmpeg');

function main() {
  const { filter } = buildMotionFilterSpec({
    fps: 24,
    durationSeconds: 2,
    targetWidth: 640,
    targetHeight: 360,
    seed: 123,
  });

  assert(filter.includes('zoompan=z='), 'zoompan expression missing');
  assert(!filter.includes('+-'), 'filter contains invalid +- sequence');
  assert(!filter.includes(",zoom='"), "filter contains stray zoom filter");

  console.log('motion filter smoke ok');
  console.log('motion fn typeof', typeof createMotionVideoFromImage);
}

main();
