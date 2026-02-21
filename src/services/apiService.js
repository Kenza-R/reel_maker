import { GoogleGenAI, Type } from '@google/genai';
import { generateYouTubeThumbnail as genThumbnail } from './gemini';

const API_KEY = (process.env.REACT_APP_GEMINI_API_KEY || '').trim();
const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

async function loadChatPrompt() {
  const res = await fetch('/chat_prompt.txt');
  if (!res.ok) throw new Error('Failed to load chat_prompt.txt');
  return res.text();
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * HW4 Task 1: Build full current script (all scenes: description, narration original, narration translated if present)
 * for injection into chat so the AI can reference and suggest improvements to specific content.
 */
function buildScriptContext(scenes) {
  if (!scenes?.length) return '';
  const lines = scenes.map((s) => {
    let block = `Scene ${s.sceneNumber}:\n  Description: ${s.description || '(none)'}\n  Narration (original): ${s.narration || '(none)'}`;
    if (s.narrationTranslated) block += `\n  Narration (translated): ${s.narrationTranslated}`;
    return block;
  });
  return `CURRENT SCRIPT:\n\n${lines.join('\n\n')}`;
}

/**
 * HW4 Tasks 4-7: Chat tools. Every tool has its purpose/params defined here AND in public/chat_prompt.txt.
 * Task 4: translateNarrations. Task 5: generateYouTubeTitle. Task 6: generateYouTubeDescription. Task 7: generateYouTubeThumbnail.
 */
const chatTools = {
  functionDeclarations: [
    {
      name: 'generateMovieScript',
      description: 'Writes the generated movie script with scenes into the scene editor. Call this when the user has described their idea and you are ready to produce the script.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          scenes: {
            type: Type.ARRAY,
            description: 'Array of scene objects for the video reel',
            items: {
              type: Type.OBJECT,
              properties: {
                sceneNumber: { type: Type.INTEGER, description: 'Scene number (1-based index)' },
                description: { type: Type.STRING, description: 'Vivid visual description for image generation' },
                narration: { type: Type.STRING, description: 'Narration text with optional TTS tags like [excited] or [whispering]' },
              },
              required: ['sceneNumber', 'description', 'narration'],
            },
          },
        },
        required: ['scenes'],
      },
    },
    {
      name: 'translateNarrations', /* HW4 Task 4 */
      description: 'Translates all scene narrations to a target language and updates the narration boxes. Call when the user asks to translate (e.g. "Translate to Spanish"). Pass either translatedNarrations (array of strings, same order as scenes) or scenes (array of { sceneNumber, narration }).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          targetLanguage: { type: Type.STRING, description: 'Target language name (e.g. Spanish, French)' },
          translatedNarrations: {
            type: Type.ARRAY,
            description: 'Array of translated narration strings in same order as scenes',
            items: { type: Type.STRING },
          },
          scenes: {
            type: Type.ARRAY,
            description: 'Alternative: array of { sceneNumber, narration } with translated text',
            items: {
              type: Type.OBJECT,
              properties: {
                sceneNumber: { type: Type.INTEGER },
                narration: { type: Type.STRING },
              },
              required: ['sceneNumber', 'narration'],
            },
          },
        },
        required: ['targetLanguage'],
      },
    },
    {
      name: 'generateYouTubeTitle', /* HW4 Task 5 */
      description: 'Generates a catchy YouTube video title. Pass the title you generate so it is displayed in the app.',
      parameters: {
        type: Type.OBJECT,
        properties: { title: { type: Type.STRING, description: 'Catchy title under 100 characters' } },
        required: ['title'],
      },
    },
    {
      name: 'generateYouTubeDescription', /* HW4 Task 6 */
      description: 'Generates a YouTube video description. Pass the description you generate so it is displayed in the app.',
      parameters: {
        type: Type.OBJECT,
        properties: { description: { type: Type.STRING, description: 'Engaging SEO-friendly description' } },
        required: ['description'],
      },
    },
    {
      name: 'generateYouTubeThumbnail', /* HW4 Task 7 */
      description: 'Triggers thumbnail image generation in the app. Pass prompt (visual description for thumbnail) and/or modelTier "cheap" or "expensive". Output is displayed in the app.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          prompt: { type: Type.STRING, description: 'Optional: visual description for the thumbnail image' },
          modelTier: { type: Type.STRING, description: 'Optional: "cheap" or "expensive" for image model' },
        },
        required: [],
      },
    },
  ],
};

/** @deprecated Use chatTools */
export const movieTool = chatTools;

/**
 * Create and return a chat session configured with the movie tool and system prompt.
 * Uses ai.chats.create() (not getGenerativeModel/startChat - those are from the older @google/generative-ai SDK).
 * @returns {Promise<Object|null>} Chat instance or null if API key missing
 */
export async function createAssistantChat() {
  if (!ai) return null;

  const systemInstruction = await loadChatPrompt();

  const chat = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction,
      tools: [chatTools],
      toolConfig: {
        functionCallingConfig: {
          mode: 'AUTO',
        },
      },
    },
  });

  return chat;
}

