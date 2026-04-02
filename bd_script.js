'use strict';

// ===== APP STATE =====
const app = {
  currentProjectId: null,
  currentEpisodeIndex: 0,
  pendingUpload: null
};

const FIXED_STYLE = 'realistic comic book style, dramatic lighting, cinematic composition, warm African color palette, detailed linework, strong shadows';

// ===== SCREEN MANAGEMENT =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function showLibrary() {
  app.currentProjectId = null;
  showScreen('library');
  renderLibrary();
}

function showCreation() {
  showScreen('creation');
  document.getElementById('scriptInput').value = '';
  document.getElementById('parseError').classList.add('hidden');
}

// ===== INIT =====
function initApp() {
  // Load ComfyUI URL
  document.getElementById('comfyuiUrl').value = ComfyUI.getUrl();
  renderLibrary();
}

// ===== COMFYUI SETTINGS =====
function toggleSettings() {
  document.getElementById('settingsPanel').classList.toggle('hidden');
}

async function saveComfySettings() {
  const url = document.getElementById('comfyuiUrl').value.trim();
  if (url) ComfyUI.setUrl(url);
  const statusEl = document.getElementById('comfyStatus');
  statusEl.textContent = 'Test...';
  statusEl.className = 'comfy-status';
  const ok = await ComfyUI.ping();
  if (ok) {
    statusEl.textContent = '✓ Connecté';
    statusEl.className = 'comfy-status ok';
  } else {
    statusEl.textContent = '✗ Injoignable';
    statusEl.className = 'comfy-status err';
  }
}

// ===== LIBRARY =====
function renderLibrary() {
  const projects = StorageManager.getAllProjects();
  const grid = document.getElementById('projectList');
  const empty = document.getElementById('emptyLibrary');

  grid.innerHTML = '';

  if (projects.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  grid.classList.remove('hidden');
  empty.classList.add('hidden');

  projects.forEach(project => {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.onclick = function(e) {
      if (e.target.closest('.project-card-delete')) return;
      openProject(project.id);
    };

    const episodeCount = project.data && project.data.episodes ? project.data.episodes.length : 0;
    const date = new Date(project.createdAt).toLocaleDateString('fr-FR');

    card.innerHTML =
      '<div class="project-card-title">' + escapeHtml(project.title) + '</div>' +
      '<div class="project-card-info">' +
        episodeCount + ' épisode' + (episodeCount > 1 ? 's' : '') + '<br>' +
        '<span style="font-size:0.7rem;color:#5a3a0a">' + date + '</span>' +
      '</div>' +
      '<button class="project-card-delete" onclick="deleteProjectConfirm(\'' + project.id + '\')" title="Supprimer">&times;</button>';

    grid.appendChild(card);
  });
}

function deleteProjectConfirm(id) {
  const project = StorageManager.getProject(id);
  if (!project) return;
  if (confirm('Supprimer "' + project.title + '" ? Cette action est irréversible.')) {
    StorageManager.deleteProject(id);
    renderLibrary();
  }
}

function openProject(id) {
  app.currentProjectId = id;
  app.currentEpisodeIndex = 0;
  showScreen('viewer');
  renderViewer();
}

// ===== IMPORT SCRIPT =====
function importScript() {
  const raw = document.getElementById('scriptInput').value.trim();
  const errEl = document.getElementById('parseError');

  if (!raw) {
    errEl.textContent = 'Collez un script JSON avant de continuer.';
    errEl.classList.remove('hidden');
    return;
  }

  let data;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Aucun JSON trouvé dans le texte collé.');
    data = JSON.parse(jsonMatch[0]);
  } catch (e) {
    errEl.textContent = 'JSON invalide : ' + e.message;
    errEl.classList.remove('hidden');
    return;
  }

  if (!data.title) {
    errEl.textContent = 'Le JSON doit contenir un champ "title".';
    errEl.classList.remove('hidden');
    return;
  }
  if (!data.episodes || !Array.isArray(data.episodes) || data.episodes.length === 0) {
    errEl.textContent = 'Le JSON doit contenir un tableau "episodes" avec au moins un épisode.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!data.characters || !Array.isArray(data.characters)) {
    errEl.textContent = 'Le JSON doit contenir un tableau "characters".';
    errEl.classList.remove('hidden');
    return;
  }

  // Normalize data to handle variations in JSON structure from Claude
  normalizeData(data);

  errEl.classList.add('hidden');

  const project = {
    id: StorageManager.generateId(),
    title: data.title,
    setting: data.setting || '',
    description: '',
    themes: [],
    data: data,
    images: {}
  };

  StorageManager.saveProject(project);

  app.currentProjectId = project.id;
  app.currentEpisodeIndex = 0;
  showScreen('viewer');
  renderViewer();
}

