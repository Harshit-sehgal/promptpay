/**
 * Return critical alert events whose Prometheus counter has a positive sample.
 * Label order is intentionally irrelevant; exporters may add or reorder an
 * `instance` label without changing the series identity.
 */
export function firedCriticalAlertEvents(text, criticalEvents) {
  const wanted = new Set(criticalEvents);
  const fired = new Set();

  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const sample = line.match(
      /^alert\{([^}]*)\}\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*$/,
    );
    if (!sample) continue;
    const event = sample[1].match(/(?:^|,)\s*event="((?:\\.|[^"\\])*)"(?:,|$)/);
    if (!event) continue;
    const name = event[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (wanted.has(name) && Number(sample[2]) > 0) fired.add(name);
  }

  return criticalEvents.filter((event) => fired.has(event));
}
