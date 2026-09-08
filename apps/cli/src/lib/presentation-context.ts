/**
 * Where Ateva is allowed to draw.
 *
 * Advertising and completion UI exist to be seen by a person. A pipe, a
 * redirected build log, a `$(...)` capture, or a CI runner is not a person, so
 * rendering into one produces no attention, corrupts whatever is parsing the
 * stream, and — for anything downstream of an ad request — manufactures
 * inventory nobody looked at.
 *
 * Two independent conditions must both hold before a presentation surface is
 * used:
 *
 *  1. the target stream is a TTY (not a pipe, file, or captured buffer); and
 *  2. the process is not running inside a recognized CI/headless environment.
 *
 * Diagnostics are deliberately NOT routed through this gate. A misconfiguration
 * warning or a failed-upload notice is information the operator needs precisely
 * when nobody is watching the terminal, so those keep printing unconditionally.
 */

/**
 * Environment variables set by CI providers. Presence alone is treated as
 * headless — none of these are set on an ordinary interactive developer shell,
 * and a false positive costs a suppressed banner while a false negative puts an
 * advertisement into a build log.
 */
export const CI_ENVIRONMENT_VARIABLES = [
  'APPVEYOR',
  'BITBUCKET_BUILD_NUMBER',
  'BUILDKITE',
  'BUILD_NUMBER',
  'CI',
  'CIRCLECI',
  'CODEBUILD_BUILD_ID',
  'CONTINUOUS_INTEGRATION',
  'DRONE',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'HUDSON_URL',
  'JENKINS_URL',
  'TEAMCITY_VERSION',
  'TF_BUILD',
  'TRAVIS',
] as const;

/**
 * Whether this process is running without a human at the keyboard.
 *
 * `ATEVA_ASSUME_HEADLESS=1` forces the headless answer so the behavior can be
 * exercised from an interactive shell; it can only ever suppress output, never
 * enable it.
 */
export function isHeadlessEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isTruthyFlag(env.ATEVA_ASSUME_HEADLESS)) return true;
  // A dumb terminal cannot render the surfaces meaningfully even when attached.
  if (env.TERM === 'dumb') return true;
  return CI_ENVIRONMENT_VARIABLES.some((name) => isPresent(env[name]));
}

/**
 * Whether a stream is attached to an interactive terminal.
 *
 * `isTTY` is optional rather than required: a redirected stream reports
 * `undefined`, and accepting the widest shape lets any writable sink be checked
 * without a cast.
 */
export function isInteractiveStream(stream: { isTTY?: boolean }): boolean {
  return stream.isTTY === true;
}

/**
 * The single predicate every presentation surface must pass. Callers that
 * render advertising must also treat `false` as "do not request an ad", not
 * merely "do not print it" — requesting and discarding still consumes the
 * account's exposure budget.
 */
export function canPresentTo(
  stream: { isTTY?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isInteractiveStream(stream) && !isHeadlessEnvironment(env);
}

function isPresent(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}

function isTruthyFlag(value: string | undefined): boolean {
  return isPresent(value);
}