// ===== NORMALIZE DATA =====
function normalizeData(data) {
  // Ensure characters have all expected fields
  data.characters.forEach(function(char, i) {
    char.id = char.id || char.slug || ('char_' + i);
    char.name = char.name || 'Personnage ' + (i + 1);
    char.role = char.role || '';
    char.age = char.age || null;
    char.physical_description = char.physical_description || char.description || char.physique || '';
    char.personality = char.personality || char.personnalite || char.personnality || '';
    char.pixverse_prompt = char.pixverse_prompt || char.prompt || '';
    // Auto-generate pixverse_prompt if missing but has physical_description
    if (!char.pixverse_prompt && char.physical_description) {
      char.pixverse_prompt = char.physical_description + ', ' + FIXED_STYLE;
    }
  });

  // Ensure episodes have number field and panels are normalized
  data.episodes.forEach(function(ep, epIdx) {
    ep.number = ep.number || (epIdx + 1);
    ep.title = ep.title || 'Épisode ' + ep.number;
    ep.cliffhanger_text = ep.cliffhanger_text || ep.cliffhanger || '';
    // Accept various names for panels array
    if (!ep.panels) {
      ep.panels = ep.scenes || ep.cases || ep.pages || [];
    }

    ep.panels.forEach(function(panel, pIdx) {
      panel.number = panel.number || (pIdx + 1);
      panel.layout = panel.layout || 'medium';
      panel.scene_description = panel.scene_description || panel.description || panel.scene || '';
      panel.characters_present = panel.characters_present || panel.characters || [];
      panel.voice_over = panel.voice_over || panel.voiceover || panel.narration || null;
      panel.sfx = panel.sfx || panel.sound || null;
      panel.caption = panel.caption || null;
      panel.pixverse_prompt = panel.pixverse_prompt || panel.prompt || panel.image_prompt || '';
      panel.cliffhanger = panel.cliffhanger || false;

      // Normalize dialogue - could be object, array of objects, or string
      if (!panel.dialogue) {
        panel.dialogue = null;
      } else if (typeof panel.dialogue === 'string') {
        // Single string dialogue - try to assign to first character present
        var charId = (panel.characters_present && panel.characters_present[0]) || 'narrator';
        var obj = {};
        obj[charId] = panel.dialogue;
        panel.dialogue = obj;
      } else if (Array.isArray(panel.dialogue)) {
        // Array of {character: "id", text: "..."} or {speaker: "id", line: "..."}
        var dialogObj = {};
        panel.dialogue.forEach(function(d) {
          var cid = d.character || d.character_id || d.speaker || d.id || 'unknown';
          var txt = d.text || d.line || d.dialogue || '';
          if (txt) dialogObj[cid] = txt;
        });
        panel.dialogue = Object.keys(dialogObj).length > 0 ? dialogObj : null;
      }
      // If it's already an object, leave it as-is

      // Auto-generate pixverse_prompt if missing
      if (!panel.pixverse_prompt && panel.scene_description) {
        var charsPresent = (panel.characters_present || [])
          .map(function(cid) { return data.characters.find(function(c) { return c.id === cid; }); })
          .filter(Boolean);
        var charDescs = charsPresent.map(function(c) { return c.physical_description; }).join('. ');
        var bg = data.background_prompt || data.setting || '';
        panel.pixverse_prompt = (charDescs ? charDescs + '. ' : '') + bg + '. ' + panel.scene_description + '. ' + FIXED_STYLE;
      }
    });
  });
}

