export interface ScenarioConfig {
  baseUrl: string;
  recipeUrl: string;
  recipeSlug: string;
  swipeCount: number;
  stallTimeoutMs: number;
  minimumProgressSeconds: number;
}

type Environment = Record<string, string | undefined>;

function positiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number; received ${value}`);
  }
  return parsed;
}

export function scenarioConfig(environment: Environment): ScenarioConfig {
  const recipeUrl =
    environment.RECIPE_URL ??
    'https://xn--j1agri5c.xn--p1ai/recipes/kurinyi-sup-piure-so-slivkami';
  const parsedRecipeUrl = new URL(recipeUrl);
  const recipeSlug = parsedRecipeUrl.pathname.split('/').filter(Boolean).at(-1);
  if (!recipeSlug) {
    throw new Error(`RECIPE_URL does not contain a recipe slug: ${recipeUrl}`);
  }

  return {
    baseUrl: environment.BASE_URL ?? 'https://xn--j1agri5c.xn--p1ai/',
    recipeUrl,
    recipeSlug,
    swipeCount: positiveNumber(environment.SWIPE_COUNT, 4, 'SWIPE_COUNT'),
    stallTimeoutMs: positiveNumber(
      environment.STALL_TIMEOUT_MS,
      45_000,
      'STALL_TIMEOUT_MS',
    ),
    minimumProgressSeconds: positiveNumber(
      environment.MINIMUM_PROGRESS_SECONDS,
      0.4,
      'MINIMUM_PROGRESS_SECONDS',
    ),
  };
}
