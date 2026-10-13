import { test } from '@playwright/test';
import { scenarioConfig } from '../src/config.js';
import { runCookingScenario, ScenarioFailure } from '../src/scenario.js';
import { createCdpTouchSwiper } from '../src/swipe.js';

test('four mobile swipes keep recipe videos playing', async ({ page }, testInfo) => {
  test.setTimeout(360_000);

  try {
    const report = await runCookingScenario({
      page,
      swipeLeft: createCdpTouchSwiper(),
      config: scenarioConfig(process.env),
      onProgress: (message) => console.log(`[scenario] ${message}`),
    });
    await testInfo.attach('scenario-report', {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: 'application/json',
    });
  } catch (error) {
    if (error instanceof ScenarioFailure) {
      await testInfo.attach('scenario-report', {
        body: Buffer.from(JSON.stringify(error.report, null, 2)),
        contentType: 'application/json',
      });
    }
    throw error;
  }
});
