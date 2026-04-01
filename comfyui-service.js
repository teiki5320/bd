'use strict';

// ===== COMFYUI SERVICE =====
const ComfyUI = {
  serverUrl: 'http://127.0.0.1:8188',

  getUrl() {
    return localStorage.getItem('comfyui_url') || this.serverUrl;
  },

  setUrl(url) {
    localStorage.setItem('comfyui_url', url.replace(/\/+$/, ''));
  },

  // Check if ComfyUI is reachable
  async ping() {
    try {
      const r = await fetch(this.getUrl() + '/system_stats', { signal: AbortSignal.timeout(3000) });
      return r.ok;
    } catch (e) {
      return false;
    }
  },

  // Build the InstantID workflow JSON
  _buildWorkflow(prompt, negativePrompt, refImageBase64) {
    // Workflow with InstantID for face consistency
    const workflow = {
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
          "positive": ["6", 0],
          "negative": ["7", 0],
          "latent_image": ["5", 0]
        }
      },
      "4": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {
          "ckpt_name": "sd_xl_base_1.0.safetensors"
        }
      },
      "5": {
        "class_type": "EmptyLatentImage",
        "inputs": {
          "width": 1024,
          "height": 1024,
          "batch_size": 1
        }
      },
      "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {
          "text": prompt,
          "clip": ["4", 1]
        }
      },
      "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {
          "text": negativePrompt,
          "clip": ["4", 1]
        }
      },
      "8": {
        "class_type": "VAEDecode",
        "inputs": {
          "samples": ["3", 0],
          "vae": ["4", 2]
        }
      },
      "9": {
        "class_type": "SaveImage",
        "inputs": {
          "filename_prefix": "bd_panel",
          "images": ["8", 0]
        }
      }
    };

    // If we have a reference face image, add InstantID nodes
    if (refImageBase64) {
      // Load the reference image
      workflow["10"] = {
        "class_type": "LoadImage",
        "inputs": {
          "image": refImageBase64,
          "upload": "image"
        }
      };
      // InstantID model loader
      workflow["11"] = {
        "class_type": "InstantIDModelLoader",
        "inputs": {
          "instantid_file": "ip-adapter.bin"
        }
      };
      // Face analysis
      workflow["12"] = {
        "class_type": "InstantIDFaceAnalysis",
        "inputs": {
          "provider": "CPU"
        }
      };
      // Apply InstantID
      workflow["21"] = {
        "class_type": "ApplyInstantID",
        "inputs": {
          "instantid": ["11", 0],
          "insightface": ["12", 0],
          "control_net": ["11", 1],
          "image": ["10", 0],
          "model": ["4", 0],
          "positive": ["6", 0],
          "negative": ["7", 0],
          "weight": 0.8,
          "start_at": 0,
          "end_at": 1
        }
      };
      // KSampler uses the InstantID-modified model
      workflow["3"].inputs.model = ["21", 0];
      workflow["3"].inputs.positive = ["21", 1];
      workflow["3"].inputs.negative = ["21", 2];
    } else {
      // No InstantID — connect KSampler directly to checkpoint
      workflow["3"].inputs.model = ["4", 0];
    }

    return workflow;
  },

  // Build a simple workflow without InstantID
  _buildSimpleWorkflow(prompt, negativePrompt) {
    return this._buildWorkflow(prompt, negativePrompt, null);
  },

  // Upload an image to ComfyUI and return the filename
  async uploadImage(base64Data, filename) {
    const url = this.getUrl();
    // Convert base64 to blob
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

    const response = await fetch(url + '/upload/image', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) throw new Error('Échec upload image vers ComfyUI');
    const result = await response.json();
    return result.name; // filename on server
  },

  // Queue a prompt and wait for the result
  async generate(prompt, negativePrompt, refImageBase64, onProgress) {
    const url = this.getUrl();
    negativePrompt = negativePrompt || 'ugly, deformed, blurry, low quality, text, watermark, signature, bad anatomy, worst quality';

    if (onProgress) onProgress('Préparation du workflow...');

    let uploadedFilename = null;
    if (refImageBase64) {
      if (onProgress) onProgress('Upload de l\'image de référence...');
      uploadedFilename = await this.uploadImage(refImageBase64, 'ref_face_' + Date.now() + '.png');
    }

    // Build workflow
    let workflow;
    if (uploadedFilename) {
      workflow = this._buildWorkflow(prompt, negativePrompt, uploadedFilename);
      // Fix: LoadImage uses filename, not base64
      workflow["10"].inputs = { "image": uploadedFilename, "upload": "image" };
    } else {
      workflow = this._buildSimpleWorkflow(prompt, negativePrompt);
    }

    if (onProgress) onProgress('Envoi à ComfyUI...');

    // Queue the prompt
    const clientId = 'bd_app_' + Date.now();
    const queueResp = await fetch(url + '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId })
    });

    if (!queueResp.ok) {
      const err = await queueResp.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Erreur ComfyUI: ' + queueResp.status);
    }

    const queueData = await queueResp.json();
    const promptId = queueData.prompt_id;

    if (onProgress) onProgress('Génération en cours...');

    // Poll for completion via WebSocket
    return new Promise((resolve, reject) => {
      let ws;
      let timeout;

      const cleanup = () => {
        if (ws) try { ws.close(); } catch(e) {}
        if (timeout) clearTimeout(timeout);
      };

      // Timeout after 120s
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout: la génération a pris trop de temps'));
      }, 120000);

      try {
        const wsUrl = url.replace('http', 'ws') + '/ws?clientId=' + clientId;
        ws = new WebSocket(wsUrl);

        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === 'progress' && onProgress) {
              const pct = Math.round((msg.data.value / msg.data.max) * 100);
              onProgress('Génération... ' + pct + '%');
            }

            if (msg.type === 'executed' && msg.data.prompt_id === promptId) {
              cleanup();
              // Get the image from history
              try {
                const imgBase64 = await this._fetchGeneratedImage(promptId);
                resolve(imgBase64);
              } catch (fetchErr) {
                reject(fetchErr);
              }
            }

            if (msg.type === 'execution_error' && msg.data.prompt_id === promptId) {
              cleanup();
              reject(new Error('Erreur de génération ComfyUI'));
            }
          } catch (parseErr) {
            // Ignore non-JSON messages
          }
        };

        ws.onerror = () => {
          cleanup();
          // Fallback to polling
          this._pollForResult(promptId, onProgress).then(resolve).catch(reject);
        };
      } catch (wsErr) {
        // WebSocket not available, fallback to polling
        this._pollForResult(promptId, onProgress).then(resolve).catch(reject);
      }
    });
  },

  // Polling fallback if WebSocket fails
  async _pollForResult(promptId, onProgress) {
    const url = this.getUrl();
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (onProgress && i % 5 === 0) onProgress('Génération en cours...');

      const histResp = await fetch(url + '/history/' + promptId);
      if (!histResp.ok) continue;

      const hist = await histResp.json();
      if (hist[promptId] && hist[promptId].outputs) {
        return await this._fetchGeneratedImage(promptId);
      }
    }
    throw new Error('Timeout: la génération a pris trop de temps');
  },

  // Fetch generated image as base64
  async _fetchGeneratedImage(promptId) {
    const url = this.getUrl();
    const histResp = await fetch(url + '/history/' + promptId);
    if (!histResp.ok) throw new Error('Impossible de récupérer l\'historique');

    const hist = await histResp.json();
    const outputs = hist[promptId]?.outputs;

    // Find the SaveImage node output
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
    throw new Error('Aucune image trouvée dans la sortie ComfyUI');
  }
};
