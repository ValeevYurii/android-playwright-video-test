export interface MediaErrorSnapshot {
  code: number;
  message: string;
}

export interface MediaSnapshot {
  src: string;
  currentTime: number;
  duration: number;
  readyState: number;
  networkState: number;
  paused: boolean;
  seeking: boolean;
  ended: boolean;
  totalVideoFrames: number;
  error: MediaErrorSnapshot | null;
}

export interface CarouselSnapshot {
  activeIndex: number;
  panelCount: number;
  media: MediaSnapshot | null;
}

export interface SwipeTargetBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SwipePoints {
  from: { x: number; y: number };
  segments: Array<{ x: number; y: number }>;
  steps: number;
}

export function findActivePanelIndex(viewportLeft: number, panelLefts: number[]): number {
  if (panelLefts.length === 0) {
    return -1;
  }

  let activeIndex = 0;
  let smallestDistance = Math.abs(panelLefts[0] - viewportLeft);
  for (let index = 1; index < panelLefts.length; index += 1) {
    const distance = Math.abs(panelLefts[index] - viewportLeft);
    if (distance < smallestDistance) {
      activeIndex = index;
      smallestDistance = distance;
    }
  }
  return activeIndex;
}

export function playbackAdvanced(
  before: MediaSnapshot,
  after: MediaSnapshot,
  minimumSeconds: number,
): boolean {
  if (
    before.src !== after.src ||
    after.error !== null ||
    after.readyState < 3 ||
    after.seeking ||
    after.paused ||
    after.ended
  ) {
    return false;
  }

  const decodedFramesAdvanced = after.totalVideoFrames - before.totalVideoFrames >= 2;
  const timelineAdvanced = after.currentTime - before.currentTime >= minimumSeconds;
  return decodedFramesAdvanced || timelineAdvanced;
}

export function transitionProblem(
  before: CarouselSnapshot,
  after: CarouselSnapshot,
  expectedIndex: number,
): string | null {
  if (after.panelCount !== before.panelCount) {
    return `panel count changed from ${before.panelCount} to ${after.panelCount}`;
  }
  if (after.activeIndex !== expectedIndex) {
    return `active panel is ${after.activeIndex}; expected ${expectedIndex}`;
  }
  if (!after.media) {
    return `active panel ${after.activeIndex} has no video`;
  }
  if (before.media?.src && after.media.src === before.media.src) {
    return `video source did not change after transition to panel ${after.activeIndex}`;
  }
  return null;
}

export function buildSwipePoints(box: SwipeTargetBox): SwipePoints {
  const y = Math.round(box.y + box.height * 0.5);
  return {
    from: { x: Math.round(box.x + box.width * 0.8), y },
    segments: [{ x: Math.round(box.x + box.width * 0.2), y }],
    steps: 60,
  };
}

export async function promiseWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${description} timed out after ${timeoutMs} ms.`)),
      timeoutMs,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
