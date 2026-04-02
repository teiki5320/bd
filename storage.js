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
    if (idx !== -1) {
      projects[idx] = project;
    } else {
      project.createdAt = project.createdAt || new Date().toISOString();
      projects.unshift(project);
    }
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

  // Save image reference — stores ComfyUI server info (filename) instead of base64
  // Format: { type: 'comfyui', filename, subfolder, comfyUrl } or { type: 'upload', data: base64 }
  saveImage(projectId, panelKey, imageData) {
    const project = this.getProject(projectId);
    if (!project) return;
    if (!project.images) project.images = {};

    if (typeof imageData === 'object' && imageData.type === 'comfyui') {
      // ComfyUI reference — tiny, just the filename
      project.images[panelKey] = imageData;
    } else if (typeof imageData === 'string' && imageData.startsWith('data:')) {
      // Base64 upload — compress to JPEG thumbnail to save space
      project.images[panelKey] = { type: 'upload', data: imageData };
      // Try to save, if too big compress
      try {
        this.saveProject(project);
        return;
      } catch(e) {
        // Too big — we'll compress async and save again
        this._compressAndSave(project, panelKey, imageData);
        return;
      }
    } else {
      project.images[panelKey] = imageData;
    }

    this.saveProject(project);
  },

  _compressAndSave(project, panelKey, base64) {
    var img = new Image();
    var self = this;
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var ratio = Math.min(400 / img.width, 400 / img.height, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      project.images[panelKey] = { type: 'upload', data: canvas.toDataURL('image/jpeg', 0.5) };
      self.saveProject(project);
    };
    img.src = base64;
  },

  // Get image URL for display — returns a usable src
  getImageSrc(projectId, panelKey) {
    var project = this.getProject(projectId);
    if (!project || !project.images || !project.images[panelKey]) return null;

    var img = project.images[panelKey];

    // Legacy: plain base64 string
    if (typeof img === 'string') return img;

    // Uploaded image
    if (img.type === 'upload') return img.data;

    // ComfyUI server image — build URL to fetch from server
    if (img.type === 'comfyui') {
      var comfyUrl = img.comfyUrl || ComfyUI.getUrl();
      return comfyUrl + '/view?' + new URLSearchParams({
        filename: img.filename,
        subfolder: img.subfolder || '',
        type: img.imgType || 'output'
      }).toString();
    }

    return null;
  }
};
