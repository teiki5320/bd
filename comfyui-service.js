'use strict';

// ===== COMFYUI SERVICE =====
const ComfyUI = {
  serverUrl: 'https://butter-volunteers-drive-excellence.trycloudflare.com',

  getUrl() {
    return localStorage.getItem('comfyui_url') || this.serverUrl;
  },

  setUrl(url) {
    localStorage.setItem('comfyui_url', url.replace(/\/+$/, ''));
  },

  async ping() {
    try {
      const r = await fetch(this.getUrl() + '/system_stats', { signal: AbortSignal.timeout(5000) });
      return r.ok;
    } catch (e) {
      return false;
    }
  },

  // ===== WORKFLOW: Simple (no InstantID) — for character portraits =====
  _buildPortraitWorkflow(prompt, negativePrompt) {
    return {
      "4": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": { "ckpt_name": "sd_xl_base_1.0.safetensors" }
      },
      "5": {
        "class_type": "EmptyLatentImage",
        "inputs": { "width": 1024, "height": 1024, "batch_size": 1 }
      },
      "6": {
        "class_type": "CLIPTextEncode",
        "inputs": { "text": prompt, "clip": ["4", 1] }
      },
      "7": {
        "class_type": "CLIPTextEncode",
        "inputs": { "text": negativePrompt, "clip": ["4", 1] }
      },
      "3": {
        "class_type": "KSampler",
        "inputs": {
          "seed": Math.floor(Math.random() * 1e15),
          "steps": 30,
          "cfg": 7,
          "sampler_name": "euler",
          "scheduler": "normal",
          "denoise": 1,
          "model": ["4", 0],
          "positive": ["6", 0],
          "negative": ["7", 0],
          "latent_image": ["5", 0]
        }
      },
      "8": {
        "class_type": "VAEDecode",
        "inputs": { "samples": ["3", 0], "vae": ["4", 2] }
      },
      "9": {
        "class_type": "SaveImage",
        "inputs": { "filename_prefix": "bd_portrait", "images": ["8", 0] }
      }
    };
  },

  // ===== WORKFLOW: InstantID — for panels with character face reference =====
  _buildInstantIDWorkflow(prompt, negativePrompt, refFilename) {
    return {
      "4": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": { "ckpt_name": "sd_xl_base_1.0.safetensors" }
      },
      "5": {
        "class_type": "EmptyLatentImage",
        "inputs": { "width": 1024, "height": 1024, "batch_size": 1 }
      },
      "6": {
        "class_type": "CLIPTextEncode",
        "inputs": { "text": prompt, "clip": ["4", 1] }
      },
      "7": {
        "class_type": "CLIPTextEncode",
        "inputs": { "text": negativePrompt, "clip": ["4", 1] }
      },
      // Load reference face image
      "10": {
        "class_type": "LoadImage",
        "inputs": { "image": refFilename }
      },
      // Load InstantID model
      "11": {
        "class_type": "InstantIDModelLoader",
        "inputs": { "instantid_file": "ip-adapter.bin" }
      },
      // Face analysis on reference image
      "12": {
        "class_type": "InstantIDFaceAnalysis",
        "inputs": { "provider": "CPU" }
      },
      // Load ControlNet for InstantID
      "13": {
        "class_type": "ControlNetLoader",
        "inputs": { "control_net_name": "diffusion_pytorch_model.safetensors" }
      },
      // Apply InstantID: combines face embedding + controlnet
      "21": {
        "class_type": "ApplyInstantID",
        "inputs": {
          "instantid": ["11", 0],
          "insightface": ["12", 0],
          "control_net": ["13", 0],
          "image": ["10", 0],
          "model": ["4", 0],
          "positive": ["6", 0],
          "negative": ["7", 0],
          "weight": 0.8,
          "start_at": 0.0,
          "end_at": 1.0
        }
      },
      // KSampler uses InstantID-modified model/conditioning
      "3": {
        "class_type": "KSampler",
        "inputs": {
          "seed": Math.floor(Math.random() * 1e15),
          "steps": 30,
          "cfg": 7,
          "sampler_name": "euler",
          "scheduler": "normal",
          "denoise": 1,
          "model": ["21", 0],
          "positive": ["21", 1],
          "negative": ["21", 2],
          "latent_image": ["5", 0]
        }
      },
      "8": {
        "class_type": "VAEDecode",
        "inputs": { "samples": ["3", 0], "vae": ["4", 2] }
      },
      "9": {
        "class_type": "SaveImage",
        "inputs": { "filename_prefix": "bd_panel", "images": ["8", 0] }
      }
    };
  },

  // Upload an image to ComfyUI, return the server filename
  async uploadImage(base64Data, filename) {
    const url = this.getUrl();
    const byteString = atob(base64Data.split(',')[1]);
    const mimeMatch = base64Data.match(/data:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    const blob = new Blob([ab], { type: mime });

    const formData = new FormData();
    formData.append('image', blob, filename || 'ref_face.png');
    formData.append('overwrite', 'true');

    const response = await fetch(url + '/upload/image', { method: 'POST', body: formData });
    if (!response.ok) throw new Error('Échec upload image vers ComfyUI');
    const result = await response.json();
    return result.name;
  },

  // ===== GENERATE: Portrait (no face ref) =====
  async generatePortrait(prompt, onProgress) {
    const neg = 'ugly, deformed, blurry, low quality, text, watermark, signature, bad anatomy, worst quality';
    if (onProgress) onProgress('Préparation portrait...');
    const workflow = this._buildPortraitWorkflow(prompt, neg);
    return this._queueAndWait(workflow, onProgress);
  },

  // ===== GENERATE: Panel with InstantID face ref =====
  // refImage can be: a filename (already on ComfyUI server), base64 data, or null
  async generatePanel(prompt, refImage, onProgress) {
    const neg = 'ugly, deformed, blurry, low quality, text, watermark, signature, bad anatomy, worst quality';

    if (!refImage) {
      if (onProgress) onProgress('Génération sans référence...');
      const workflow = this._buildPortraitWorkflow(prompt, neg);
      return this._queueAndWait(workflow, onProgress);
    }

    let refFilename;
    if (refImage.startsWith && refImage.startsWith('data:')) {
      // It's base64 — upload first
      if (onProgress) onProgress('Upload image de référence...');
      refFilename = await this.uploadImage(refImage, 'ref_' + Date.now() + '.png');
    } else {
      // It's already a filename on the ComfyUI server
      refFilename = refImage;
    }

    if (onProgress) onProgress('Préparation InstantID...');
    const workflow = this._buildInstantIDWorkflow(prompt, neg, refFilename);
    return this._queueAndWait(workflow, onProgress);
  },

  // ===== Queue workflow and wait for result =====
  async _queueAndWait(workflow, onProgress) {
    const url = this.getUrl();
    const clientId = 'bd_app_' + Date.now();

    if (onProgress) onProgress('Envoi à ComfyUI...');

    const queueResp = await fetch(url + '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId })
    });

    if (!queueResp.ok) {
      const err = await queueResp.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Erreur ComfyUI: ' + queueResp.status);
    }

    const promptId = (await queueResp.json()).prompt_id;
    if (onProgress) onProgress('Génération en cours...');

    // Try WebSocket first, fallback to polling
    return new Promise((resolve, reject) => {
      let ws;
      let timeout;
      const cleanup = () => {
        if (ws) try { ws.close(); } catch(e) {}
        if (timeout) clearTimeout(timeout);
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout: la génération a pris plus d\'1 heure'));
      }, 3600000);

      try {
        const wsUrl = url.replace('http', 'ws') + '/ws?clientId=' + clientId;
        ws = new WebSocket(wsUrl);

        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'progress' && onProgress) {
              onProgress('Génération... ' + Math.round((msg.data.value / msg.data.max) * 100) + '%');
            }
            if (msg.type === 'executed' && msg.data.prompt_id === promptId) {
              cleanup();
              try { resolve(await this._fetchImage(promptId)); }
              catch (e) { reject(e); }
            }
            if (msg.type === 'execution_error' && msg.data.prompt_id === promptId) {
              cleanup();
              reject(new Error('Erreur ComfyUI lors de la génération'));
            }
          } catch (e) {}
        };

        ws.onerror = () => {
          cleanup();
          this._poll(promptId, onProgress).then(resolve).catch(reject);
        };
      } catch (e) {
        this._poll(promptId, onProgress).then(resolve).catch(reject);
      }
    });
  },

  // Polling fallback
  async _poll(promptId, onProgress) {
    const url = this.getUrl();
    for (let i = 0; i < 3600; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (onProgress && i % 5 === 0) onProgress('Génération en cours...');
      try {
        const r = await fetch(url + '/history/' + promptId);
        if (!r.ok) continue;
        const hist = await r.json();
        if (hist[promptId] && hist[promptId].outputs) {
          return await this._fetchImage(promptId);
        }
      } catch (e) { continue; }
    }
    throw new Error('Timeout');
  },

  // Fetch the generated image as a ComfyUI reference (not base64)
  async _fetchImage(promptId) {
    const url = this.getUrl();
    const r = await fetch(url + '/history/' + promptId);
    if (!r.ok) throw new Error('Impossible de récupérer l\'historique');
    const hist = await r.json();
    const outputs = hist[promptId]?.outputs;

    for (const nodeId of Object.keys(outputs || {})) {
      const images = outputs[nodeId]?.images;
      if (images && images.length > 0) {
        const img = images[0];
        // Return a reference object instead of downloading the whole image
        return {
          type: 'comfyui',
          filename: img.filename,
          subfolder: img.subfolder || '',
          imgType: img.type || 'output',
          comfyUrl: url
        };
      }
    }
    throw new Error('Aucune image dans la sortie ComfyUI');
  },

  // Fetch image as base64 (only used for InstantID reference upload)
  async _fetchImageAsBase64(promptId) {
    const url = this.getUrl();
    const r = await fetch(url + '/history/' + promptId);
    if (!r.ok) throw new Error('Impossible de récupérer l\'historique');
    const hist = await r.json();
    const outputs = hist[promptId]?.outputs;

    for (const nodeId of Object.keys(outputs || {})) {
      const images = outputs[nodeId]?.images;
      if (images && images.length > 0) {
        const img = images[0];
        const imgResp = await fetch(url + '/view?' + new URLSearchParams({
          filename: img.filename,
          subfolder: img.subfolder || '',
          type: img.type || 'output'
        }));
        if (!imgResp.ok) throw new Error('Impossible de récupérer l\'image');
        const blob = await imgResp.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
    }
    throw new Error('Aucune image dans la sortie ComfyUI');
  }
};
