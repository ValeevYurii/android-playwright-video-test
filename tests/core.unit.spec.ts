import { expect, test } from '@playwright/test';
import {
  buildSwipePoints,
  findActivePanelIndex,
  playbackAdvanced,
  promiseWithTimeout,
  transitionProblem,
  type MediaSnapshot,
} from '../src/core.js';
import { scenarioConfig } from '../src/config.js';
import { selectAndroidDevice } from '../src/swipe.js';

const media = (overrides: Partial<MediaSnapshot> = {}): MediaSnapshot => ({
  src: 'https://cdn.example/step-1.mp4',
  currentTime: 1,
  duration: 10,
  readyState: 4,
  networkState: 1,
  paused: false,
  seeking: false,
  ended: false,
  totalVideoFrames: 20,
  error: null,
  ...overrides,
});

test('findActivePanelIndex chooses the panel aligned with the viewport', () => {
  expect(findActivePanelIndex(0, [0, 412, 824])).toBe(0);
  expect(findActivePanelIndex(0, [-412, 0, 412])).toBe(1);
  expect(findActivePanelIndex(12, [-812, -400, 12, 424])).toBe(2);
});

test('playbackAdvanced accepts timeline progress', () => {
  expect(playbackAdvanced(media(), media({ currentTime: 1.7 }), 0.4)).toBe(true);
});

test('playbackAdvanced accepts decoded frames when a looping video wraps', () => {
  expect(
    playbackAdvanced(
      media({ currentTime: 9.8, totalVideoFrames: 200 }),
      media({ currentTime: 0.2, totalVideoFrames: 208 }),
      0.4,
    ),
  ).toBe(true);
});

test('playbackAdvanced rejects a stalled video', () => {
  expect(playbackAdvanced(media(), media(), 0.4)).toBe(false);
});

test('playbackAdvanced rejects a paused video even after timeline progress', () => {
  expect(playbackAdvanced(media(), media({ currentTime: 1.7, paused: true }), 0.4)).toBe(false);
});

test('playbackAdvanced rejects an ended video even after decoded frames advance', () => {
  expect(
    playbackAdvanced(media(), media({ totalVideoFrames: 24, ended: true }), 0.4),
  ).toBe(false);
});

test('transitionProblem requires the next panel and a new video source', () => {
  expect(
    transitionProblem(
      { activeIndex: 0, panelCount: 7, media: media() },
      { activeIndex: 1, panelCount: 7, media: media({ src: 'https://cdn.example/step-2.mp4' }) },
      1,
    ),
  ).toBeNull();

  expect(
    transitionProblem(
      { activeIndex: 0, panelCount: 7, media: media() },
      { activeIndex: 0, panelCount: 7, media: media() },
      1,
    ),
  ).toContain('active panel');
});

test('buildSwipePoints creates a horizontal left swipe inside the video bounds', () => {
  expect(buildSwipePoints({ x: 20, y: 100, width: 400, height: 240 })).toEqual({
    from: { x: 340, y: 220 },
    segments: [{ x: 100, y: 220 }],
    steps: 60,
  });
});

test('promiseWithTimeout rejects a pending operation within its own deadline', async () => {
  const slowOperation = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 50));
  await expect(promiseWithTimeout(slowOperation, 10, 'carousel snapshot')).rejects.toThrow(
    /carousel snapshot.*10 ms/i,
  );
});

test('scenarioConfig uses stable defaults and environment overrides', () => {
  const defaults = scenarioConfig({});
  expect(defaults.swipeCount).toBe(4);
  expect(defaults.stallTimeoutMs).toBe(45_000);
  expect(defaults.recipeUrl).toContain('/recipes/kurinyi-sup-piure-so-slivkami');

  const overridden = scenarioConfig({ SWIPE_COUNT: '3', STALL_TIMEOUT_MS: '9000' });
  expect(overridden.swipeCount).toBe(3);
  expect(overridden.stallTimeoutMs).toBe(9000);
});

test('selectAndroidDevice requires a serial when multiple devices are connected', () => {
  const devices = [{ serial: () => 'one' }, { serial: () => 'two' }];
  expect(() => selectAndroidDevice(devices)).toThrow(/ANDROID_SERIAL/);
  expect(selectAndroidDevice(devices, 'two').serial()).toBe('two');
  expect(() => selectAndroidDevice(devices, 'missing')).toThrow(/missing/);
});
