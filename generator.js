'use strict';

// ===== OPENAI (ChatGPT) API GENERATOR =====
const Generator = {

  FIXED_STYLE: 'realistic comic book style, dramatic lighting, cinematic composition, warm African color palette, detailed linework, strong shadows',

  // Appel générique OpenAI
  async _callOpenAI(apiKey, systemPrompt, userMessage, maxTokens) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      })
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('Clé API invalide. Vérifiez dans Paramètres.');
      if (response.status === 429) throw new Error('Trop de requêtes. Attendez un moment.');
      if (response.status === 402) throw new Error('Crédits API insuffisants. Rechargez votre compte OpenAI.');
      throw new Error(errBody.error?.message || 'Erreur API (' + response.status + ')');
    }

    const result = await response.json();
    const text = result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
    if (!text) throw new Error('Réponse vide de ChatGPT.');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Pas de JSON trouvé dans la réponse.');
    return JSON.parse(jsonMatch[0]);
  },

  // ===== ÉTAPE 1 : Générer une idée (titre + résumé) =====
  async generateIdea(apiKey) {
    const systemPrompt = "Tu es un créateur de concepts pour des micro-drames africains style drama TikTok/Reels. Tu inventes des histoires captivantes avec des rebondissements. Réponds UNIQUEMENT en JSON valide.";

    const userMessage = `Invente une idée originale de micro-drame africain. Le drame doit être intense, avec des retournements de situation, des personnages forts, et se dérouler dans un contexte africain contemporain (quartier populaire, ville fictive, etc.).

Réponds avec ce JSON exact :
{
  "title": "string — titre accrocheur du micro-drame",
  "summary": "string — résumé du pitch en 3-4 phrases, captivant, qui donne envie de lire la suite"
}`;

    const data = await this._callOpenAI(apiKey, systemPrompt, userMessage, 512);
    if (!data.title || !data.summary) throw new Error('Réponse incomplète.');
    return data;
  },

  // ===== ÉTAPE 2 : Générer la BD complète =====
  async generateDrama(params, apiKey, onProgress) {
    const { title, summary, themes } = params;

    onProgress('ChatGPT analyse l\'histoire...', 5);
    await this._wait(800);

    const themeBlock = themes.length > 0 ? '\nThèmes choisis par l\'utilisateur : ' + themes.join(', ') : '';

    const userMessage = `Voici le micro-drame à développer en BD complète :

Titre : ${title}
Pitch : ${summary}
${themeBlock}

À partir de ce pitch, crée un micro-drame BD COMPLET. Tu décides de TOUT :
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

    onProgress('ChatGPT crée les personnages...', 15);
    await this._wait(600);

    const systemPrompt = "Tu es un scénariste expert en micro-drames africains style drama asiatique TikTok/Reels. Tu crées des histoires captivantes avec des cliffhangers puissants, des dialogues percutants et des descriptions visuelles précises pour la génération d'images. Réponds UNIQUEMENT en JSON valide.";

    onProgress('ChatGPT écrit le scénario...', 25);

    let data;
    try {
      data = await this._callOpenAI(apiKey, systemPrompt, userMessage, 16384);
    } catch (err) {
      if (err.message.includes('Erreur réseau') || err.message.includes('Failed to fetch')) {
        throw new Error('Erreur réseau. Vérifiez votre connexion internet.');
      }
      throw err;
    }

    onProgress('ChatGPT découpe les cases...', 50);
    await this._wait(400);

    onProgress('ChatGPT rédige les dialogues...', 70);
    await this._wait(400);

    // Validate structure
    if (!data.characters || !data.episodes) {
      throw new Error('Structure JSON incomplète. Réessayez.');
    }

    onProgress('ChatGPT génère les prompts image...', 85);
    await this._wait(500);

    onProgress('Finalisation...', 95);
    await this._wait(400);

    onProgress('Terminé !', 100);
    return data;
  },

  rebuildPrompts(project) {
    const data = project.data;
    if (!data || !data.characters || !data.episodes) return;

    const style = this.FIXED_STYLE;

    data.characters.forEach(char => {
      char.pixverse_prompt = `${char.physical_description}, ${style}`;
    });

    data.episodes.forEach(ep => {
      ep.panels.forEach(panel => {
        const charsPresent = (panel.characters_present || [])
          .map(cid => data.characters.find(c => c.id === cid))
          .filter(Boolean);

        const charDescs = charsPresent.map(c => c.physical_description).join('. ');
        const bgPrompt = data.background_prompt || data.setting || '';
        const action = panel.scene_description || '';

        panel.pixverse_prompt = `${charDescs}. ${bgPrompt}. ${action}. ${style}`;
      });
    });
  },

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};