/**
 * Send a message to the assistant and process the response (streaming).
 * Calls onChunk(text) as text arrives. If the response contains function calls (generateMovieScript), executes onScript.
 * @param {Object} chat - Chat instance from createAssistantChat
 * @param {string} message - User message
 * @param {Function} onScript - Callback (args) => void when generateMovieScript is called
 * @param {Array<Blob|File|null>} [anchorImages] - Optional anchor images [image1, image2, image3] to include in context
 * @param {Function} [onChunk] - Callback (text) => void for streaming text as it arrives
 * @param {Array<{sceneNumber, description, narration, imageBlob?}>} [scenes] - Current script for context and thumbnail
 * @param {Function} [onTranslateNarrations] - Callback (args) => void for translateNarrations
 * @param {Function} [onYouTubeTitle] - Callback (title) => void
 * @param {Function} [onYouTubeDescription] - Callback (description) => void
 * @param {Function} [onYouTubeThumbnail] - Callback (blob) => void
 * @returns {Promise<{text: string, functionCalled: boolean}>}
 */
export async function sendAssistantMessage(chat, message, onScript, anchorImages = [], onChunk, scenes = [], onTranslateNarrations, onYouTubeTitle, onYouTubeDescription, onYouTubeThumbnail) {
  if (!chat) throw new Error('API key not configured');
  console.log('[AI Reel Maker] sendAssistantMessage called');

  /* HW4 Task 1: Full script injected into every message so AI can critique/reference specific scenes */
  const scriptContext = buildScriptContext(scenes);
  let textPayload = scriptContext ? `${scriptContext}\n\nUSER MESSAGE:\n${message}` : message;
  const hasImages = anchorImages?.some((img) => img != null);
  if (hasImages) {
    const parts = [{ text: `Here are my anchor images (image 1, 2, 3) for style reference:\n\n${textPayload}` }];
    for (let i = 0; i < 3; i++) {
      const img = anchorImages[i];
      if (img) {
        const base64 = await blobToBase64(img);
        const mime = img.type || 'image/png';
        parts.push({ inlineData: { mimeType: mime, data: base64 } });
      }
    }
    textPayload = parts;
  }
  const messageContent = typeof textPayload === 'string' ? textPayload : textPayload;

  const response = await chat.sendMessage({ message: messageContent });

  // Extract function calls - check both getter and parts (SDK structure can vary)
  let functionCalls = response?.functionCalls;
  if (!functionCalls?.length) {
    const parts = response?.candidates?.[0]?.content?.parts || [];
    functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall).filter(Boolean);
  }
  const text = response?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join('')
    .trim() || '';

  if (functionCalls && functionCalls.length > 0) {
    let confirmText = '';
    for (const fc of functionCalls) {
      const name = fc?.name;
      const args = fc?.args || {};
      if (name === 'generateMovieScript' && args.scenes) {
        onScript(args);
        confirmText = confirmText || 'I\'ve added the script to your scene editor. You can review and edit it there, then generate images and audio for each scene.';
      } else if (name === 'translateNarrations' && args.targetLanguage) {
        if (Array.isArray(args.translatedNarrations)) {
          onTranslateNarrations?.({ targetLanguage: args.targetLanguage, translatedNarrations: args.translatedNarrations });
        } else if (Array.isArray(args.scenes)) {
          onTranslateNarrations?.(args);
        }
        confirmText = confirmText || `I've translated the narrations to ${args.targetLanguage}. The narration boxes are updated.`;
      } else if (name === 'generateYouTubeTitle' && args.title) {
        onYouTubeTitle?.(args.title);
        confirmText = confirmText || 'I\'ve generated a YouTube title. Check the YouTube metadata section.';
      } else if (name === 'generateYouTubeDescription' && args.description) {
        onYouTubeDescription?.(args.description);
        confirmText = confirmText || 'I\'ve generated a YouTube description. Check the YouTube metadata section.';
      } else if (name === 'generateYouTubeThumbnail') {
        const tier = args.modelTier || args.imageModel || 'cheap';
        const modelId = (tier === 'expensive') ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image';
        const scriptSummary = buildScriptContext(scenes) || 'Short video reel.';
        const prompt = args.prompt && args.prompt.trim() ? args.prompt.trim() : scriptSummary;
        const sceneBlobs = (scenes || []).map((s) => s.imageBlob).filter(Boolean);
        try {
          const blob = await genThumbnail(prompt, sceneBlobs, modelId);
          onYouTubeThumbnail?.(blob);
          confirmText = confirmText || 'Thumbnail generated and displayed in the YouTube metadata section.';
        } catch (err) {
          console.error('[AI Reel Maker] Thumbnail generation failed:', err);
          confirmText = confirmText || `Thumbnail generation failed: ${err?.message || 'Unknown error'}.`;
        }
      }
    }
    onChunk?.(confirmText);
    return { text: confirmText, functionCalled: true };
  }

  const parsed = tryParseScriptFromText(text);
  if (parsed) {
    onScript(parsed);
    onChunk?.('I\'ve added the script to your scene editor. You can review and edit it there, then generate images and audio for each scene.');
    return { text: 'I\'ve added the script to your scene editor.', functionCalled: true };
  }

  onChunk?.(text);
  return { text, functionCalled: false };
}

/** Try to extract and parse a scenes array from model text (fallback when model outputs JSON instead of calling tool) */
function tryParseScriptFromText(text) {
  if (!text?.trim()) return null;
  try {
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const scenes = arr.filter((s) => s && (s.description || s.narration));
    if (scenes.length === 0) return null;
    return { scenes };
  } catch {
    return null;
  }
}
