import React, { useEffect, useMemo, useState } from 'react';
import { Player } from '@remotion/player';
import { Episode } from './remotion/Episode.jsx';
import { FPS, WIDTH, HEIGHT, episodeDurationInFrames } from './remotion/timing.js';
import { api, followJob, fileToDataUrl } from './api.js';
import { EPISODE_COUNT, VOICES } from '../shared/catalog.js';

const STATUS_LABELS = {
  script: '📝 script',
  ready: '🎞️ prêt',
  done: '✅ validé',
};

// ---------- Étape 1 : validation du scénario ----------
function ScriptReview({ project, busy, onRegen, onValidate }) {
  const ep1 = project.episodes[0];
  return (
    <div className="review-panel">
      <div className="review-step">Étape 1 / 3 — Le scénario</div>
      <h2>{project.title}</h2>
      <p className="logline">{project.logline}</p>
      <p className="review-setting">📍 {project.setting}</p>

      <h3>Personnages</h3>
      <ul className="review-list">
        {project.characters.map((c) => (
          <li key={c.id}>
            <strong style={{ color: c.color }}>{c.name}</strong> — {c.role} ({c.gender},{' '}
            {c.age} ans)
          </li>
        ))}
      </ul>

      <h3>La saison en 10 épisodes</h3>
      <ol className="review-list">
        {project.episodeSummaries.map((s) => (
          <li key={s.number}>
            <strong>{s.title}</strong> — {s.summary}
          </li>
        ))}
      </ol>

      {ep1 && (
        <>
          <h3>Épisode 1 — {ep1.title} (script complet)</h3>
          <div className="review-script">
            {ep1.scenes.map((sc, i) => (
              <div key={sc.id} className="review-scene">
                <div className="review-scene-num">Scène {i + 1}</div>
                {sc.lines.map((l, j) => {
                  const c = project.characters.find((x) => x.id === l.speaker);
                  return (
                    <p key={j}>
                      <strong style={{ color: c ? c.color : '#9c8a5a' }}>
                        {c ? c.name : 'Narrateur'} :
                      </strong>{' '}
                      {l.text}
                    </p>
                  );
                })}
              </div>
            ))}
            {ep1.cliffhanger && <p className="cliffhanger">🔥 Cliffhanger : « {ep1.cliffhanger} »</p>}
          </div>
        </>
      )}

      <div className="review-actions">
        <button className="btn-ghost" disabled={busy} onClick={onRegen}>
          🔄 Régénérer le scénario
        </button>
        <button className="btn-primary" disabled={busy} onClick={onValidate}>
          ✅ Valider le scénario
        </button>
      </div>
    </div>
  );
}

// Carte d'un personnage à l'étape de validation : visage + casting vocal.
function CharReviewCard({ project, projectId, c, busy, runJob }) {
  const [instructions, setInstructions] = useState('');
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState(c.elevenVoice || '');

  useEffect(() => {
    setVoice(c.elevenVoice || '');
  }, [c.elevenVoice]);

  const voiceOptions = VOICES.filter(
    (v) => v.gender === (c.gender || 'homme') || v.id === voice,
  );

  const changeVoice = async (voiceId) => {
    setVoice(voiceId);
    try {
      await api.patchCharacter(projectId, c.id, { elevenVoice: voiceId });
    } catch (e) {
      alert(`Changement de voix impossible : ${e.message}`);
    }
  };

  const listen = async () => {
    setListening(true);
    try {
      const { file } = await api.voicePreview(projectId, c.id, voice);
      await new Audio(`/files/${projectId}/${file}`).play();
    } catch (e) {
      alert(`Pré-écoute impossible : ${e.message}`);
    } finally {
      setListening(false);
    }
  };

  return (
    <div className="char-card">
      {c.portrait ? (
        <img src={`/files/${projectId}/${c.portrait}?v=${c.portraitVersion || 0}`} alt={c.name} />
      ) : (
        <div className="char-card-ph">👤</div>
      )}
      <strong style={{ color: c.color }}>{c.name}</strong>
      <span className="char-role">
        {c.role} — {c.age} ans
      </span>

      <div className="voice-row">
        <select value={voice} disabled={busy} onChange={(e) => changeVoice(e.target.value)}>
          {voiceOptions.map((v) => (
            <option key={v.id} value={v.id}>
              🎙️ {v.name} — {v.desc}
            </option>
          ))}
        </select>
        <button
          className="btn-small"
          disabled={busy || listening}
          title="Écouter cette voix avec une réplique du personnage"
          onClick={listen}
        >
          {listening ? '⏳' : '▶️'}
        </button>
      </div>

      <input
        className="face-instructions"
        placeholder="Consignes (optionnel) : plus âgé, boubou bleu…"
        value={instructions}
        maxLength={200}
        onChange={(e) => setInstructions(e.target.value)}
      />
      <div className="char-card-actions">
        <button
          className="btn-small primary"
          disabled={busy}
          title="Claude réécrit l'apparence (guidée par tes consignes), puis le portrait est régénéré"
          onClick={() => runJob(() => api.newFace(projectId, c.id, instructions))}
        >
          ✨ Nouveau visage
        </button>
        <button
          className="btn-small"
          disabled={busy}
          title="Regénère le portrait avec la même description (variation légère)"
          onClick={() => runJob(() => api.regenPortrait(projectId, c.id))}
        >
          🎲
        </button>
      </div>
    </div>
  );
}

