import crypto from 'node:crypto';

const jobs = new Map();

export function startJob(label, fn) {
  const id = `job_${crypto.randomBytes(6).toString('hex')}`;
  const job = {
    id,
    label,
    status: 'running',
    step: '',
    progress: null,
    error: null,
    result: null,
    startedAt: Date.now(),
  };
  jobs.set(id, job);

  const update = (step, progress = null) => {
    job.step = step;
    job.progress = progress;
  };

  (async () => {
    try {
      job.result = await fn(update);
      job.status = 'done';
      job.step = 'Terminé';
      job.progress = 1;
    } catch (err) {
      job.status = 'error';
      job.error = err && err.message ? err.message : String(err);
      console.error(`[job ${id}] ${label} —`, err);
    }
  })();

  // Nettoyage des vieux jobs
  for (const [key, j] of jobs) {
    if (Date.now() - j.startedAt > 6 * 3600 * 1000) {
      jobs.delete(key);
    }
  }

  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}
