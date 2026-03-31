'use strict';

// ===== CLAUDE API GENERATOR =====
const Generator = {

  FIXED_STYLE: 'realistic comic book style, dramatic lighting, cinematic composition, warm African color palette, detailed linework, strong shadows',

  async generateDrama(params, apiKey, onProgress) {
    const { title, description, setting, episodes, panelsPerEpisode, themes, characters } = params;

    onProgress('Claude analyse votre histoire...', 5);
    await this._wait(800);

    const characterBlock = characters.map((c, i) =>
      `Personnage ${i + 1} : ${c.name} — ${c.description}`
    ).join('\n');

    const themeBlock = themes.length > 0 ? `Thèmes principaux : ${themes.join(', ')}` : '';

    const userMessage = `Crée un micro-drame BD complet avec ces paramètres :

Titre : ${title}
Description : ${description}
Ville / Contexte : ${setting}
Nombre d'épisodes : ${episodes}
Nombre de cases par épisode : ${panelsPerEpisode}
${themeBlock}

Personnages :
${characterBlock}

IMPORTANT pour chaque pixverse_prompt :
1. Description physique exacte du/des personnage(s) présent(s) EN ANGLAIS
2. Contexte arrière-plan de la scène adapté au setting
3. Action précise de la case
4. Style fixe à ajouter à la fin : "${this.FIXED_STYLE}"

Chaque personnage doit avoir un pixverse_prompt décrivant son apparence physique en anglais + le style fixe.

Le champ "layout" de chaque case doit être l'un de : "full", "wide", "medium", "small".
Environ 20% full, 30% wide, 30% medium, 20% small, variés.

Réponds avec ce JSON exact :
{
  "title": "string",
  "setting": "string — description du lieu",
  "background_prompt": "string — prompt Pixverse arrière-plan de référence en anglais",
  "characters": [{
    "id": "string (slug unique ex: amara)",
    "name": "string",
    "role": "string",
    "age": number,
    "physical_description": "string en anglais détaillé",
    "personality": "string en français",
    "pixverse_prompt": "string — physical description + style fixe"
  }],
  "episodes": [{
    "number": number,
    "title": "string",
    "panels": [{
      "number": number,
      "layout": "full|wide|medium|small",
      "scene_description": "string en français",
      "characters_present": ["character_id"],
      "dialogue": {"character_id": "texte dialogue"} ou null,
      "voice_over": "string" ou null,
      "sfx": "string" ou null,
      "caption": "string" ou null,
      "cliffhanger": boolean,
      "pixverse_prompt": "string — personnage physique + arrière-plan + action + style fixe, EN ANGLAIS"
    }],
    "cliffhanger_text": "string"
  }]
}`;

    onProgress('Claude crée les personnages...', 15);
    await this._wait(600);

    const systemPrompt = "Tu es un scénariste expert en micro-drames africains style drama asiatique TikTok/Reels. Tu crées des histoires captivantes avec des cliffhangers puissants, des dialogues percutants et des descriptions visuelles précises pour la génération d'images. Réponds UNIQUEMENT en JSON valide, aucun texte avant ou après le JSON.";

    onProgress('Claude écrit le scénario...', 25);

    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 16384,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }]
        })
      });
    } catch (err) {
      throw new Error('Erreur réseau. Vérifiez votre connexion internet.');
    }

    onProgress('Claude découpe les cases...', 50);

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      if (response.status === 401) {
        throw new Error('Clé API invalide. Vérifiez votre clé Claude.');
      }
      if (response.status === 429) {
        throw new Error('Trop de requêtes. Attendez un moment et réessayez.');
      }
      throw new Error(errBody.error?.message || `Erreur API (${response.status})`);
    }

    onProgress('Claude rédige les dialogues...', 70);

    const result = await response.json();
    const textContent = result.content && result.content[0] && result.content[0].text;

    if (!textContent) {
      throw new Error('Réponse vide de Claude. Réessayez.');
    }

    onProgress('Claude génère les prompts image...', 85);
    await this._wait(500);

    let data;
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Pas de JSON trouvé');
      data = JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error('Erreur de parsing JSON. La réponse de Claude n\'est pas valide. Réessayez.');
    }

    // Validate structure
    if (!data.characters || !data.episodes) {
      throw new Error('Structure JSON incomplète. Réessayez.');
    }

    onProgress('Finalisation...', 95);
    await this._wait(400);

    onProgress('Terminé !', 100);
    return data;
  },

  rebuildPrompts(project) {
    const data = project.data;
    if (!data || !data.characters || !data.episodes) return;

    const style = this.FIXED_STYLE;

    // Rebuild character pixverse_prompts
    data.characters.forEach(char => {
      char.pixverse_prompt = `${char.physical_description}, ${style}`;
    });

    // Rebuild panel pixverse_prompts
    data.episodes.forEach(ep => {
      ep.panels.forEach(panel => {
        const charsPresent = (panel.characters_present || [])
          .map(cid => data.characters.find(c => c.id === cid))
          .filter(Boolean);

        const charDescs = charsPresent.map(c => c.physical_description).join('. ');
        const bgPrompt = data.background_prompt || data.setting || '';

        // Extract action from scene description
        const action = panel.scene_description || '';

        panel.pixverse_prompt = `${charDescs}. ${bgPrompt}. ${action}. ${style}`;
      });
    });
  },

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};