// ---------- Étape 2 : validation des personnages ----------
function CharactersReview({ project, busy, runJob, onValidate, projectId }) {
  const missing = project.characters.filter((c) => !c.portrait).length;
  return (
    <div className="review-panel wide">
      <div className="review-step">Étape 2 / 3 — Les personnages</div>
      <h2>Les visages et les voix de « {project.title} »</h2>
      <p className="logline">
        Les portraits servent de référence pour toutes les scènes. « ✨ Nouveau visage » réinvente
        l'apparence (guidée par tes consignes) ; le menu choisit la voix, ▶️ pour l'écouter.
      </p>
      <div className="char-grid">
        {project.characters.map((c) => (
          <CharReviewCard
            key={c.id}
            project={project}
            projectId={projectId}
            c={c}
            busy={busy}
            runJob={runJob}
          />
        ))}
      </div>
      <div className="review-actions">
        {missing > 0 && (
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={() => runJob(() => api.generatePortraits(projectId))}
          >
            🎨 Générer les portraits manquants ({missing})
          </button>
        )}
        <button className="btn-primary" disabled={busy || missing > 0} onClick={onValidate}>
          ✅ Valider les personnages et produire l'épisode 1
        </button>
      </div>
    </div>
  );
}

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
      {scene.lines.some((l) => l.audioError) && (
        <p className="error small">Voix : {scene.lines.find((l) => l.audioError).audioError}</p>
      )}
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
  const [credits, setCredits] = useState(null);

  const loadCredits = () => api.credits().then(setCredits).catch(() => {});

  const refresh = () =>
    api.getProject(projectId).then((p) => {
      setProject(p);
      setPlayerKey((k) => k + 1);
      return p;
    });

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    loadCredits();
    // Raccroche une production en cours (après un rechargement de la page)
    api
      .activeJob(projectId)
      .then((j) => {
        if (j && j.status === 'running') {
          setBusy(true);
          let tick = 0;
          followJob(j.id, (jj) => {
            setJob(jj);
            if (++tick % 5 === 0) refresh().catch(() => {});
          })
            .catch((e) => setError(e.message))
            .finally(() => {
              setBusy(false);
              setJob(null);
              refresh().catch(() => {});
              loadCredits();
            });
        }
      })
      .catch(() => {});
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
      let tick = 0;
      await followJob(jobId, (j) => {
        setJob(j);
        // rafraîchit le projet en continu pendant les longues productions
        if (++tick % 5 === 0) refresh().catch(() => {});
      });
      await refresh();
      loadCredits();
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
  const stage = project.stage || 'production';
  const renderedEpisodes = project.episodes.filter((e) => e.renderedFile);
  const remainingCount =
    EPISODE_COUNT - project.episodes.filter((e) => e.status === 'done' && e.renderedFile).length;

  const header = (
    <header className="project-header">
      <button className="btn-ghost" onClick={onBack}>
        ← Mes dramas
      </button>
      <div className="project-title">
        <h1>{project.title}</h1>
        <p className="logline">{project.logline}</p>
      </div>
      {stage === 'production' && (
        <button
          className="btn-ghost"
          disabled={busy}
          title="Revoir les visages et les voix des personnages"
          onClick={() => api.reviewCharacters(projectId).then(refresh)}
        >
          👥 Personnages
        </button>
      )}
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
  );

  const jobBanner = (
    <>
      {busy && (
        <div className="banner info job-banner">
          <div className="spinner small" />
          {job?.step || 'Traitement…'}
          {job?.progress != null && ` (${Math.round(job.progress * 100)} %)`}
        </div>
      )}
      {error && <div className="banner warn">{error}</div>}
    </>
  );

  const u = project.usage || {};
  const fr = (n) => Number(n || 0).toLocaleString('fr-FR');
  const usageRows = [];

  // Images
  {
    const el = credits?.openart;
    let balance = '';
    if (el && el.credits != null) {
      balance = ` · solde du compte : ${fr(el.credits)} crédits restants`;
    } else if (el && el.error) {
      balance = ` · solde indisponible (${el.error})`;
    }
    if (u.openartImages || balance) {
      usageRows.push(`🎨 OpenArt — ${fr(u.openartImages)} images générées pour ce drama${balance}`);
    }
    if (u.falImages) usageRows.push(`🖼️ fal.ai — ${fr(u.falImages)} images`);
    if (u.pollinationsImages)
      usageRows.push(`🖼️ Pollinations — ${fr(u.pollinationsImages)} images (gratuit)`);
  }

  // Voix
  {
    const el = credits?.elevenlabs;
    let balance = '';
    if (el && el.limit != null) {
      const rest = Math.max(0, el.limit - el.used);
      const reset = el.resetAt
        ? ` — recharge le ${new Date(el.resetAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`
        : '';
      balance = ` · solde du compte : ${fr(rest)} / ${fr(el.limit)} crédits restants${reset}`;
    } else if (el && el.error === 'permission') {
      balance = ' · solde masqué → ajoute la permission « User → Read » à ta clé ElevenLabs';
    } else if (el && el.error) {
      balance = ` · solde indisponible (${el.error})`;
    }
    if (u.elevenChars || balance) {
      usageRows.push(
        `🎙️ ElevenLabs — ${fr(u.elevenChars)} crédits utilisés par ce drama (${fr(u.elevenClips)} répliques)${balance}`,
      );
    }
    if (u.edgeClips) usageRows.push(`🔊 Edge TTS — ${fr(u.edgeClips)} répliques (gratuit)`);
    if (u.sayClips) usageRows.push(`🗣️ Voix macOS — ${fr(u.sayClips)} répliques (gratuit)`);
  }

  if (u.claudeCalls) {
    usageRows.push(`🤖 Claude — ${fr(u.claudeCalls)} générations de scénario (abonnement, sans surcoût)`);
  }

  const usageBar =
    usageRows.length > 0 ? (
      <div className="usage-panel">
        <div className="usage-title">💰 Consommation</div>
        {usageRows.map((row, i) => (
          <div key={i} className="usage-row">
            {row}
          </div>
        ))}
      </div>
    ) : null;

  if (stage === 'script_review') {
    return (
      <div className="page project">
        {header}
        {usageBar}
        {jobBanner}
        <ScriptReview
          project={project}
          busy={busy}
          onRegen={() => runJob(() => api.regenScript(projectId))}
          onValidate={() => runJob(() => api.validateScript(projectId))}
        />
      </div>
    );
  }

  if (stage === 'characters_review') {
    return (
      <div className="page project">
        {header}
        {usageBar}
        {jobBanner}
        <CharactersReview
          project={project}
          projectId={projectId}
          busy={busy}
          runJob={runJob}
          onValidate={() => runJob(() => api.validateCharacters(projectId)).then((ok) => ok && setEpNumber(1))}
        />
      </div>
    );
  }

  return (
    <div className="page project">
      {header}
      {usageBar}

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

      {jobBanner}

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
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => {
                  if (confirm('Régénérer toutes les images de cet épisode avec le fournisseur actuel ?')) {
                    runJob(() => api.regenAllImages(projectId, epNumber));
                  }
                }}
              >
                🖼️ Régénérer toutes les images
              </button>
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => {
                  if (confirm('Régénérer toutes les voix de cet épisode ?')) {
                    runJob(() => api.regenAllAudio(projectId, epNumber));
                  }
                }}
              >
                🔊 Générer toutes les voix
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
              {remainingCount > 0 && (
                <button
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        `Produire automatiquement les ${remainingCount} épisodes restants (scénario, images, voix et MP4) ?\n\nC'est long — souvent plus d'une heure avec OpenArt — et ça consomme tes crédits images et ElevenLabs. Tu peux fermer la page et revenir : la production continue et l'avancement se raccroche tout seul.`,
                      )
                    ) {
                      runJob(() => api.produceSeason(projectId));
                    }
                  }}
                >
                  🚀 Produire toute la saison ({remainingCount} restant{remainingCount > 1 ? 's' : ''})
                </button>
              )}
              {renderedEpisodes.length > 0 && (
                <div className="downloads-box">
                  <div className="downloads-title">📥 Épisodes prêts</div>
                  <div className="downloads-links">
                    {renderedEpisodes.map((e) => (
                      <a
                        key={e.number}
                        className="dl-chip"
                        href={`/files/${project.id}/${e.renderedFile}`}
                        download={`${project.title} - episode ${e.number}.mp4`}
                        title={e.title}
                      >
                        Ép. {e.number}
                      </a>
                    ))}
                    {renderedEpisodes.length > 1 && (
                      <a className="dl-chip all" href={`/api/projects/${project.id}/season.zip`}>
                        ⬇️ Tout (.zip)
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="scenes-column">
            <div className="char-strip">
              {project.characters.map((c) => (
                <div key={c.id} className="char-chip" title={`${c.role} — ${c.visual}`}>
                  {c.portrait ? (
                    <img src={`/files/${project.id}/${c.portrait}`} alt={c.name} />
                  ) : (
                    <div className="char-ph">👤</div>
                  )}
                  <span style={{ color: c.color }}>{c.name}</span>
                  <button
                    className="btn-small"
                    disabled={busy}
                    title="Régénérer le portrait de référence (visages constants, OpenArt)"
                    onClick={() => runJob(() => api.regenPortrait(projectId, c.id))}
                  >
                    🔄
                  </button>
                </div>
              ))}
            </div>
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