// ===== COPY HELP PROMPT =====
function copyHelpPrompt() {
  const text = document.getElementById('helpPrompt').textContent;
  const btn = document.querySelector('.btn-copy-help');
  copyToClipboard(btn, text);
}

// ===== VIEWER =====
function renderViewer() {
  const project = StorageManager.getProject(app.currentProjectId);
  if (!project || !project.data) { showLibrary(); return; }

  // Re-normalize in case project was saved before normalization was added
  normalizeData(project.data);
  StorageManager.saveProject(project);

  document.getElementById('viewerTitle').textContent = project.data.title || project.title;
  switchTab('bd');
}

var TAB_IDS = { bd: 'tabBD', characters: 'tabCharacters', prompts: 'tabPrompts' };

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.remove('active');
  });
  var targetId = TAB_IDS[tabName];
  if (targetId) document.getElementById(targetId).classList.add('active');

  if (tabName === 'bd') renderBDTab();
  else if (tabName === 'characters') renderCharactersTab();
  else if (tabName === 'prompts') renderPromptsTab();
}

// ===== BD TAB =====
function renderBDTab() {
  try {
  const project = StorageManager.getProject(app.currentProjectId);
  if (!project || !project.data) return;

  const episodes = project.data.episodes;
  if (!episodes || episodes.length === 0) {
    document.getElementById('bdGrid').innerHTML = '<div style="color:var(--gold);padding:20px;text-align:center;">Aucun épisode trouvé dans le projet.</div>';
    return;
  }

  if (app.currentEpisodeIndex >= episodes.length) app.currentEpisodeIndex = episodes.length - 1;

  const episode = episodes[app.currentEpisodeIndex];

  document.getElementById('episodeIndicator').textContent =
    'Épisode ' + (app.currentEpisodeIndex + 1) + ' / ' + episodes.length;
  document.getElementById('btnPrevEp').disabled = (app.currentEpisodeIndex === 0);
  document.getElementById('btnNextEp').disabled = (app.currentEpisodeIndex === episodes.length - 1);
  document.getElementById('episodeTitle').textContent = episode.title || '';

  const grid = document.getElementById('bdGrid');
  grid.innerHTML = '';

  const panels = episode.panels || [];
  if (panels.length === 0) {
    grid.innerHTML = '<div style="color:var(--gold);padding:20px;text-align:center;">Aucune case dans cet épisode.</div>';
    return;
  }

  panels.forEach(function(panel, pIdx) {
    const panelEl = document.createElement('div');
    panelEl.className = 'bd-panel';
    panelEl.dataset.layout = panel.layout || 'medium';

    const panelKey = 'ep' + (app.currentEpisodeIndex + 1) + '-panel' + (pIdx + 1);

    // Panel number
    const numEl = document.createElement('div');
    numEl.className = 'bd-panel-num';
    numEl.textContent = panel.number || (pIdx + 1);
    panelEl.appendChild(numEl);

    // Image if uploaded
    const imgData = project.images && project.images[panelKey];
    if (imgData) {
      const img = document.createElement('img');
      img.className = 'bd-panel-img';
      img.src = imgData;
      img.alt = 'Case ' + (pIdx + 1);
      panelEl.appendChild(img);
    }

    // SFX
    if (panel.sfx) {
      const sfxEl = document.createElement('div');
      sfxEl.className = 'bd-sfx';
      sfxEl.textContent = panel.sfx;
      panelEl.appendChild(sfxEl);
    }

    // Upload overlay (only shows on hover when no gen happening)
    const uploadOverlay = document.createElement('div');
    uploadOverlay.className = 'bd-upload-overlay';
    uploadOverlay.innerHTML = '<span>&#128247;</span>';
    uploadOverlay.onclick = function(e) {
      e.stopPropagation();
      triggerPanelUpload(project.id, panelKey);
    };
    panelEl.appendChild(uploadOverlay);

    // ComfyUI generate button
    if (panel.pixverse_prompt) {
      const genDiv = document.createElement('div');
      genDiv.className = 'bd-panel-gen-overlay';
      const genBtn = document.createElement('button');
      genBtn.className = 'btn-gen-img';
      genBtn.textContent = '🎨 Générer';
      genBtn.onclick = function(e) {
        e.stopPropagation();
        generatePanelImage(project.id, panelKey, panel, panelEl);
      };
      genDiv.appendChild(genBtn);
      panelEl.appendChild(genDiv);
    }

    // Content
    const content = document.createElement('div');
    content.className = 'bd-panel-content';

    if (!imgData && panel.scene_description) {
      const sceneEl = document.createElement('div');
      sceneEl.className = 'bd-scene-desc';
      sceneEl.textContent = panel.scene_description;
      content.appendChild(sceneEl);
    }

    if (panel.dialogue) {
      Object.keys(panel.dialogue).forEach(function(charId) {
        const text = panel.dialogue[charId];
        if (!text) return;
        const character = project.data.characters.find(c => c.id === charId);
        const charName = character ? character.name : charId;

        const bubbleEl = document.createElement('div');
        bubbleEl.className = 'bd-bubble';
        bubbleEl.innerHTML =
          '<div class="bd-bubble-name">' + escapeHtml(charName) + '</div>' +
          '<div>' + escapeHtml(text) + '</div>';
        content.appendChild(bubbleEl);
      });
    }

    if (panel.voice_over) {
      const voEl = document.createElement('div');
      voEl.className = 'bd-voiceover';
      voEl.textContent = panel.voice_over;
      content.appendChild(voEl);
    }

    if (panel.caption) {
      const capEl = document.createElement('div');
      capEl.className = 'bd-caption';
      capEl.textContent = panel.caption;
      content.appendChild(capEl);
    }

    panelEl.appendChild(content);
    panelEl.onclick = function() { showPanelOverlay(panel, project, panelKey); };
    grid.appendChild(panelEl);
  });

  // Generate All button
  const genAllDiv = document.createElement('div');
  genAllDiv.style.textAlign = 'center';
  genAllDiv.style.marginTop = '12px';
  const genAllBtn = document.createElement('button');
  genAllBtn.className = 'btn-gen-all';
  genAllBtn.textContent = '🎨 Générer toutes les images (épisode)';
  genAllBtn.onclick = function() { generateAllPanelImages(project.id, app.currentEpisodeIndex); };
  genAllDiv.appendChild(genAllBtn);
  grid.after(genAllDiv);

  const cliffBanner = document.getElementById('cliffhangerBanner');
  if (episode.cliffhanger_text) {
    cliffBanner.textContent = episode.cliffhanger_text;
    cliffBanner.classList.remove('hidden');
  } else {
    cliffBanner.classList.add('hidden');
  }

  } catch (err) {
    console.error('Erreur renderBDTab:', err);
    document.getElementById('bdGrid').innerHTML =
      '<div style="color:#ff8a6a;padding:20px;text-align:center;">Erreur d\'affichage : ' + escapeHtml(err.message) + '<br><br>Ouvrez la console (F12) pour plus de détails.</div>';
  }
}

