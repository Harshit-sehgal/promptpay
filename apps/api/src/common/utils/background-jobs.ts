/**
 * Background workers must be suppressible when an application instance is
 * embedded in a test. The workers are exercised directly in their own specs;
 * allowing their startup ticks to mutate an HTTP test's database creates
 * unrelated races and deadlocks.
 */
export function backgroundJobsEnabled(): boolean {
  return process.env.BACKGROUND_JOBS_ENABLED !== 'false';
}
