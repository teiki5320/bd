'use strict';

// ===== STATE =====
const state = {
  pageCount: 5,
  currentPageIndex: 0,
  selectedBubbleId: null,
  drag: null,
  resize: null,
  pages: []
};

// ===== SCREEN MANAGEMENT =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function showCover()  { showScreen('cover'); }
function showSetup()  { showScreen('setup'); }
function startComic() { showSetup(); } // keep for backwards compat

// ===== SETUP =====
function adjustPageCount(delta) {
  state.pageCount = Math.max(1, Math.min(20, state.pageCount + delta));
  _syncPageCountUI();
}
function syncPageCount(val) {
  state.pageCount = parseInt(val, 10);
  _syncPageCountUI();
}
function _syncPageCountUI() {
  document.getElementById('pageCountDisplay').textContent = state.pageCount;
  document.getElementById('pageCountSlider').value = state.pageCount;
}

// ===== COMIC CREATION =====
function createComic() {
  state.pages = [];
  state.currentPageIndex = 0;
  state.selectedBubbleId = null;
  state.drag = null;
  state.resize = null;

  for (let p = 0; p < state.pageCount; p++) {
    state.pages.push(_createPageData(p, 'grid-4'));
  }

  _setupGlobalEvents();
  showScreen('editor');
  renderEditor();
}

function _createPageData(idx, layout) {
  return {
    id: 'page-' + idx,
    layout: layout,
    panels: Array.from({ length: _layoutPanelCount(layout) }, function(_, i) {
      return _createPanelData(idx, i);
    })
  };
}

function _createPanelData(pageIdx, panelIdx) {
  return {
    id: 'panel-' + pageIdx + '-' + panelIdx,
    scriptText: '',
    imagePrompt: '',
    bubbles: []
  };
}

function _layoutPanelCount(layout) {
  var counts = { 'grid-4': 4, 'grid-5': 5, 'grid-6': 6, 'full': 1, 'grid-2': 2 };
  return counts[layout] || 4;
}

// ===== LAYOUT CHANGE =====
function setLayout(layout) {
  var page = state.pages[state.currentPageIndex];
  var oldPanels = page.panels;
  var newCount = _layoutPanelCount(layout);

  page.layout = layout;
  page.panels = Array.from({ length: newCount }, function(_, i) {
    if (i < oldPanels.length) {
      var p = oldPanels[i];
      p.id = 'panel-' + state.currentPageIndex + '-' + i;
      return p;
    }
    return _createPanelData(state.currentPageIndex, i);
  });

  deselectBubble();
  renderEditor();
}

// ===== EDITOR RENDER =====
function renderEditor() {
  renderScriptPane();
  renderPreviewPane();
  _updateEditorNav();
}

function _updateEditorNav() {
  var page = state.pages[state.currentPageIndex];
  document.getElementById('editorCurrentPage').textContent = state.currentPageIndex + 1;
  document.getElementById('editorTotalPages').textContent  = state.pageCount;
  document.getElementById('scriptPageLabel').textContent   = state.currentPageIndex + 1;

  document.getElementById('editorPrev').disabled = (state.currentPageIndex === 0);
  document.getElementById('editorNext').disabled = (state.currentPageIndex === state.pageCount - 1);

  document.querySelectorAll('.btn-layout').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.layout === page.layout);
  });
}

// ===== SCRIPT PANE =====
function renderScriptPane() {
  var page = state.pages[state.currentPageIndex];
  var container = document.getElementById('scriptPanelList');
  container.innerHTML = '';

  page.panels.forEach(function(panel, i) {
    var item = document.createElement('div');
    item.className = 'script-panel-item';

    var header = document.createElement('div');
    header.className = 'script-panel-header';
    header.textContent = 'Case ' + (i + 1);

    var scriptLabel = document.createElement('div');
    scriptLabel.className = 'script-label';
    scriptLabel.textContent = 'Script / dialogue';

    var scriptTA = document.createElement('textarea');
    scriptTA.className = 'script-textarea';
    scriptTA.placeholder = 'Écrire le dialogue, la narration...';
    scriptTA.value = panel.scriptText;
    scriptTA.addEventListener('input', function() { panel.scriptText = scriptTA.value; });

    var promptLabel = document.createElement('div');
    promptLabel.className = 'script-label';
    promptLabel.textContent = 'Prompt image';

    var promptTA = document.createElement('textarea');
    promptTA.className = 'prompt-textarea';
    promptTA.placeholder = 'Description visuelle de la case...';
    promptTA.value = panel.imagePrompt;
    promptTA.addEventListener('input', function() { panel.imagePrompt = promptTA.value; });

    var addBtn = document.createElement('button');
    addBtn.className = 'btn-add-bubble';
    addBtn.textContent = '+ Ajouter une bulle';
    (function(pid) {
      addBtn.addEventListener('click', function() { addBubble(pid); });
    })(panel.id);

    item.append(header, scriptLabel, scriptTA, promptLabel, promptTA, addBtn);
    container.appendChild(item);
  });
}

