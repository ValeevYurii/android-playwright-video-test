import type { Locator, Page } from 'playwright';
import type { ScenarioConfig } from './config.js';
import {
  playbackAdvanced,
  promiseWithTimeout,
  transitionProblem,
  type CarouselSnapshot,
  type MediaSnapshot,
} from './core.js';
import type { SwipeLeft } from './swipe.js';

interface CheckRecord {
  name: string;
  status: 'passed' | 'failed';
  durationMs: number;
  details?: unknown;
  error?: string;
}

interface MediaEventRecord {
  type: string;
  timestamp: number;
  src: string;
  currentTime: number;
  readyState: number;
}

export interface ScenarioReport {
  startedAt: string;
  finishedAt?: string;
  recipeUrl: string;
  swipeCount: number;
  checks: CheckRecord[];
  snapshots: CarouselSnapshot[];
  videoEvents: MediaEventRecord[];
  consoleErrors: string[];
  networkErrors: string[];
}

export class ScenarioFailure extends Error {
  constructor(
    message: string,
    public readonly report: ScenarioReport,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScenarioFailure';
  }
}

interface RunCookingScenarioOptions {
  page: Page;
  swipeLeft: SwipeLeft;
  config: ScenarioConfig;
  onProgress?: (message: string) => void;
}

