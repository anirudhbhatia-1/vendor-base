import { performance } from 'node:perf_hooks';

// Phase 12.6 synthetic load smoke. Drives the public, no-auth API surfaces
// (readiness + localization bundle) under concurrent load and reports latency
// percentiles. This is a smoke SIGNAL for local responsiveness, not a
// production-scale benchmark: real p99 under production load against a
// production-sized environment remains a documented deferral (see
// docs/engineering/launch-readiness-and-localization.md). It exists so a gross
// latency regression is visible locally before it reaches a shared environment.
//
// Usage: node tooling/scripts/load-smoke.mjs
//   LOAD_BASE_URL   default http://127.0.0.1:3001
//   LOAD_REQUESTS   total requests, default 200
//   LOAD_CONCURRENCY concurrent workers, default 20

const baseUrl = process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3001';
const totalRequests = Number(process.env.LOAD_REQUESTS ?? '200');
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? '20');

const targets = [
  { name: 'health.ready', path: '/health/ready' },
  { name: 'locale.bundle.en', path: '/locale/bundle?language=en&audience=CUSTOMER' },
  { name: 'locale.bundle.hi', path: '/locale/bundle?language=hi&audience=CUSTOMER' },
];

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function timeOne(path) {
  const start = performance.now();
  const response = await fetch(`${baseUrl}${path}`);
  await response.text();
  const elapsed = performance.now() - start;
  return { ok: response.ok, status: response.status, elapsed };
}

async function run() {
  const jobs = [];
  for (let index = 0; index < totalRequests; index += 1) {
    jobs.push(targets[index % targets.length]);
  }

  const durations = [];
  let errors = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      try {
        const result = await timeOne(job.path);
        if (!result.ok) errors += 1;
        durations.push(result.elapsed);
      } catch {
        errors += 1;
      }
    }
  }

  const wallStart = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const wallMs = performance.now() - wallStart;

  const sorted = [...durations].sort((a, b) => a - b);
  const report = {
    event: 'load.smoke.completed',
    base_url: baseUrl,
    requests: totalRequests,
    concurrency,
    errors,
    wall_ms: Math.round(wallMs),
    throughput_rps: Math.round((durations.length / wallMs) * 1000),
    latency_ms: {
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      p99: Math.round(percentile(sorted, 99)),
      max: Math.round(sorted[sorted.length - 1] ?? 0),
    },
    note: 'Local smoke signal only; production-scale p99 remains a documented deferral.',
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (errors > 0) {
    process.stderr.write(`load smoke saw ${errors} error responses\n`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'load smoke failed'}\n`);
  process.exitCode = 1;
});