// ===== PREVIEW PANE =====
function renderPreviewPane() {
  var page = state.pages[state.currentPageIndex];
  var container = document.getElementById('editorComicPage');
  container.innerHTML = '';

  var grid = document.createElement('div');
  grid.className = 'panel-grid ' + page.layout;

  page.panels.forEach(function(panel, i) {
    var panelEl = document.createElement('div');
    panelEl.className = 'panel editor-panel';
    panelEl.dataset.panelId = panel.id;

    var label = document.createElement('div');
    label.className = 'panel-label';
    label.textContent = 'Case ' + (i + 1);
    panelEl.appendChild(label);

    panel.bubbles.forEach(function(bubble) {
      renderBubble(bubble, panelEl);
    });

    grid.appendChild(panelEl);
  });

  container.appendChild(grid);
}

// ===== BUBBLE RENDER =====
function renderBubble(bubble, panelEl) {
  var el = document.createElement('div');
  el.id = bubble.id;

  var classes = ['bubble'];
  var typeClass = _getBubbleClass(bubble.type);
  if (typeClass) classes.push(typeClass);
  if (bubble.id === state.selectedBubbleId) classes.push('selected');
  el.className = classes.join(' ');

  el.style.left     = bubble.x + 'px';
  el.style.top      = bubble.y + 'px';
  el.style.width    = bubble.width + 'px';
  el.style.maxWidth = 'none';
  el.style.position = 'absolute';
  el.style.cursor   = 'grab';
  if (!bubble.autoHeight && bubble.height) {
    el.style.height = bubble.height + 'px';
  }

  // Editable text
  var textEl = document.createElement('div');
  textEl.className = 'bubble-text';
  textEl.contentEditable = 'true';
  textEl.textContent = bubble.text;
  textEl.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  textEl.addEventListener('click', function(e) {
    e.stopPropagation();
    selectBubble(bubble.id, panelEl);
  });
  textEl.addEventListener('input', function() { bubble.text = textEl.textContent; });
  el.appendChild(textEl);

  // Resize handles only for selected bubble
  if (bubble.id === state.selectedBubbleId) {
    _addResizeHandles(el, bubble, panelEl);
  }

  // Drag (mousedown on bubble body, not on text or handles)
  el.addEventListener('mousedown', function(e) {
    if (e.target.classList.contains('resize-handle')) return;
    if (e.target === textEl || textEl.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    selectBubble(bubble.id, panelEl);
    state.drag = {
      bubbleId: bubble.id,
      panelEl:  panelEl,
      startX:   e.clientX,
      startY:   e.clientY,
      origX:    bubble.x,
      origY:    bubble.y
    };
    document.body.style.cursor = 'grabbing';
  });

  // Stop click bubbling (prevents accidental deselect via handlePreviewClick)
  el.addEventListener('click', function(e) { e.stopPropagation(); });

  panelEl.appendChild(el);
}

function _getBubbleClass(type) {
  var map = {
    'standard': '',
    'right':    'right',
    'thought':  'thought',
    'shout':    'shout',
    'narration':'narration'
  };
  return map[type] !== undefined ? map[type] : '';
}

function _addResizeHandles(bubbleEl, bubble, panelEl) {
  ['nw','n','ne','w','e','sw','s','se'].forEach(function(handle) {
    var h = document.createElement('div');
    h.className = 'resize-handle handle-' + handle;
    h.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      // Lock height if auto
      if (bubble.autoHeight) {
        bubble.height    = bubbleEl.offsetHeight;
        bubble.autoHeight = false;
      }
      state.resize = {
        bubbleId: bubble.id,
        panelEl:  panelEl,
        handle:   handle,
        startX:   e.clientX,
        startY:   e.clientY,
        origX:    bubble.x,
        origY:    bubble.y,
        origW:    bubble.width,
        origH:    bubble.height
      };
      document.body.style.cursor = handle + '-resize';
    });
    bubbleEl.appendChild(h);
  });
}

