import React, { useEffect, useMemo, useState } from 'react';
import { Player } from '@remotion/player';
import { Episode } from './remotion/Episode.jsx';
import { FPS, WIDTH, HEIGHT, episodeDurationInFrames } from './remotion/timing.js';
import { api, followJob, fileToDataUrl } from './api.js';
import { EPISODE_COUNT } from '../shared/catalog.js';

const STATUS_LABELS = {
  script: '📝 script',
  ready: '🎞️ prêt',
  done: '✅ validé',
};

function SceneCard({ project, episode, scene, index, busy, runJob, onRefresh }) {
  const [lines, setLines] = useState(scene.lines);
  const [prompt, setPrompt] = useState(scene.imagePrompt);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLines(scene.lines);
    setPrompt(scene.imagePrompt);
    setDirty(false);
  }, [scene]);

  const audioStale = scene.lines.some((l) => !l.audio);

  const saveText = async () => {
    await api.patchScene(project.id, episode.number, scene.id, { lines, imagePrompt: prompt });
    setDirty(false);
    onRefresh();
  };

  const upload = async (file) => {
    const dataUrl = await fileToDataUrl(file);
    await api.uploadSceneImage(project.id, episode.number, scene.id, dataUrl);
    onRefresh();
  };

  return (
    <div className="scene-card">
      <div className="scene-head">
        <strong>Scène {index + 1}</strong>
        <span className="scene-duration">{(scene.durationSec || 5).toFixed(1)} s</span>
      </div>

      <div className="scene-thumb-row">
        {scene.image ? (
          <img
            className="scene-thumb"
            src={`/files/${project.id}/${scene.image}`}
            alt={`Scène ${index + 1}`}
          />
        ) : (
          <div className="scene-thumb empty">Pas d'image</div>
        )}
        <div className="scene-lines">
          {lines.map((line, j) => (
            <div key={j} className="line-edit">
              <select
                value={line.speaker}
                onChange={(e) => {
                  const next = lines.map((l, k) => (k === j ? { ...l, speaker: e.target.value } : l));
                  setLines(next);
                  setDirty(true);
                }}
              >
                <option value="narrator">🎙️ Narrateur</option>
                {project.characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <textarea
                rows={2}
                value={line.text}
                onChange={(e) => {
                  const next = lines.map((l, k) => (k === j ? { ...l, text: e.target.value } : l));
                  setLines(next);
                  setDirty(true);
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <details className="prompt-details">
        <summary>Prompt de l'image</summary>
        <textarea rows={4} value={prompt} onChange={(e) => { setPrompt(e.target.value); setDirty(true); }} />
        <button
          className="btn-ghost"
          onClick={() => navigator.clipboard.writeText(prompt)}
          title="Pour générer l'image sur openart.ai"
        >
          📋 Copier le prompt (OpenArt)
        </button>
      </details>

      <div className="scene-actions">
        {dirty && (
          <button className="btn-small primary" disabled={busy} onClick={saveText}>
            💾 Enregistrer
          </button>
        )}
        <button
          className="btn-small"
          disabled={busy}
          onClick={() => runJob(() => api.regenImage(project.id, episode.number, scene.id, prompt))}
        >
          🖼️ Régénérer l'image
        </button>
        <label className="btn-small upload">
          ⬆️ Importer une image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => e.target.files[0] && upload(e.target.files[0])}
          />
        </label>
        <button
          className={`btn-small ${audioStale ? 'primary' : ''}`}
          disabled={busy}
          onClick={() => runJob(() => api.regenAudio(project.id, episode.number, scene.id))}
        >
          🔊 {audioStale ? 'Générer la voix' : 'Régénérer la voix'}
        </button>
      </div>
      {scene.imageError && <p className="error small">Image : {scene.imageError}</p>}
    </div>
  );
}

export function ProjectView({ projectId, onBack }) {
  const [project, setProject] = useState(null);
  const [epNumber, setEpNumber] = useState(1);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [playerKey, setPlayerKey] = useState(0);

  const refresh = () =>
    api.getProject(projectId).then((p) => {
      setProject(p);
      setPlayerKey((k) => k + 1);
      return p;
    });

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [projectId]);

  const episode = useMemo(
    () => project?.episodes?.find((e) => e.number === epNumber) || null,
    [project, epNumber],
  );

  const duration = useMemo(
    () => (episode ? episodeDurationInFrames(episode) : FPS * 3),
    [episode],
  );

  const runJob = async (kickoff) => {
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await kickoff();
      await followJob(jobId, setJob);
      await refresh();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
      setJob(null);
    }
  };

  const produce = async (n) => {
    const ok = await runJob(() => api.produceEpisode(projectId, n));
    if (ok) {
      setEpNumber(n);
    }
  };

  const uploadMusic = async (file) => {
    const dataUrl = await fileToDataUrl(file);
    await api.uploadMusic(projectId, dataUrl);
    refresh();
  };

  if (!project) {
    return (
      <div className="page centered">
        <div className="spinner" />
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const producedNumbers = project.episodes.map((e) => e.number);
  const nextNumber = producedNumbers.length < EPISODE_COUNT ? Math.max(...producedNumbers) + 1 : null;
  const currentDone = episode?.status === 'done';

  return (
    <div className="page project">
      <header className="project-header">
        <button className="btn-ghost" onClick={onBack}>
          ← Mes dramas
        </button>
        <div className="project-title">
          <h1>{project.title}</h1>
          <p className="logline">{project.logline}</p>
        </div>
        <label className="btn-ghost upload" title="Musique de fond de tous les épisodes (MP3)">
          {project.musicFile ? '🎵 Changer la musique' : '🎵 Ajouter une musique'}
          <input
            type="file"
            accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a"
            hidden
            onChange={(e) => e.target.files[0] && uploadMusic(e.target.files[0])}
          />
        </label>
      </header>

      <nav className="episode-tabs">
        {Array.from({ length: EPISODE_COUNT }, (_, i) => i + 1).map((n) => {
          const ep = project.episodes.find((e) => e.number === n);
          const summary = project.episodeSummaries.find((s) => s.number === n);
          return (
            <button
              key={n}
              className={`ep-tab ${n === epNumber ? 'active' : ''} ${ep ? 'exists' : ''}`}
              title={summary ? `${summary.title} — ${summary.summary}` : ''}
              onClick={() => ep && setEpNumber(n)}
              disabled={!ep}
            >
              {n}
              {ep && <span className="ep-status">{STATUS_LABELS[ep.status] || ep.status}</span>}
            </button>
          );
        })}
      </nav>

      {busy && (
        <div className="banner info job-banner">
          <div className="spinner small" />
          {job?.step || 'Traitement…'}
          {job?.progress != null && ` (${Math.round(job.progress * 100)} %)`}
        </div>
      )}
      {error && <div className="banner warn">{error}</div>}

      {episode ? (
        <div className="workspace">
          <div className="player-column">
            <div className="player-frame">
              <Player
                key={playerKey}
                component={Episode}
                inputProps={{
                  episode,
                  characters: project.characters,
                  assetBase: `/files/${project.id}`,
                  musicFile: project.musicFile,
                  seriesTitle: project.title,
                }}
                durationInFrames={duration}
                fps={FPS}
                compositionWidth={WIDTH}
                compositionHeight={HEIGHT}
                controls
                acknowledgeRemotionLicense
                style={{ width: '100%', aspectRatio: '9 / 16' }}
              />
            </div>
            <div className="player-actions">
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => runJob(() => api.renderEpisode(projectId, epNumber))}
              >
                ✅ Valider et produire le MP4
              </button>
              {episode.renderedFile && (
                <a
                  className="btn-ghost"
                  href={`/files/${project.id}/${episode.renderedFile}`}
                  download={`${project.title} - episode ${episode.number}.mp4`}
                >
                  ⬇️ Télécharger l'épisode {episode.number}
                </a>
              )}
              {nextNumber && (
                <button
                  className={`btn-primary next ${currentDone ? '' : 'secondary'}`}
                  disabled={busy}
                  onClick={() => {
                    if (currentDone || confirm("L'épisode courant n'est pas encore validé. Produire le suivant quand même ?")) {
                      produce(nextNumber);
                    }
                  }}
                >
                  ▶️ Produire l'épisode {nextNumber}
                </button>
              )}
            </div>
          </div>

          <div className="scenes-column">
            <h2>
              Épisode {episode.number} — {episode.title}
            </h2>
            {episode.cliffhanger && <p className="cliffhanger">Cliffhanger : « {episode.cliffhanger} »</p>}
            {episode.scenes.map((scene, i) => (
              <SceneCard
                key={scene.id}
                project={project}
                episode={episode}
                scene={scene}
                index={i}
                busy={busy}
                runJob={runJob}
                onRefresh={refresh}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="centered">
          <p>Cet épisode n'a pas encore été produit.</p>
        </div>
      )}
    </div>
  );
}
