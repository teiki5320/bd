async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Erreur ${res.status}`);
  }
  return data;
}

export const api = {
  health: () => request('/api/health'),
  listProjects: () => request('/api/projects'),
  getProject: (id) => request(`/api/projects/${id}`),
  deleteProject: (id) => request(`/api/projects/${id}`, { method: 'DELETE' }),
  createProject: (styles, theme) =>
    request('/api/projects', { method: 'POST', body: JSON.stringify({ styles, theme }) }),
  produceEpisode: (id, n) =>
    request(`/api/projects/${id}/episodes/${n}/produce`, { method: 'POST' }),
  renderEpisode: (id, n) =>
    request(`/api/projects/${id}/episodes/${n}/render`, { method: 'POST' }),
  patchScene: (id, n, sceneId, patch) =>
    request(`/api/projects/${id}/episodes/${n}/scenes/${sceneId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  regenImage: (id, n, sceneId, imagePrompt) =>
    request(`/api/projects/${id}/episodes/${n}/scenes/${sceneId}/image`, {
      method: 'POST',
      body: JSON.stringify({ imagePrompt }),
    }),
  regenAudio: (id, n, sceneId) =>
    request(`/api/projects/${id}/episodes/${n}/scenes/${sceneId}/audio`, { method: 'POST' }),
  uploadSceneImage: (id, n, sceneId, dataUrl) =>
    request(`/api/projects/${id}/episodes/${n}/scenes/${sceneId}/upload-image`, {
      method: 'POST',
      body: JSON.stringify({ data: dataUrl }),
    }),
  uploadMusic: (id, dataUrl) =>
    request(`/api/projects/${id}/music`, {
      method: 'POST',
      body: JSON.stringify({ data: dataUrl }),
    }),
  getJob: (id) => request(`/api/jobs/${id}`),
};

// Suit un job jusqu'à la fin ; onTick reçoit l'état à chaque itération.
export async function followJob(jobId, onTick) {
  for (;;) {
    const job = await api.getJob(jobId);
    if (onTick) {
      onTick(job);
    }
    if (job.status === 'done') {
      return job;
    }
    if (job.status === 'error') {
      throw new Error(job.error || 'Le traitement a échoué.');
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