function changeEpisode(delta) {
  const project = StorageManager.getProject(app.currentProjectId);
  if (!project || !project.data) return;
  const newIdx = app.currentEpisodeIndex + delta;
  if (newIdx < 0 || newIdx >= project.data.episodes.length) return;
  app.currentEpisodeIndex = newIdx;
  renderBDTab();
}

// ===== COMFYUI IMAGE GENERATION =====

// Generate a single panel image
async function generatePanelImage(projectId, panelKey, panel, panelEl) {
  const project = StorageManager.getProject(projectId);
  if (!project) return;

  const ok = await ComfyUI.ping();
  if (!ok) { alert('ComfyUI n\'est pas accessible. Vérifiez dans les paramètres (engrenage).'); return; }

  // Find reference face: use the first character's portrait
  let refImage = null;
  if (panel.characters_present && panel.characters_present.length > 0) {
    const charId = panel.characters_present[0];
    refImage = (project.images && project.images['char-' + charId]) || null;
  }

  const btn = panelEl.querySelector('.btn-gen-img');
  if (btn) { btn.disabled = true; btn.classList.add('generating'); btn.textContent = '⏳...'; }

  let statusEl = panelEl.querySelector('.gen-status');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.className = 'gen-status';
    panelEl.appendChild(statusEl);
  }

  try {
    const base64 = await ComfyUI.generatePanel(
      panel.pixverse_prompt, refImage,
      function(msg) { statusEl.textContent = msg; }
    );
    StorageManager.saveImage(projectId, panelKey, base64);
    statusEl.textContent = '✓ OK';
    setTimeout(function() { renderBDTab(); }, 500);
  } catch (err) {
    statusEl.textContent = '✗ ' + err.message;
    if (btn) { btn.disabled = false; btn.classList.remove('generating'); btn.textContent = '🎨 Générer'; }
  }
}

