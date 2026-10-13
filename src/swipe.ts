import type { AndroidDevice, Page } from 'playwright';
import { buildSwipePoints, type SwipeTargetBox } from './core.js';

export type SwipeLeft = (page: Page) => Promise<void>;

interface SerialDevice {
  serial(): string;
}

export function selectAndroidDevice<T extends SerialDevice>(
  devices: T[],
  requestedSerial?: string,
): T {
  if (devices.length === 0) {
    throw new Error('No Android device found. Check `adb devices -l` and USB debugging.');
  }
  if (requestedSerial) {
    const selected = devices.find((device) => device.serial() === requestedSerial);
    if (!selected) {
      throw new Error(
        `Android device ${requestedSerial} was not found. Connected: ${devices
          .map((device) => device.serial())
          .join(', ')}`,
      );
    }
    return selected;
  }
  if (devices.length > 1) {
    throw new Error(
      `Multiple Android devices are connected (${devices
        .map((device) => device.serial())
        .join(', ')}). Set ANDROID_SERIAL.`,
    );
  }
  return devices[0];
}

export function createAndroidTouchSwiper(device: AndroidDevice): SwipeLeft {
  return async (page) => {
    await device.shell('input keyevent KEYCODE_WAKEUP');
    await device.shell('wm dismiss-keyguard');
    await dispatchTouchSwipe(page);
  };
}

export function createCdpTouchSwiper(): SwipeLeft {
  return dispatchTouchSwipe;
}

async function dispatchTouchSwipe(page: Page): Promise<void> {
  const box = await findActiveVideoBounds(page);
  const points = buildSwipePoints(box);
  const destination = points.segments.at(-1);
  if (!destination) {
    throw new Error('A swipe requires at least one destination point.');
  }
  const session = await page.context().newCDPSession(page);

  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...points.from, radiusX: 8, radiusY: 8, force: 1 }],
    });
    try {
      for (let step = 1; step <= points.steps; step += 1) {
        const ratio = step / points.steps;
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x: points.from.x + (destination.x - points.from.x) * ratio,
              y: points.from.y + (destination.y - points.from.y) * ratio,
              radiusX: 8,
              radiusY: 8,
              force: 1,
            },
          ],
        });
        await page.waitForTimeout(5);
      }
    } finally {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      }).catch(() => undefined);
    }
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function findActiveVideoBounds(page: Page): Promise<SwipeTargetBox> {
  const box = await page.evaluate(() => {
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
      return null;
    }

    const viewportLeft = selected.camera.parentElement?.getBoundingClientRect().left ?? 0;
    const activePanel = selected.panels.reduce((closest, panel) =>
      Math.abs(panel.getBoundingClientRect().left - viewportLeft) <
      Math.abs(closest.getBoundingClientRect().left - viewportLeft)
        ? panel
        : closest,
    );
    const target = activePanel.querySelector<HTMLElement>(
      '.video-player-curtain, [class*="playerWrapperCurtain"], video',
    );
    if (!target) {
      return null;
    }

    const rect = target.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(document.documentElement.clientWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    if (right <= left || bottom <= top) {
      return null;
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  });

  if (!box) {
    throw new Error('Could not find a visible video area in the active carousel panel.');
  }
  return box;
}
