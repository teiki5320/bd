import React, { useEffect, useState } from 'react';
import { STYLES, MAX_STYLES, EPISODE_COUNT } from '../shared/catalog.js';
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

// Formulaire guidé du mode « mon script » : pose toutes les questions dont la
// suite a besoin (voix = genre/âge, visages constants = apparences, découpage…).
function CustomCreate({ onSubmit, onCancel, busy }) {
  const [script, setScript] = useState('');
  const [title, setTitle] = useState('');
  const [setting, setSetting] = useState('');
  const [charactersText, setCharactersText] = useState('');
  const [styles, setStyles] = useState([]);
  const [mustHappen, setMustHappen] = useState('');
  const [fidelity, setFidelity] = useState('fidele');

  const toggleStyle = (id) =>
    setStyles((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const ready = script.trim().length >= 30;

  return (
    <section className="create-card custom-form">
      <h2>✍️ Mon propre script</h2>
      <p className="section-label">
        Réponds aux questions ci-dessous : plus tu en dis, plus le drama sera fidèle à ton
        histoire. Seule la première est obligatoire — Claude complète intelligemment le reste,
        et tu valideras tout (scénario puis personnages) avant la production.
      </p>

      <div className="form-field">
        <label>1. 📖 Raconte ton histoire (obligatoire)</label>
        <p className="field-hint">
          Colle ici ton script complet avec dialogues, un résumé détaillé, ou même une simple
          idée développée. C'est la base des {EPISODE_COUNT} épisodes.
        </p>
        <textarea
          rows={10}
          value={script}
          maxLength={20000}
          placeholder={
            'Ex. : Aminata, couturière à Abidjan, découvre que son mari Karim a une deuxième famille à Bouaké. Elle décide de se venger en… \n\nOu colle directement ton script :\nAMINATA : Karim, qui est cette femme sur la photo ?\nKARIM : Ce n’est personne, je te jure…'
          }
          onChange={(e) => setScript(e.target.value)}
        />
      </div>

      <div className="form-field">
        <label>2. ✒️ Tes dialogues : les garder tels quels ?</label>
        <p className="field-hint">
          Le format impose des répliques courtes (18 mots max) pour tenir en 60 secondes par épisode.
        </p>
        <select value={fidelity} onChange={(e) => setFidelity(e.target.value)}>
          <option value="fidele">Garder mes dialogues tels quels autant que possible</option>
          <option value="libre">Claude peut les réécrire pour le format 60 secondes</option>
        </select>
      </div>

      <div className="form-field">
        <label>3. 👥 Tes personnages (recommandé)</label>
        <p className="field-hint">
          Un par ligne : nom, homme/femme, âge, rôle, apparence. Le genre et l'âge servent au
          casting des voix, l'apparence aux visages constants sur toutes les images. Ce qui
          manque sera complété par Claude.
        </p>
        <textarea
          rows={4}
          value={charactersText}
          maxLength={2000}
          placeholder={
            'Ex. :\nAminata — femme, 32 ans, couturière, belle, boubou jaune, tresses\nKarim — homme, 40 ans, commerçant, costume, barbe courte'
          }
          onChange={(e) => setCharactersText(e.target.value)}
        />
      </div>

      <div className="form-field">
        <label>4. 🏷️ Le titre (optionnel)</label>
        <input
          value={title}
          maxLength={120}
          placeholder="Laisse vide pour que Claude en propose un"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="form-field">
        <label>5. 📍 Où et quand se passe l'histoire ? (optionnel)</label>
        <p className="field-hint">Ville, pays, quartier, époque — ça guide les décors des images.</p>
        <input
          value={setting}
          maxLength={300}
          placeholder="Ex. : Abidjan, quartier de Cocody, de nos jours"
          onChange={(e) => setSetting(e.target.value)}
        />
      </div>

      <div className="form-field">
        <label>6. 🎭 Le ton (optionnel, 3 max)</label>
        <StylePicker selected={styles} onToggle={(id) => (styles.includes(id) || styles.length < MAX_STYLES) && toggleStyle(id)} />
      </div>

      <div className="form-field">
        <label>7. 🔥 Ce qui doit absolument arriver (optionnel)</label>
        <p className="field-hint">
          Les moments clés, les révélations, la fin de la saison — ils seront respectés au fil
          des {EPISODE_COUNT} épisodes.
        </p>
        <textarea
          rows={3}
          value={mustHappen}
          maxLength={1000}
          placeholder="Ex. : Aminata découvre la vérité à l'épisode 5, et à la fin c'est elle qui garde la boutique"
          onChange={(e) => setMustHappen(e.target.value)}
        />
      </div>

      <div className="review-actions">
        <button className="btn-ghost" disabled={busy} onClick={onCancel}>
          ← Retour
        </button>
        <button
          className="btn-primary"
          disabled={busy || !ready}
          title={ready ? '' : "Raconte d'abord ton histoire (question 1)"}
          onClick={() =>
            onSubmit({ script, title, setting, charactersText, styles, mustHappen, fidelity })
          }
        >
          🎬 Créer mon drama depuis ce script
        </button>
      </div>
      {!ready && script.length > 0 && (
        <p className="field-hint">Encore quelques phrases : l'histoire est trop courte pour démarrer.</p>
      )}
    </section>
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
        Claude écrit le scénario complet (1 à 3 minutes). Ensuite tu pourras le valider ou le
        régénérer, puis valider les visages des personnages, avant de produire l'épisode 1.
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

  const runCreation = async (kickoff, backTo = 'home') => {
    setError(null);
    setView({ name: 'creating' });
    try {
      const { jobId } = await kickoff();
      const done = await followJob(jobId, setJob);
      await refresh();
      setView({ name: 'project', id: done.result.projectId });
    } catch (e) {
      setError(e.message);
      setTimeout(() => setView({ name: backTo }), 100);
    }
  };

  const create = () => runCreation(() => api.createProject(selected, theme));
  const createCustom = (answers) =>
    runCreation(() => api.createCustomProject(answers), 'custom');

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

  if (view.name === 'custom') {
    return (
      <div className="page">
        <header className="home-header">
          <h1>Drama Studio</h1>
          <p className="tagline">Ton histoire, notre production — {EPISODE_COUNT} épisodes de 60 secondes.</p>
        </header>
        {error && <div className="banner warn">{error}</div>}
        <CustomCreate
          busy={false}
          onSubmit={createCustom}
          onCancel={() => {
            setError(null);
            setView({ name: 'home' });
          }}
        />
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
          {health.imageProvider === 'openart' && ' (visages constants + 3 scènes vidéo par épisode)'}
          {' · '}Voix : <strong>{health.tts}</strong>
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
        <div className="create-actions">
          <button className="btn-primary" disabled={selected.length === 0} onClick={create}>
            🎬 Créer mon drama
          </button>
          <button
            className="btn-ghost"
            title="Tu as déjà ton histoire ou ton script ? Le formulaire pose les bonnes questions et Claude le met en forme fidèlement."
            onClick={() => {
              setError(null);
              setView({ name: 'custom' });
            }}
          >
            ✍️ J'ai déjà mon script
          </button>
        </div>
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
                  {p.custom && <span className="badge">✍️ Mon script</span>}
                  {(p.styles || []).map((s) => {
                    const st = STYLES.find((x) => x.id === s);
                    return (
                      <span key={s} className="badge">
                        {st ? `${st.emoji} ${st.label}` : s}
                      </span>
                    );
                  })}
                </div>
                {(() => {
                  if (p.stage === 'script_review') {
                    return <p className="ep-count stage">📝 Scénario à valider</p>;
                  }
                  if (p.stage === 'characters_review') {
                    return <p className="ep-count stage">👥 Personnages à valider</p>;
                  }
                  const eps = p.episodes || [];
                  const produced = eps.filter((e) => e.status === 'ready' || e.status === 'done').length;
                  const mp4 = eps.filter((e) => e.rendered).length;
                  return (
                    <p className="ep-count">
                      {produced} / {EPISODE_COUNT} épisodes produits
                      {mp4 > 0 ? ` · ${mp4} MP4 prêt${mp4 > 1 ? 's' : ''}` : ''}
                    </p>
                  );
                })()}
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
