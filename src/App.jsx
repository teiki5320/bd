import React, { useEffect, useState } from 'react';
import { STYLES, MAX_STYLES } from '../shared/catalog.js';
import { api, followJob } from './api.js';
import { ProjectView } from './ProjectView.jsx';

function StylePicker({ selected, onToggle }) {
  return (
    <div className="style-grid">
      {STYLES.map((s) => {
        const active = selected.includes(s.id);
        const full = !active && selected.length >= MAX_STYLES;
        return (
          <button
            key={s.id}
            className={`style-chip ${active ? 'active' : ''} ${full ? 'disabled' : ''}`}
            onClick={() => !full && onToggle(s.id)}
          >
            <span className="style-emoji">{s.emoji}</span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function CreationProgress({ job, error }) {
  return (
    <div className="progress-panel">
      <div className="spinner" />
      <h2>Création en cours…</h2>
      <p className="progress-step">{job?.step || 'Démarrage…'}</p>
      {job?.progress != null && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <p className="hint">
        L'écriture du scénario prend 1 à 3 minutes, puis les images et les voix sont générées
        scène par scène. Tu peux laisser cette fenêtre ouverte.
      </p>
    </div>
  );
}

export function App() {
  const [view, setView] = useState({ name: 'home' });
  const [projects, setProjects] = useState([]);
  const [health, setHealth] = useState(null);
  const [selected, setSelected] = useState([]);
  const [theme, setTheme] = useState('');
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);

  const refresh = () => api.listProjects().then(setProjects).catch(() => {});

  useEffect(() => {
    refresh();
    api.health().then(setHealth).catch(() => {});
  }, []);

  const toggleStyle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const create = async () => {
    setError(null);
    setView({ name: 'creating' });
    try {
      const { jobId } = await api.createProject(selected, theme);
      const done = await followJob(jobId, setJob);
      await refresh();
      setView({ name: 'project', id: done.result.projectId });
    } catch (e) {
      setError(e.message);
      setTimeout(() => setView({ name: 'home' }), 100);
    }
  };

  if (view.name === 'project') {
    return (
      <ProjectView
        projectId={view.id}
        onBack={() => {
          refresh();
          setView({ name: 'home' });
        }}
      />
    );
  }

  if (view.name === 'creating') {
    return (
      <div className="page centered">
        <CreationProgress job={job} error={error} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="home-header">
        <h1>Drama Studio</h1>
        <p className="tagline">Micro-dramas africains — 10 épisodes de 60 secondes, générés chez toi.</p>
      </header>

      {health && !health.claude && (
        <div className="banner warn">
          ⚠️ La commande <code>claude</code> est introuvable. Installe Claude Code et connecte-toi
          (<code>npm i -g @anthropic-ai/claude-code</code> puis <code>claude</code> → <code>/login</code>).
        </div>
      )}
      {health && health.imageProvider === 'manual' && (
        <div className="banner info">
          🖼️ Mode images manuel (OpenArt) : les scènes seront créées sans images — copie chaque
          prompt dans OpenArt puis dépose l'image dans la scène.
        </div>
      )}
      {health && (
        <p className="provider-line">
          Images : <strong>{health.imageProvider}</strong>
          {health.imageProvider === 'openart' && ' (visages constants activés)'}
        </p>
      )}

      <section className="create-card">
        <h2>Nouveau drama</h2>
        <p className="section-label">
          Choisis 1 à {MAX_STYLES} styles ({selected.length} sélectionné{selected.length > 1 ? 's' : ''})
        </p>
        <StylePicker selected={selected} onToggle={toggleStyle} />
        <input
          className="theme-input"
          placeholder="Idée ou thème (optionnel) — ex. « une veuve découvre le secret de son mari »"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          maxLength={300}
        />
        {error && <p className="error">{error}</p>}
        <button className="btn-primary" disabled={selected.length === 0} onClick={create}>
          🎬 Créer mon drama
        </button>
      </section>

      {projects.length > 0 && (
        <section className="library">
          <h2>Mes dramas</h2>
          <div className="project-grid">
            {projects.map((p) => (
              <div key={p.id} className="project-card" onClick={() => setView({ name: 'project', id: p.id })}>
                <h3>{p.title}</h3>
                <p className="logline">{p.logline}</p>
                <div className="badges">
                  {(p.styles || []).map((s) => {
                    const st = STYLES.find((x) => x.id === s);
                    return (
                      <span key={s} className="badge">
                        {st ? `${st.emoji} ${st.label}` : s}
                      </span>
                    );
                  })}
                </div>
                <p className="ep-count">
                  {(p.episodes || []).filter((e) => e.status === 'done').length} /{' '}
                  {health?.episodeCount || 10} épisodes produits
                </p>
                <button
                  className="btn-ghost danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Supprimer « ${p.title} » ?`)) {
                      api.deleteProject(p.id).then(refresh);
                    }
                  }}
                >
                  Supprimer
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