// Generate a character portrait (no InstantID, just the prompt)
async function generateCharImage(projectId, charId) {
  const project = StorageManager.getProject(projectId);
  if (!project || !project.data) return;

  const ok = await ComfyUI.ping();
  if (!ok) { alert('ComfyUI n\'est pas accessible. Vérifiez dans les paramètres (engrenage).'); return; }

  const char = project.data.characters.find(c => c.id === charId);
  if (!char || !char.pixverse_prompt) return;

  const btn = document.querySelector('[data-gen-char="' + charId + '"]');
  if (btn) { btn.disabled = true; btn.classList.add('generating'); btn.textContent = '⏳...'; }

  try {
    const prompt = char.pixverse_prompt + ', portrait, face close-up, front view, looking at camera, neutral background';
    const base64 = await ComfyUI.generatePortrait(prompt, null);
    StorageManager.saveImage(projectId, 'char-' + charId, base64);
    renderCharactersTab();
  } catch (err) {
    alert('Erreur: ' + err.message);
    if (btn) { btn.disabled = false; btn.classList.remove('generating'); btn.textContent = '🎨 Générer'; }
  }
}

// Generate ALL: portraits first, then all panels of an episode
async function generateAllPanelImages(projectId, episodeIndex) {
  const project = StorageManager.getProject(projectId);
  if (!project || !project.data) return;

  const ok = await ComfyUI.ping();
  if (!ok) { alert('ComfyUI n\'est pas accessible. Vérifiez dans les paramètres (engrenage).'); return; }

  const genAllBtn = document.querySelector('.btn-gen-all');
  if (genAllBtn) { genAllBtn.disabled = true; }

  // ÉTAPE 1: Générer les portraits manquants
  const chars = project.data.characters || [];
  for (let c = 0; c < chars.length; c++) {
    const char = chars[c];
    const charKey = 'char-' + char.id;
    const hasPhoto = project.images && project.images[charKey];
    if (hasPhoto || !char.pixverse_prompt) continue;

    if (genAllBtn) genAllBtn.textContent = '⏳ Portrait ' + char.name + ' (' + (c + 1) + '/' + chars.length + ')...';

    try {
      const prompt = char.pixverse_prompt + ', portrait, face close-up, front view, looking at camera, neutral background';
      const base64 = await ComfyUI.generatePortrait(prompt, function(msg) {
        if (genAllBtn) genAllBtn.textContent = '⏳ ' + char.name + ': ' + msg;
      });
      StorageManager.saveImage(projectId, charKey, base64);
    } catch (err) {
      console.error('Erreur portrait ' + char.name + ':', err);
    }
  }

  // Reload project after portraits
  const updatedProject = StorageManager.getProject(projectId);

  // ÉTAPE 2: Générer les cases de l'épisode
  const episode = updatedProject.data.episodes[episodeIndex];
  if (!episode) { if (genAllBtn) { genAllBtn.disabled = false; genAllBtn.textContent = '🎨 Générer toutes les images'; } return; }

  const panels = episode.panels || [];
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    const panelKey = 'ep' + (episodeIndex + 1) + '-panel' + (i + 1);

    // Skip if already has image
    if (updatedProject.images && updatedProject.images[panelKey]) continue;
    if (!panel.pixverse_prompt) continue;

    if (genAllBtn) genAllBtn.textContent = '⏳ Case ' + (i + 1) + '/' + panels.length + '...';

    // Find best face reference
    let refImage = null;
    if (panel.characters_present && panel.characters_present.length > 0) {
      // Reload project each time to get latest images
      const latestProject = StorageManager.getProject(projectId);
      for (let ci = 0; ci < panel.characters_present.length; ci++) {
        const ref = latestProject.images && latestProject.images['char-' + panel.characters_present[ci]];
        if (ref) { refImage = ref; break; }
      }
    }

    try {
      const base64 = await ComfyUI.generatePanel(panel.pixverse_prompt, refImage, function(msg) {
        if (genAllBtn) genAllBtn.textContent = '⏳ Case ' + (i + 1) + '/' + panels.length + ': ' + msg;
      });
      StorageManager.saveImage(projectId, panelKey, base64);
    } catch (err) {
      console.error('Erreur case ' + (i + 1) + ':', err);
    }
  }

  if (genAllBtn) { genAllBtn.disabled = false; genAllBtn.textContent = '🎨 Générer toutes les images'; }
  renderBDTab();
}