// ===== BUBBLE SELECTION =====
function selectBubble(bubbleId, panelEl) {
  var prevId = state.selectedBubbleId;

  // Already selected — just reposition toolbar
  if (prevId === bubbleId) {
    showBubbleToolbar(bubbleId);
    return;
  }

  // Clear previous selection
  if (prevId) {
    var prevEl = document.getElementById(prevId);
    if (prevEl) {
      prevEl.classList.remove('selected');
      prevEl.querySelectorAll('.resize-handle').forEach(function(h) { h.remove(); });
    }
  }

  state.selectedBubbleId = bubbleId;

  var el = document.getElementById(bubbleId);
  if (!el) return;
  el.classList.add('selected');

  var found = _findBubble(bubbleId);
  if (found.bubble) _addResizeHandles(el, found.bubble, panelEl);

  showBubbleToolbar(bubbleId);
}

function deselectBubble() {
  if (!state.selectedBubbleId) return;
  var el = document.getElementById(state.selectedBubbleId);
  if (el) {
    el.classList.remove('selected');
    el.querySelectorAll('.resize-handle').forEach(function(h) { h.remove(); });
  }
  state.selectedBubbleId = null;
  hideBubbleToolbar();
}

// ===== BUBBLE TOOLBAR =====
function showBubbleToolbar(bubbleId) {
  var el      = document.getElementById(bubbleId);
  var toolbar = document.getElementById('bubbleToolbar');
  if (!el || !toolbar) return;

  toolbar.classList.remove('hidden');

  var rect   = el.getBoundingClientRect();
  var tbRect = toolbar.getBoundingClientRect();

  var top  = rect.top - tbRect.height - 10;
  var left = rect.left;
  if (top  < 4) top = rect.bottom + 10;
  if (left + tbRect.width > window.innerWidth - 4) left = window.innerWidth - tbRect.width - 4;
  if (left < 4) left = 4;

  toolbar.style.top  = top  + 'px';
  toolbar.style.left = left + 'px';
}

function hideBubbleToolbar() {
  document.getElementById('bubbleToolbar').classList.add('hidden');
}

// ===== BUBBLE OPERATIONS =====
function addBubble(panelId) {
  var found = _findPanel(panelId);
  if (!found.panel) return;
  var panel = found.panel;

  var parts    = panelId.split('-');
  var pageIdx  = parseInt(parts[1], 10);
  var panelIdx = parseInt(parts[2], 10);
  var n        = panel.bubbles.length;

  var bubble = {
    id:         'b-' + pageIdx + '-' + panelIdx + '-' + Date.now(),
    type:       'standard',
    text:       'Texte...',
    x:          8 + (n * 18) % 60,
    y:          8 + (n * 18) % 40,
    width:      130,
    height:     0,
    autoHeight: true
  };
  panel.bubbles.push(bubble);

  var panelEl = document.querySelector('[data-panel-id="' + panelId + '"]');
  if (panelEl) {
    renderBubble(bubble, panelEl);
    selectBubble(bubble.id, panelEl);
  }
}

function setBubbleType(type) {
  if (!state.selectedBubbleId) return;
  var found = _findBubble(state.selectedBubbleId);
  if (!found.bubble) return;

  var el = document.getElementById(state.selectedBubbleId);
  if (el) {
    el.classList.remove('right', 'thought', 'shout', 'narration');
    var cls = _getBubbleClass(type);
    if (cls) el.classList.add(cls);
  }
  found.bubble.type = type;
  showBubbleToolbar(state.selectedBubbleId);
}

function deleteBubble() {
  if (!state.selectedBubbleId) return;
  var id = state.selectedBubbleId;
  var el = document.getElementById(id);
  if (el) el.remove();

  for (var i = 0; i < state.pages.length; i++) {
    var page = state.pages[i];
    for (var j = 0; j < page.panels.length; j++) {
      var panel = page.panels[j];
      var idx = panel.bubbles.findIndex(function(b) { return b.id === id; });
      if (idx !== -1) { panel.bubbles.splice(idx, 1); break; }
    }
  }

  state.selectedBubbleId = null;
  hideBubbleToolbar();
}