export async function runCookingScenario({
  page,
  swipeLeft,
  config,
  onProgress,
}: RunCookingScenarioOptions): Promise<ScenarioReport> {
  let activePage = page;
  const report: ScenarioReport = {
    startedAt: new Date().toISOString(),
    recipeUrl: config.recipeUrl,
    swipeCount: config.swipeCount,
    checks: [],
    snapshots: [],
    videoEvents: [],
    consoleErrors: [],
    networkErrors: [],
  };

  await installDiagnostics(activePage, report);

  const check = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    onProgress?.(`START ${name}`);
    try {
      const result = await action();
      report.checks.push({
        name,
        status: 'passed',
        durationMs: Date.now() - started,
        details: result,
      });
      onProgress?.(`PASS ${name} (${Date.now() - started} ms)`);
      return result;
    } catch (error) {
      report.videoEvents = await readVideoEvents(activePage);
      report.finishedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      report.checks.push({
        name,
        status: 'failed',
        durationMs: Date.now() - started,
        error: message,
      });
      onProgress?.(`FAIL ${name}: ${message}`);
      throw new ScenarioFailure(`Check "${name}" failed: ${message}`, report, {
        cause: error,
      });
    }
  };

  await check('site-open', async () => {
    const response = await activePage.goto(config.baseUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    if (!response?.ok()) {
      throw new Error(`Site returned HTTP ${response?.status() ?? 'no response'}`);
    }
    const title = await activePage.title();
    if (!title.trim()) {
      throw new Error('The home page has an empty title.');
    }
    await dismissCookieNotice(activePage);
    return { url: activePage.url(), title };
  });

  await check('catalog-open', async () => {
    await dismissCookieNotice(activePage, 5_000);
    const catalogLink = activePage.getByRole('link', { name: 'Каталог рецептов' }).first();
    await catalogLink.scrollIntoViewIfNeeded();
    await dismissCookieNotice(activePage, 2_000);
    const href = await catalogLink.getAttribute('href');
    if (!href) {
      throw new Error('The catalog link has no href.');
    }
    // The production link uses target="_blank". Android CDP does not reliably
    // expose that tab, so keep the verified href and navigate in the same page.
    const response = await activePage.goto(new URL(href, activePage.url()).toString(), {
      waitUntil: 'commit',
      timeout: 60_000,
    });
    if (!response?.ok()) {
      throw new Error(`Catalog returned HTTP ${response?.status() ?? 'no response'}`);
    }
    await activePage.waitForFunction(() => location.pathname === '/catalog', undefined, {
      timeout: 30_000,
    });
    await activePage
      .getByRole('heading', { name: 'Каталог', exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    return { url: activePage.url(), href, status: response.status() };
  });

  await check('recipe-open', async () => {
    const response = await activePage.goto(config.recipeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    if (!response?.ok()) {
      throw new Error(`Recipe returned HTTP ${response?.status() ?? 'no response'}`);
    }
    const startButton = activePage
      .locator('button:visible')
      .filter({ hasText: /начать готовить/i })
      .first();
    await startButton.waitFor({ state: 'visible', timeout: 30_000 });
    await waitForReactClickHandler(startButton, 30_000);
    return {
      url: activePage.url(),
      startButtons: await activePage.getByText(/начать готовить/i).count(),
    };
  });

  await check('cooking-mode-open', async () => {
    const startButton = activePage
      .locator('button:visible')
      .filter({ hasText: /начать готовить/i })
      .first();
    await startButton.click();
    await activePage.waitForFunction(
      (slug) => location.pathname === `/recipes/cooking/${slug}`,
      config.recipeSlug,
      { timeout: 30_000 },
    );
    return { url: activePage.url() };
  });

  let current = await check('video-before-swipes', async () => {
    const ready = await waitForReadyVideo(activePage, config.stallTimeoutMs);
    if (ready.panelCount < config.swipeCount + 1) {
      throw new Error(
        `Carousel contains ${ready.panelCount} panels; ${config.swipeCount + 1} are required.`,
      );
    }
    const playing = await waitForPlayback(activePage, ready, config);
    report.snapshots.push(playing);
    return playing;
  });

  for (let swipeNumber = 1; swipeNumber <= config.swipeCount; swipeNumber += 1) {
    const before = current;
    const expectedIndex = before.activeIndex + 1;
    current = await check(`swipe-${swipeNumber}`, async () => {
      await swipeLeft(activePage);
      const transitioned = await waitForSnapshot(
        activePage,
        (snapshot) =>
          snapshot.activeIndex === expectedIndex &&
          snapshot.media !== null &&
          snapshot.media.src !== before.media?.src,
        config.stallTimeoutMs,
        `panel ${expectedIndex} with a new video source`,
      );

      const problem = transitionProblem(before, transitioned, expectedIndex);
      if (problem) {
        throw new Error(problem);
      }

      const playing = await waitForPlayback(activePage, transitioned, config);
      report.snapshots.push(playing);
      return playing;
    });
  }

  await check('video-after-swipes', async () => {
    const playing = await waitForPlayback(activePage, current, config);
    report.snapshots.push(playing);
    return playing;
  });

  report.videoEvents = await readVideoEvents(activePage);
  report.finishedAt = new Date().toISOString();
  return report;
}

async function installDiagnostics(page: Page, report: ScenarioReport): Promise<void> {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      report.consoleErrors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    report.networkErrors.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`,
    );
  });
  page.on('response', (response) => {
    if (response.request().resourceType() === 'media' && response.status() >= 400) {
      report.networkErrors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });

  const installVideoMonitor = () => {
    const state = window as typeof window & {
      __pwVideoMonitorInstalled?: boolean;
      __pwVideoEvents?: MediaEventRecord[];
    };
    if (state.__pwVideoMonitorInstalled) {
      return;
    }
    state.__pwVideoMonitorInstalled = true;
    state.__pwVideoEvents = [];
    for (const type of ['loadstart', 'loadeddata', 'canplay', 'playing', 'waiting', 'stalled', 'seeked', 'error']) {
      document.addEventListener(
        type,
        (event) => {
          const video = event.target;
          if (!(video instanceof HTMLVideoElement)) {
            return;
          }
          state.__pwVideoEvents?.push({
            type,
            timestamp: performance.now(),
            src: video.currentSrc || video.src,
            currentTime: video.currentTime,
            readyState: video.readyState,
          });
        },
        true,
      );
    }
  };
  await page.addInitScript(installVideoMonitor);
  await page.evaluate(installVideoMonitor);
}

async function dismissCookieNotice(page: Page, timeoutMs = 1_000): Promise<void> {
  const okay = page.getByRole('button', { name: /^окей$/i }).first();
  const appeared = await okay
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await okay.click();
  }
}

async function waitForReactClickHandler(locator: Locator, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isHydrated = await locator
      .evaluate((element) => {
        const reactPropsKey = Object.keys(element).find((key) => key.startsWith('__reactProps'));
        const reactProps = reactPropsKey
          ? (element as unknown as Record<string, { onClick?: unknown }>)[reactPropsKey]
          : undefined;
        return typeof reactProps?.onClick === 'function';
      })
      .catch(() => false);
    if (isHydrated) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The visible "Начать готовить" button was not hydrated by React.');
}

async function waitForReadyVideo(page: Page, timeoutMs: number): Promise<CarouselSnapshot> {
  return waitForSnapshot(
    page,
    (snapshot) =>
      snapshot.media !== null &&
      snapshot.media.error === null &&
      snapshot.media.readyState >= 3 &&
      !snapshot.media.seeking,
    timeoutMs,
    'a ready video in the active carousel panel',
  );
}

async function waitForPlayback(
  page: Page,
  baseline: CarouselSnapshot,
  config: ScenarioConfig,
): Promise<CarouselSnapshot> {
  if (!baseline.media) {
    throw new Error(`Active panel ${baseline.activeIndex} has no video.`);
  }

  return waitForSnapshot(
    page,
    (snapshot) =>
      snapshot.activeIndex === baseline.activeIndex &&
      snapshot.media !== null &&
      playbackAdvanced(
        baseline.media as MediaSnapshot,
        snapshot.media,
        config.minimumProgressSeconds,
      ),
    config.stallTimeoutMs,
    `video playback progress on panel ${baseline.activeIndex}`,
  );
}

async function waitForSnapshot(
  page: Page,
  predicate: (snapshot: CarouselSnapshot) => boolean,
  timeoutMs: number,
  description: string,
): Promise<CarouselSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let latest: CarouselSnapshot | null = null;
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    const snapshotTimeoutMs = Math.max(1, Math.min(5_000, remainingMs));
    latest = await promiseWithTimeout(
      readCarouselSnapshot(page),
      snapshotTimeoutMs,
      `Reading ${description}`,
    );
    if (predicate(latest)) {
      return latest;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`Timed out waiting for ${description}. Latest state: ${JSON.stringify(latest)}`);
}

export async function readCarouselSnapshot(page: Page): Promise<CarouselSnapshot> {
  return page.evaluate(() => {
    const candidates = [...document.querySelectorAll<HTMLElement>('.flicking-camera')]
      .map((camera) => ({
        camera,
        panels: [...camera.children].filter(
          (child): child is HTMLElement =>
            child instanceof HTMLElement && child.classList.contains('panel'),
        ),
      }))
      .filter((candidate) => candidate.panels.length > 1)
      .sort((left, right) => right.panels.length - left.panels.length);

    const selected = candidates[0];
    if (!selected) {
      return { activeIndex: -1, panelCount: 0, media: null };
    }

    const viewportLeft = selected.camera.parentElement?.getBoundingClientRect().left ?? 0;
    const panelLefts = selected.panels.map((panel) => panel.getBoundingClientRect().left);
    let activeIndex = 0;
    let smallestDistance = Math.abs(panelLefts[0] - viewportLeft);
    for (let index = 1; index < panelLefts.length; index += 1) {
      const distance = Math.abs(panelLefts[index] - viewportLeft);
      if (distance < smallestDistance) {
        activeIndex = index;
        smallestDistance = distance;
      }
    }

    const video = selected.panels[activeIndex]?.querySelector('video');
    if (!video) {
      return { activeIndex, panelCount: selected.panels.length, media: null };
    }
    const quality = video.getVideoPlaybackQuality?.();
    const media: MediaSnapshot = {
      src: video.currentSrc || video.src,
      currentTime: video.currentTime,
      duration: video.duration,
      readyState: video.readyState,
      networkState: video.networkState,
      paused: video.paused,
      seeking: video.seeking,
      ended: video.ended,
      totalVideoFrames: quality?.totalVideoFrames ?? 0,
      error: video.error ? { code: video.error.code, message: video.error.message } : null,
    };
    return { activeIndex, panelCount: selected.panels.length, media };
  });
}

async function readVideoEvents(page: Page): Promise<MediaEventRecord[]> {
  return Promise.race([
    page
      .evaluate(() => {
        const state = window as typeof window & { __pwVideoEvents?: MediaEventRecord[] };
        return state.__pwVideoEvents ?? [];
      })
      .catch(() => []),
    new Promise<MediaEventRecord[]>((resolve) => setTimeout(() => resolve([]), 2_000)),
  ]);
}