// ===== PANEL OVERLAY =====
function showPanelOverlay(panel, project, panelKey) {
  const overlay = document.getElementById('panelOverlay');
  const body = document.getElementById('overlayBody');
  let html = '';

  html += '<div class="overlay-section">';
  html += '<div class="overlay-label">Case ' + (panel.number || '') + ' — ' + (panel.layout || '') + '</div>';
  html += '</div>';

  const imgData = project.images && project.images[panelKey];
  if (imgData) {
    html += '<div class="overlay-section"><img src="' + imgData + '" style="width:100%;border-radius:4px;margin-bottom:8px;" alt="case"></div>';
  }

  if (panel.scene_description) {
    html += '<div class="overlay-section"><div class="overlay-label">Description de la scène</div>';
    html += '<div class="overlay-text">' + escapeHtml(panel.scene_description) + '</div></div>';
  }

  if (panel.characters_present && panel.characters_present.length > 0) {
    const names = panel.characters_present.map(function(cid) {
      const c = project.data.characters.find(ch => ch.id === cid);
      return c ? c.name : cid;
    });
    html += '<div class="overlay-section"><div class="overlay-label">Personnages</div>';
    html += '<div class="overlay-text">' + escapeHtml(names.join(', ')) + '</div></div>';
  }

  if (panel.dialogue) {
    html += '<div class="overlay-section"><div class="overlay-label">Dialogues</div>';
    Object.keys(panel.dialogue).forEach(function(charId) {
      const text = panel.dialogue[charId];
      if (!text) return;
      const character = project.data.characters.find(c => c.id === charId);
      const charName = character ? character.name : charId;
      html += '<div style="margin-bottom:6px;"><strong style="color:var(--red);font-family:Bangers;letter-spacing:1px;">' + escapeHtml(charName) + '</strong>';
      html += '<div class="overlay-dialogue">' + escapeHtml(text) + '</div></div>';
    });
    html += '</div>';
  }

  if (panel.voice_over) {
    html += '<div class="overlay-section"><div class="overlay-label">Voix off</div>';
    html += '<div class="overlay-voiceover">' + escapeHtml(panel.voice_over) + '</div></div>';
  }

  if (panel.sfx) {
    html += '<div class="overlay-section"><div class="overlay-label">SFX</div>';
    html += '<div class="overlay-sfx">' + escapeHtml(panel.sfx) + '</div></div>';
  }

  if (panel.caption) {
    html += '<div class="overlay-section"><div class="overlay-label">Caption</div>';
    html += '<div class="overlay-text" style="font-style:italic;color:var(--gold);">' + escapeHtml(panel.caption) + '</div></div>';
  }

  if (panel.pixverse_prompt) {
    html += '<div class="overlay-section"><div class="overlay-label">Prompt Pixverse</div>';
    html += '<div class="prompt-box">' + escapeHtml(panel.pixverse_prompt) + '</div>';
    html += '<button class="btn-copy" style="margin-top:6px;" onclick="copyToClipboard(this, ' + "'" + escapeAttr(panel.pixverse_prompt) + "'" + ')">Copier</button></div>';
  }

  body.innerHTML = html;
  overlay.classList.remove('hidden');
}

