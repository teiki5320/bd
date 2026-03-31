'use strict';

// ===== CLAUDE API GENERATOR =====
const Generator = {

  FIXED_STYLE: 'realistic comic book style, dramatic lighting, cinematic composition, warm African color palette, detailed linework, strong shadows',

  // ===== ÉTAPE 1 : Générer une idée (titre + résumé) =====
  async generateIdea(apiKey) {
    const systemPrompt = "Tu es un créateur de concepts pour des micro-drames africains style drama TikTok/Reels. Tu inventes des histoires captivantes avec des rebondissements. Réponds UNIQUEMENT en JSON valide, aucun texte avant ou après.";

    const userMessage = `Invente une idée originale de micro-drame africain. Le drame doit être intense, avec des retournements de situation, des personnages forts, et se dérouler dans un contexte africain contemporain (quartier populaire, ville fictive, etc.).

Réponds avec ce JSON exact :
{
  "title": "string — titre accrocheur du micro-drame",
  "summary": "string — résumé du pitch en 3-4 phrases, captivant, qui donne envie de lire la suite"
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!response.ok) {
      if (response.status === 401) throw new Error('Clé API invalide. Vérifiez dans Paramètres.');
      if (response.status === 429) throw new Error('Trop de requêtes. Attendez un moment.');
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `Erreur API (${response.status})`);
    }

    const result = await response.json();
    const text = result.content && result.content[0] && result.content[0].text;
    if (!text) throw new Error('Réponse vide de Claude.');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Pas de JSON trouvé.');
    const data = JSON.parse(jsonMatch[0]);

    if (!data.title || !data.summary) throw new Error('Réponse incomplète.');
    return data;
  },

  // ===== ÉTAPE 2 : Générer la BD complète =====
  async generateDrama(params, apiKey, onProgress) {
    const { title, summary, themes } = params;

    onProgress('Claude analyse l\'histoire...', 5);
    await this._wait(800);

    const themeBlock = themes.length > 0 ? `\nThèmes choisis par l'utilisateur : ${themes.join(', ')}` : '';

    const userMessage = `Voici le micro-drame à développer en BD complète :

Titre : ${title}
Pitch : ${summary}
${themeBlock}

À partir de ce pitch, crée un micro-drame BD COMPLET. Tu décides de TOUT :
- Le titre accrocheur
- La ville / le contexte (ville fictive africaine)
- Les personnages (3 à 6, avec noms africains, descriptions physiques détaillées, personnalités)
- Le nombre d'épisodes (minimum 5, adapté à la complexité de l'histoire)
- Le nombre de cases par épisode (entre 10 et 25, adapté au rythme)
- Le découpage complet avec dialogues, voix off, SFX
- Des cliffhangers puissants à chaque fin d'épisode

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
