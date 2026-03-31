'use strict';

// ===== APP STATE =====
const app = {
  currentProjectId: null,
  currentEpisodeIndex: 0,
  pendingUpload: null // { projectId, panelKey, type: 'panel'|'character', charId? }
};

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
  resetCreationForm();
}

// ===== INIT =====
function initApp() {
  // Load saved API key into settings panel
  const savedKey = StorageManager.getApiKey();
  if (savedKey) {
    document.getElementById('settingsApiKey').value = savedKey;
  }
  renderLibrary();
}

// ===== SETTINGS =====
function toggleSettings() {
  const panel = document.getElementById('settingsPanel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    const savedKey = StorageManager.getApiKey();
    document.getElementById('settingsApiKey').value = savedKey;
  }
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('settingsApiKey');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function saveSettings() {
  const key = document.getElementById('settingsApiKey').value.trim();
  StorageManager.setApiKey(key);
  const btn = document.querySelector('.btn-save-settings');
  const orig = btn.textContent;
  btn.textContent = '✓ Enregistré !';
  btn.style.background = 'var(--green)';
  setTimeout(function() { btn.textContent = orig; }, 1500);
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

// ===== CREATION FORM =====
let currentIdea = null; // { title, summary }

function resetCreationForm() {
  currentIdea = null;
  document.getElementById('ideaResult').classList.add('hidden');
  document.getElementById('stepThemes').classList.add('hidden');
  document.querySelectorAll('.theme-checkboxes input').forEach(cb => { cb.checked = false; });

  // Show warning if no API key
  const apiKey = StorageManager.getApiKey();
  const warning = document.getElementById('noApiKeyWarning');
  if (!apiKey) {
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }
}

// ===== ÉTAPE 1 : GÉNÉRER UNE IDÉE =====
function generateIdea() {
  const apiKey = StorageManager.getApiKey();
  if (!apiKey) {
    alert('Aucune clé API configurée. Allez dans Paramètres sur la page Bibliothèque.');
    return;
  }

  const btn = document.querySelector('.btn-idea');
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '&#9881; Claude réfléchit...';

  Generator.generateIdea(apiKey).then(function(data) {
    currentIdea = data;
    document.getElementById('ideaTitle').textContent = data.title;
    document.getElementById('ideaSummary').textContent = data.summary;
    document.getElementById('ideaResult').classList.remove('hidden');
    document.getElementById('stepThemes').classList.remove('hidden');
    btn.disabled = false;
    btn.innerHTML = origText;
  }).catch(function(err) {
    alert('Erreur : ' + err.message);
    btn.disabled = false;
    btn.innerHTML = origText;
  });
}

// ===== GENERATION =====
let generationAborted = false;

function startGeneration() {
  if (!currentIdea) {
    alert('Générez d\'abord une idée.');
    return;
  }

  const apiKey = StorageManager.getApiKey();
  if (!apiKey) {
    alert('Aucune clé API configurée. Allez dans Paramètres sur la page Bibliothèque.');
    return;
  }

  // Themes
  const themes = [];
  document.querySelectorAll('.theme-checkboxes input:checked').forEach(cb => {
    themes.push(cb.value);
  });

  // Switch to generation screen
  showScreen('generating');
  generationAborted = false;
  document.getElementById('genError').classList.add('hidden');
  document.getElementById('btnCancelGen').classList.remove('hidden');
  document.getElementById('btnCancelGen').textContent = 'Annuler';
  document.getElementById('genProgressFill').style.width = '0%';
  document.getElementById('genMessage').textContent = 'Préparation...';

  const params = { title: currentIdea.title, summary: currentIdea.summary, themes: themes };

  Generator.generateDrama(params, apiKey, function(message, percent) {
    if (generationAborted) return;
    document.getElementById('genMessage').textContent = message;
    document.getElementById('genProgressFill').style.width = percent + '%';
  }).then(function(data) {
    if (generationAborted) return;

    const project = {
      id: StorageManager.generateId(),
      title: data.title || currentIdea.title,
      setting: data.setting || '',
      description: currentIdea.summary,
      themes: themes,
      data: data,
      images: {}
    };

    StorageManager.saveProject(project);

    // Open viewer
    app.currentProjectId = project.id;
    app.currentEpisodeIndex = 0;
    showScreen('viewer');
    renderViewer();

  }).catch(function(err) {
    if (generationAborted) return;
    document.getElementById('genError').textContent = err.message;
    document.getElementById('genError').classList.remove('hidden');
    document.getElementById('btnCancelGen').textContent = '← Retour';
    document.getElementById('genMessage').textContent = 'Erreur';
    document.getElementById('genProgressFill').style.width = '0%';
  });
}

function cancelGeneration() {
  generationAborted = true;
  showCreation();
}

// ===== VIEWER =====
function renderViewer() {
  const project = StorageManager.getProject(app.currentProjectId);
  if (!project || !project.data) { showLibrary(); return; }

  document.getElementById('viewerTitle').textContent = project.data.title || project.title;

  // Reset to BD tab
  switchTab('bd');
  renderBDTab();
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.toggle('active', tc.id === 'tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
  });

  // Map tab names to content IDs
  if (tabName === 'bd') renderBDTab();
  else if (tabName === 'characters') renderCharactersTab();
  else if (tabName === 'prompts') renderPromptsTab();
}

// ===== BD TAB =====
function renderBDTab() {
  const project = StorageManager.getProject(app.currentProjectId);
  if (!project || !project.data) return;

  const episodes = project.data.episodes;
  const epIdx = app.currentEpisodeIndex;

  if (!episodes || episodes.length === 0) return;

  // Clamp index
  if (epIdx >= episodes.length) app.currentEpisodeIndex = episodes.length - 1;

  const episode = episodes[app.currentEpisodeIndex];

  // Nav
  document.getElementById('episodeIndicator').textContent =
    'Épisode ' + (app.currentEpisodeIndex + 1) + ' / ' + episodes.length;
  document.getElementById('btnPrevEp').disabled = (app.currentEpisodeIndex === 0);
  document.getElementById('btnNextEp').disabled = (app.currentEpisodeIndex === episodes.length - 1);
  document.getElementById('episodeTitle').textContent = episode.title || '';

  // Grid
  const grid = document.getElementById('bdGrid');
  grid.innerHTML = '';

  episode.panels.forEach(function(panel, pIdx) {
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

    // SFX (absolute positioned)
    if (panel.sfx) {
      const sfxEl = document.createElement('div');
      sfxEl.className = 'bd-sfx';
      sfxEl.textContent = panel.sfx;
      panelEl.appendChild(sfxEl);
    }

    // Upload overlay
    const uploadOverlay = document.createElement('div');
    uploadOverlay.className = 'bd-upload-overlay';
    uploadOverlay.innerHTML = '<span>&#128247;</span>';
    uploadOverlay.onclick = function(e) {
      e.stopPropagation();
      triggerPanelUpload(project.id, panelKey);
    };
    panelEl.appendChild(uploadOverlay);

    // Content container
    const content = document.createElement('div');
    content.className = 'bd-panel-content';

    // Scene description (subtle, only when no image)
    if (!imgData && panel.scene_description) {
      const sceneEl = document.createElement('div');
      sceneEl.className = 'bd-scene-desc';
      sceneEl.textContent = panel.scene_description;
      content.appendChild(sceneEl);
    }

    // Dialogue bubbles
    if (panel.dialogue) {
      const charIds = Object.keys(panel.dialogue);
      charIds.forEach(function(charId) {
        const text = panel.dialogue[charId];
        if (!text) return;

        const character = project.data.characters.find(c => c.id === charId);
        const charName = character ? character.name : charId;

        const bubbleEl = document.createElement('div');
        bubbleEl.className = 'bd-bubble';

        const nameEl = document.createElement('div');
        nameEl.className = 'bd-bubble-name';
        nameEl.textContent = charName;
        bubbleEl.appendChild(nameEl);

        const textEl = document.createElement('div');
        textEl.textContent = text;
        bubbleEl.appendChild(textEl);

        content.appendChild(bubbleEl);
      });
    }

    // Voice over
    if (panel.voice_over) {
      const voEl = document.createElement('div');
      voEl.className = 'bd-voiceover';
      voEl.textContent = panel.voice_over;
      content.appendChild(voEl);
    }

    // Caption
    if (panel.caption) {
      const capEl = document.createElement('div');
      capEl.className = 'bd-caption';
      capEl.textContent = panel.caption;
      content.appendChild(capEl);
    }

    panelEl.appendChild(content);

    // Click for overlay
    panelEl.onclick = function() { showPanelOverlay(panel, project, panelKey); };

    grid.appendChild(panelEl);
  });

  // Cliffhanger
  const cliffBanner = document.getElementById('cliffhangerBanner');
  if (episode.cliffhanger_text) {
    cliffBanner.textContent = episode.cliffhanger_text;
    cliffBanner.classList.remove('hidden');
  } else {
    cliffBanner.classList.add('hidden');
  }
}

function changeEpisode(delta) {
  const project = StorageManager.getProject(app.currentProjectId);
  if (!project || !project.data) return;
  const episodes = project.data.episodes;
  const newIdx = app.currentEpisodeIndex + delta;
  if (newIdx < 0 || newIdx >= episodes.length) return;
  app.currentEpisodeIndex = newIdx;
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

  // Image
  const imgData = project.images && project.images[panelKey];
  if (imgData) {
    html += '<div class="overlay-section"><img src="' + imgData + '" style="width:100%;border-radius:4px;margin-bottom:8px;" alt="case"></div>';
  }

  // Scene description
  if (panel.scene_description) {
    html += '<div class="overlay-section">';
    html += '<div class="overlay-label">Description de la scène</div>';
    html += '<div class="overlay-text">' + escapeHtml(panel.scene_description) + '</div>';
    html += '</div>';
  }

  // Characters present
  if (panel.characters_present && panel.characters_present.length > 0) {
    const names = panel.characters_present.map(function(cid) {
      const c = project.data.characters.find(ch => ch.id === cid);
      return c ? c.name : cid;
    });
    html += '<div class="overlay-section">';
    html += '<div class="overlay-label">Personnages présents</div>';
    html += '<div class="overlay-text">' + escapeHtml(names.join(', ')) + '</div>';
    html += '</div>';
  }

  // Dialogue
  if (panel.dialogue) {
    html += '<div class="overlay-section">';
    html += '<div class="overlay-label">Dialogues</div>';
    Object.keys(panel.dialogue).forEach(function(charId) {
      const text = panel.dialogue[charId];
      if (!text) return;
      const character = project.data.characters.find(c => c.id === charId);
      const charName = character ? character.name : charId;
      html += '<div style="margin-bottom:6px;">';
      html += '<strong style="color:var(--red);font-family:Bangers;letter-spacing:1px;">' + escapeHtml(charName) + '</strong>';
      html += '<div class="overlay-dialogue">' + escapeHtml(text) + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  // Voice over
  if (panel.voice_over) {
    html += '<div class="overlay-section">';
    html += '<div class="overlay-label">Voix off</div>';
    html += '<div class="overlay-voiceover">' + escapeHtml(panel.voice_over) + '</div>';
    html += '</div>';
  }

  // SFX
  if (panel.sfx) {
    html += '<div class="overlay-section">';
    html += '<div class="overlay-label">SFX</div>';
    html += '<div class="overlay-sfx">' + escapeHtml(panel.sfx) + '</div>';
    html += '</div>';
  }

  // Caption
  if (panel.caption) {
    html += '<div class="overlay-section">';
    html += '<div class="overlay-label">Caption</div>';
    html += '<div class="overlay-text" style="font-style:italic;color:var(--gold);">' + escapeHtml(panel.caption) + '</div>';
    html += '</div>';
  }

  // Pixverse prompt
  if (panel.pixverse_prompt) {
    html += '<div class="overlay-section">';
    html += '<div class="overlay-label">Prompt Pixverse</div>';
    html += '<div class="prompt-box">' + escapeHtml(panel.pixverse_prompt) + '</div>';
    html += '<button class="btn-copy" style="margin-top:6px;" onclick="copyToClipboard(this, ' + "'" + escapeAttr(panel.pixverse_prompt) + "'" + ')">Copier</button>';
    html += '</div>';
  }

  body.innerHTML = html;
  overlay.classList.remove('hidden');
}

function closePanelOverlay(e) {
  if (!e) {
    document.getElementById('panelOverlay').classList.add('hidden');
    return;
  }
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

    card.innerHTML =
      '<div class="char-card-photo" onclick="triggerCharUpload(\'' + project.id + '\', \'' + char.id + '\')">' + photoHtml + '</div>' +
      '<div class="char-card-name">' + escapeHtml(char.name) + '</div>' +
      '<div class="char-card-role">' + escapeHtml(char.role || '') + ' — ' + (char.age || '?') + ' ans</div>' +
      '<div class="char-card-info"><strong>Personnalité :</strong> ' + escapeHtml(char.personality || '') + '</div>' +
      '<div class="char-card-info"><strong>Description physique :</strong></div>' +
      '<textarea class="char-desc-edit" data-char-id="' + char.id + '" data-project-id="' + project.id + '" onchange="updateCharDescription(this)">' + escapeHtml(char.physical_description || '') + '</textarea>' +
      '<div class="char-card-info"><strong>Prompt Pixverse :</strong></div>' +
      '<div class="prompt-box">' + escapeHtml(char.pixverse_prompt || '') + '</div>' +
      '<button class="btn-copy" onclick="copyToClipboard(this, ' + "'" + escapeAttr(char.pixverse_prompt || '') + "'" + ')">Copier le prompt</button>';

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

  // Rebuild all prompts
  Generator.rebuildPrompts(project);

  StorageManager.saveProject(project);

  // Re-render tabs
  renderCharactersTab();
  renderPromptsTab();
}

// ===== PROMPTS TAB =====
function renderPromptsTab() {
  const project = StorageManager.getProject(app.currentProjectId);
  if (!project || !project.data) return;

  const container = document.getElementById('promptsList');
  container.innerHTML = '';

  // Background prompt
  if (project.data.background_prompt) {
    const item = document.createElement('div');
    item.className = 'prompt-item';
    item.innerHTML =
      '<div class="prompt-item-header">' +
        '<span class="prompt-item-label">Arrière-plan de référence</span>' +
        '<button class="btn-copy" onclick="copyToClipboard(this, ' + "'" + escapeAttr(project.data.background_prompt) + "'" + ')">Copier</button>' +
      '</div>' +
      '<div class="prompt-item-text">' + escapeHtml(project.data.background_prompt) + '</div>';
    container.appendChild(item);
  }

  // Character prompts
  project.data.characters.forEach(function(char) {
    const item = document.createElement('div');
    item.className = 'prompt-item';
    item.innerHTML =
      '<div class="prompt-item-header">' +
        '<span class="prompt-item-label">&#128100; ' + escapeHtml(char.name) + '</span>' +
        '<button class="btn-copy" onclick="copyToClipboard(this, ' + "'" + escapeAttr(char.pixverse_prompt || '') + "'" + ')">Copier</button>' +
      '</div>' +
      '<div class="prompt-item-text">' + escapeHtml(char.pixverse_prompt || '') + '</div>';
    container.appendChild(item);
  });

  // Panel prompts
  let globalPanelNum = 0;
  project.data.episodes.forEach(function(ep) {
    ep.panels.forEach(function(panel) {
      globalPanelNum++;
      const item = document.createElement('div');
      item.className = 'prompt-item';
      item.innerHTML =
        '<div class="prompt-item-header">' +
          '<span class="prompt-item-label">Case ' + globalPanelNum + ' — Ép.' + ep.number + '</span>' +
          '<button class="btn-copy" onclick="copyToClipboard(this, ' + "'" + escapeAttr(panel.pixverse_prompt || '') + "'" + ')">Copier</button>' +
        '</div>' +
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
  app.pendingUpload = { projectId: projectId, panelKey: 'char-' + charId, type: 'character', charId: charId };
  document.getElementById('imageUploadInput').click();
}

function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file || !app.pendingUpload) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const base64 = e.target.result;
    StorageManager.saveImage(app.pendingUpload.projectId, app.pendingUpload.panelKey, base64);

    // Re-render appropriate tab
    if (app.pendingUpload.type === 'panel') {
      renderBDTab();
    } else {
      renderCharactersTab();
    }

    app.pendingUpload = null;
  };
  reader.readAsDataURL(file);

  // Reset input
  event.target.value = '';
}

// ===== COPY TO CLIPBOARD =====
function copyToClipboard(btnEl, text) {
  navigator.clipboard.writeText(text).then(function() {
    const orig = btnEl.textContent;
    btnEl.textContent = '✓ Copié !';
    btnEl.classList.add('copied');
    setTimeout(function() {
      btnEl.textContent = orig;
      btnEl.classList.remove('copied');
    }, 1500);
  }).catch(function() {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const orig = btnEl.textContent;
    btnEl.textContent = '✓ Copié !';
    btnEl.classList.add('copied');
    setTimeout(function() {
      btnEl.textContent = orig;
      btnEl.classList.remove('copied');
    }, 1500);
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