function closePanelOverlay(e) {
  document.getElementById('panelOverlay').classList.add('hidden');
}

// ===== CHARACTERS TAB =====
function renderCharactersTab() {
  const project = StorageManager.getProject(app.currentProjectId);
  if (!project || !project.data) return;

  const container = document.getElementById('charactersList');
  container.innerHTML = '';

  project.data.characters.forEach(function(char) {
    const card = document.createElement('div');
    card.className = 'char-card';

    const charPhotoKey = 'char-' + char.id;
    const photoData = project.images && project.images[charPhotoKey];

    let photoHtml;
    if (photoData) {
      photoHtml = '<img src="' + photoData + '" alt="' + escapeAttr(char.name) + '">';
    } else {
      photoHtml = '<div class="char-card-photo-placeholder">&#128247; Ajouter une photo</div>';
    }

    var ageText = char.age ? (char.age + ' ans') : '';
    var roleAge = [char.role, ageText].filter(Boolean).join(' — ');

    card.innerHTML =
      '<div class="char-card-photo" onclick="triggerCharUpload(\'' + project.id + '\', \'' + char.id + '\')">' + photoHtml + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        '<button class="btn-gen-img" data-gen-char="' + char.id + '" onclick="event.stopPropagation();generateCharImage(\'' + project.id + '\',\'' + char.id + '\')">🎨 Générer</button>' +
        '<button class="btn-gen-img" style="background:var(--border-light);color:var(--gold);" onclick="event.stopPropagation();triggerCharUpload(\'' + project.id + '\',\'' + char.id + '\')">📷 Upload</button>' +
      '</div>' +
      '<div class="char-card-name">' + escapeHtml(char.name) + '</div>' +
      (roleAge ? '<div class="char-card-role">' + escapeHtml(roleAge) + '</div>' : '') +
      (char.personality ? '<div class="char-card-info"><strong>Personnalité :</strong> ' + escapeHtml(char.personality) + '</div>' : '') +
      '<div class="char-card-info"><strong>Description physique :</strong></div>' +
      '<textarea class="char-desc-edit" data-char-id="' + char.id + '" data-project-id="' + project.id + '" onchange="updateCharDescription(this)">' + escapeHtml(char.physical_description || '') + '</textarea>' +
      (char.pixverse_prompt ? '<div class="char-card-info"><strong>Prompt Pixverse :</strong></div>' +
      '<div class="prompt-box">' + escapeHtml(char.pixverse_prompt) + '</div>' +
      '<button class="btn-copy" onclick="copyToClipboard(this, ' + "'" + escapeAttr(char.pixverse_prompt) + "'" + ')">Copier le prompt</button>' : '');

    container.appendChild(card);
  });
}

function updateCharDescription(textarea) {
  const charId = textarea.dataset.charId;
  const projectId = textarea.dataset.projectId;
  const newDesc = textarea.value.trim();

  const project = StorageManager.getProject(projectId);
  if (!project || !project.data) return;

  const char = project.data.characters.find(c => c.id === charId);
  if (!char) return;

  char.physical_description = newDesc;
  // Rebuild prompts
  rebuildPrompts(project);
  StorageManager.saveProject(project);
  renderCharactersTab();
  renderPromptsTab();
}