// ===== DRAG & RESIZE =====
function _setupGlobalEvents() {
  document.removeEventListener('mousemove', _onMousemove);
  document.removeEventListener('mouseup',   _onMouseup);
  document.addEventListener('mousemove', _onMousemove);
  document.addEventListener('mouseup',   _onMouseup);
}

function _onMousemove(e) {
  if (state.drag) {
    var d = state.drag;
    var found = _findBubble(d.bubbleId);
    if (!found.bubble) return;
    var bubble = found.bubble;

    var dx = e.clientX - d.startX;
    var dy = e.clientY - d.startY;
    var panelRect = d.panelEl.getBoundingClientRect();
    var el = document.getElementById(d.bubbleId);
    var elH = el ? el.offsetHeight : 50;
    var MARGIN = 6;

    bubble.x = Math.max(MARGIN, Math.min(d.origX + dx, panelRect.width  - bubble.width - MARGIN));
    bubble.y = Math.max(MARGIN, Math.min(d.origY + dy, panelRect.height - elH          - MARGIN));

    if (el) {
      el.style.left = bubble.x + 'px';
      el.style.top  = bubble.y + 'px';
    }
    showBubbleToolbar(d.bubbleId);
  }

  if (state.resize) {
    var r = state.resize;
    var rfound = _findBubble(r.bubbleId);
    if (!rfound.bubble) return;
    var rbubble = rfound.bubble;

    var rdx = e.clientX - r.startX;
    var rdy = e.clientY - r.startY;
    var MIN_W = 80, MIN_H = 30;

    var newX = r.origX, newY = r.origY, newW = r.origW, newH = r.origH;
    if (r.handle.indexOf('e') !== -1) { newW = Math.max(MIN_W, r.origW + rdx); }
    if (r.handle.indexOf('w') !== -1) { newW = Math.max(MIN_W, r.origW - rdx); newX = r.origX + r.origW - newW; }
    if (r.handle.indexOf('s') !== -1) { newH = Math.max(MIN_H, r.origH + rdy); }
    if (r.handle.indexOf('n') !== -1) { newH = Math.max(MIN_H, r.origH - rdy); newY = r.origY + r.origH - newH; }

    rbubble.x = newX; rbubble.y = newY;
    rbubble.width = newW; rbubble.height = newH;

    var rel = document.getElementById(r.bubbleId);
    if (rel) {
      rel.style.left   = newX + 'px';
      rel.style.top    = newY + 'px';
      rel.style.width  = newW + 'px';
      rel.style.height = newH + 'px';
    }
    showBubbleToolbar(r.bubbleId);
  }
}

function _onMouseup() {
  state.drag   = null;
  state.resize = null;
  document.body.style.cursor = '';
}

// ===== PREVIEW CLICK (deselect on background click) =====
function handlePreviewClick(e) {
  if (!e.target.closest('.bubble')) {
    deselectBubble();
  }
}

// ===== PAGE NAVIGATION =====
function editorChangePage(delta) {
  var newIdx = state.currentPageIndex + delta;
  if (newIdx < 0 || newIdx >= state.pageCount) return;
  deselectBubble();
  state.currentPageIndex = newIdx;
  renderEditor();
}

// ===== HELPERS =====
function _findBubble(bubbleId) {
  for (var i = 0; i < state.pages.length; i++) {
    var page = state.pages[i];
    for (var j = 0; j < page.panels.length; j++) {
      var panel = page.panels[j];
      for (var k = 0; k < panel.bubbles.length; k++) {
        if (panel.bubbles[k].id === bubbleId) {
          return { bubble: panel.bubbles[k], panel: panel, page: page };
        }
      }
    }
  }
  return { bubble: null, panel: null, page: null };
}

function _findPanel(panelId) {
  for (var i = 0; i < state.pages.length; i++) {
    var page = state.pages[i];
    for (var j = 0; j < page.panels.length; j++) {
      if (page.panels[j].id === panelId) {
        return { panel: page.panels[j], page: page };
      }
    }
  }
  return { panel: null, page: null };
}
