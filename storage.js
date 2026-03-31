'use strict';

// ===== STORAGE MANAGER =====
const StorageManager = {
  PROJECTS_KEY: 'bd_projects',
  API_KEY_KEY: 'bd_api_key',

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
    const projects = this.getAllProjects();
    return projects.find(p => p.id === id) || null;
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
      console.error('Erreur sauvegarde projet:', e);
      alert('Erreur de sauvegarde. Le stockage local est peut-être plein.');
    }
  },

  deleteProject(id) {
    const projects = this.getAllProjects().filter(p => p.id !== id);
    localStorage.setItem(this.PROJECTS_KEY, JSON.stringify(projects));
  },

  getApiKey() {
    return localStorage.getItem(this.API_KEY_KEY) || '';
  },

  setApiKey(key) {
    if (key) {
      localStorage.setItem(this.API_KEY_KEY, key);
    } else {
      localStorage.removeItem(this.API_KEY_KEY);
    }
  },

  saveImage(projectId, panelKey, base64Data) {
    const project = this.getProject(projectId);
    if (!project) return;
    if (!project.images) project.images = {};
    project.images[panelKey] = base64Data;
    this.saveProject(project);
  },

  getImage(projectId, panelKey) {
    const project = this.getProject(projectId);
    return project && project.images ? project.images[panelKey] || null : null;
  }
};