function rebuildPrompts(project) {
  const data = project.data;
  if (!data || !data.characters || !data.episodes) return;

  data.characters.forEach(char => {
    char.pixverse_prompt = char.physical_description + ', ' + FIXED_STYLE;
  });

  data.episodes.forEach(ep => {
    ep.panels.forEach(panel => {
      const charsPresent = (panel.characters_present || [])
        .map(cid => data.characters.find(c => c.id === cid))
        .filter(Boolean);
      const charDescs = charsPresent.map(c => c.physical_description).join('. ');
      const bgPrompt = data.background_prompt || data.setting || '';
      const action = panel.scene_description || '';
      panel.pixverse_prompt = charDescs + '. ' + bgPrompt + '. ' + action + '. ' + FIXED_STYLE;
    });
  });
}

// ===== PROMPTS TAB =====
function renderPromptsTab() {
  const project = StorageManager.getProject(app.currentProjectId);
  if (!project || !project.data) return;

  const container = document.getElementById('promptsList');
  container.innerHTML = '';

  if (project.data.background_prompt) {
    const item = document.createElement('div');
    item.className = 'prompt-item';
    item.innerHTML =
      '<div class="prompt-item-header"><span class="prompt-item-label">Arrière-plan de référence</span>' +
      '<button class="btn-copy" onclick="copyToClipboard(this, ' + "'" + escapeAttr(project.data.background_prompt) + "'" + ')">Copier</button></div>' +
      '<div class="prompt-item-text">' + escapeHtml(project.data.background_prompt) + '</div>';
    container.appendChild(item);
  }

  project.data.characters.forEach(function(char) {
    const item = document.createElement('div');
    item.className = 'prompt-item';
    item.innerHTML =
      '<div class="prompt-item-header"><span class="prompt-item-label">&#128100; ' + escapeHtml(char.name) + '</span>' +
      '<button class="btn-copy" onclick="copyToClipboard(this, ' + "'" + escapeAttr(char.pixverse_prompt || '') + "'" + ')">Copier</button></div>' +
      '<div class="prompt-item-text">' + escapeHtml(char.pixverse_prompt || '') + '</div>';
    container.appendChild(item);
  });

  let globalPanelNum = 0;
  project.data.episodes.forEach(function(ep) {
    ep.panels.forEach(function(panel) {
      globalPanelNum++;
      const item = document.createElement('div');
      item.className = 'prompt-item';
      item.innerHTML =
        '<div class="prompt-item-header"><span class="prompt-item-label">Case ' + globalPanelNum + ' — Ép.' + ep.number + '</span>' +
        '<button class="btn-copy" onclick="copyToClipboard(this, ' + "'" + escapeAttr(panel.pixverse_prompt || '') + "'" + ')">Copier</button></div>' +
        '<div class="prompt-item-text">' + escapeHtml(panel.pixverse_prompt || '') + '</div>';
      container.appendChild(item);
    });
  });
}

// ===== IMAGE UPLOAD =====
function triggerPanelUpload(projectId, panelKey) {
  app.pendingUpload = { projectId: projectId, panelKey: panelKey, type: 'panel' };
  document.getElementById('imageUploadInput').click();
}

function triggerCharUpload(projectId, charId) {
  app.pendingUpload = { projectId: projectId, panelKey: 'char-' + charId, type: 'character' };
  document.getElementById('imageUploadInput').click();
}

function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file || !app.pendingUpload) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    StorageManager.saveImage(app.pendingUpload.projectId, app.pendingUpload.panelKey, e.target.result);
    if (app.pendingUpload.type === 'panel') renderBDTab();
    else renderCharactersTab();
    app.pendingUpload = null;
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

// ===== COPY TO CLIPBOARD =====
function copyToClipboard(btnEl, text) {
  navigator.clipboard.writeText(text).then(function() {
    const orig = btnEl.textContent;
    btnEl.textContent = '✓ Copié !';
    btnEl.classList.add('copied');
    setTimeout(function() { btnEl.textContent = orig; btnEl.classList.remove('copied'); }, 1500);
  }).catch(function() {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const orig = btnEl.textContent;
    btnEl.textContent = '✓ Copié !';
    btnEl.classList.add('copied');
    setTimeout(function() { btnEl.textContent = orig; btnEl.classList.remove('copied'); }, 1500);
  });
}

// ===== HELPERS =====
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
}

// ===== START =====
document.addEventListener('DOMContentLoaded', initApp);
