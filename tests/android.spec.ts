import { test } from '@playwright/test';
import { _android as android, type AndroidDevice, type BrowserContext } from 'playwright';
import { scenarioConfig } from '../src/config.js';
import { runCookingScenario, ScenarioFailure } from '../src/scenario.js';
import { createAndroidTouchSwiper, selectAndroidDevice } from '../src/swipe.js';

test('four swipes keep recipe videos playing on real Android Chrome', async ({}, testInfo) => {
  test.setTimeout(600_000);

  const tracePath = testInfo.outputPath('trace.zip');
  let devices: AndroidDevice[] = [];
  let device: AndroidDevice | undefined;
  let context: BrowserContext | undefined;
  let tracingStarted = false;

  try {
    devices = await android.devices();
    device = selectAndroidDevice(devices, process.env.ANDROID_SERIAL);
    await device.shell('input keyevent KEYCODE_WAKEUP');
    await device.shell('wm dismiss-keyguard');
    await device.shell('am force-stop com.android.chrome');

    context = await device.launchBrowser({
      pkg: 'com.android.chrome',
      locale: 'ru-RU',
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    tracingStarted = true;
    const page = await context.newPage();

    const report = await runCookingScenario({
      page,
      swipeLeft: createAndroidTouchSwiper(device),
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
    if (device) {
      const screenshotPath = testInfo.outputPath('device-failure.png');
      const screenshotSaved = await device
        .screenshot({ path: screenshotPath })
        .then(() => true)
        .catch(() => false);
      if (screenshotSaved) {
        await testInfo.attach('device-screenshot', {
          path: screenshotPath,
          contentType: 'image/png',
        }).catch(() => undefined);
      }
    }
    throw error;
  } finally {
    if (context && tracingStarted) {
      const traceSaved = await context.tracing
        .stop({ path: tracePath })
        .then(() => true)
        .catch(() => false);
      if (traceSaved) {
        await testInfo.attach('trace', {
          path: tracePath,
          contentType: 'application/zip',
        }).catch(() => undefined);
      }
    }
    await context?.close().catch(() => undefined);
    await Promise.allSettled(devices.map((connectedDevice) => connectedDevice.close()));
  }
});
