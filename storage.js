'use strict';

// ===== STORAGE MANAGER =====
const StorageManager = {
  PROJECTS_KEY: 'bd_projects',

  generateId() {
    return 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  },

  getAllProjects() {
    try {
      const raw = localStorage.getItem(this.PROJECTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Erreur lecture projets:', e);
      return [];
    }
  },

  getProject(id) {
    return this.getAllProjects().find(p => p.id === id) || null;
  },

  saveProject(project) {
    const projects = this.getAllProjects();
    const idx = projects.findIndex(p => p.id === project.id);
    project.updatedAt = new Date().toISOString();
    if (idx !== -1) projects[idx] = project;
    else { project.createdAt = project.createdAt || new Date().toISOString(); projects.unshift(project); }
    try {
      localStorage.setItem(this.PROJECTS_KEY, JSON.stringify(projects));
    } catch (e) {
      console.error('Erreur sauvegarde:', e);
      alert('Erreur de sauvegarde. Le stockage local est peut-être plein.');
    }
  },

  deleteProject(id) {
    const projects = this.getAllProjects().filter(p => p.id !== id);
    localStorage.setItem(this.PROJECTS_KEY, JSON.stringify(projects));
  },

  // Save image — compresses to small JPEG for localStorage persistence
  // Also keeps ComfyUI ref for high-res access when server is available
  saveImage(projectId, panelKey, imageData) {
    const project = this.getProject(projectId);
    if (!project) return;
    if (!project.images) project.images = {};

    if (typeof imageData === 'object' && imageData.type === 'comfyui') {
      // ComfyUI reference — download a compressed thumbnail and store it
      var self = this;
      var imgUrl = (imageData.comfyUrl || (typeof ComfyUI !== 'undefined' ? ComfyUI.getUrl() : '')) +
        '/view?filename=' + encodeURIComponent(imageData.filename) +
        '&subfolder=' + encodeURIComponent(imageData.subfolder || '') +
        '&type=' + encodeURIComponent(imageData.imgType || 'output');

      // Fetch, compress, store
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function() {
        var thumb = self._compress(img, 480, 0.6);
        project.images[panelKey] = thumb;
        self.saveProject(project);
      };
      img.onerror = function() {
        // If fetch fails, store the ref as fallback
        project.images[panelKey] = imgUrl;
        self.saveProject(project);
      };
      img.src = imgUrl;
      return;
    }

    if (typeof imageData === 'string' && imageData.startsWith('data:')) {
      // Base64 upload — compress if large
      if (imageData.length > 100000) {
        var self2 = this;
        var img2 = new Image();
        img2.onload = function() {
          project.images[panelKey] = self2._compress(img2, 480, 0.6);
          self2.saveProject(project);
        };
        img2.src = imageData;
        return;
      }
      project.images[panelKey] = imageData;
      this.saveProject(project);
      return;
    }

    // URL or other string
    project.images[panelKey] = imageData;
    this.saveProject(project);
  },

  _compress(img, maxSize, quality) {
    var canvas = document.createElement('canvas');
    var ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
    canvas.width = Math.round(img.width * ratio);
    canvas.height = Math.round(img.height * ratio);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  },

  // Store the ComfyUI filename for a character portrait (for InstantID)
  saveCharRefFilename(projectId, charId, filename) {
    var project = this.getProject(projectId);
    if (!project) return;
    if (!project.charRefs) project.charRefs = {};
    project.charRefs[charId] = filename;
    this.saveProject(project);
  },

  // Get the ComfyUI filename for a character portrait
  getCharRefFilename(projectId, charId) {
    var project = this.getProject(projectId);
    if (!project || !project.charRefs) return null;
    return project.charRefs[charId] || null;
  },

  // Get image src for display
  getImageSrc(projectId, panelKey) {
    var project = this.getProject(projectId);
    if (!project || !project.images || !project.images[panelKey]) return null;
    var img = project.images[panelKey];
    // It's always a string now (base64 jpeg or URL)
    return typeof img === 'string' ? img : null;
  }
};
