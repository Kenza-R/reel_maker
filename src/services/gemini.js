import { GoogleGenAI } from '@google/genai';

const API_KEY = (process.env.REACT_APP_GEMINI_API_KEY || '').trim();

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

const MODELS = {
  text: 'gemini-2.5-flash',
  image: 'gemini-2.5-flash-image',
  tts: 'gemini-2.5-flash-preview-tts',
};

export const IMAGE_MODELS = [
  { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image' },
];

export const GEMINI_TTS_VOICES = [
  { id: 'Aoede', name: 'Aoede', tone: 'Breezy, conversational, and intelligent', gender: 'Female' },
  { id: 'Callirrhoe', name: 'Callirrhoe', tone: 'Easy-going, clear, and articulate', gender: 'Female' },
  { id: 'Charon', name: 'Charon', tone: 'Informative, calm, and assured', gender: 'Male' },
  { id: 'Fenrir', name: 'Fenrir', tone: 'Excitable, warm, and approachable', gender: 'Male' },
  { id: 'Kore', name: 'Kore', tone: 'Firm, neutral, and professional', gender: 'Female' },
  { id: 'Leda', name: 'Leda', tone: 'Youthful, professional, and composed', gender: 'Female' },
  { id: 'Orus', name: 'Orus', tone: 'Firm, mature, and resonant', gender: 'Male' },
  { id: 'Puck', name: 'Puck', tone: 'Upbeat, friendly, and energetic (Default)', gender: 'Male' },
  { id: 'Zephyr', name: 'Zephyr', tone: 'Bright, perky, and enthusiastic', gender: 'Female' },
];

/**
 * Load the script-generation prompt from public/prompt_script.txt.
 * The file should contain {{MOVIE_IDEA}} as a placeholder for the user's idea.
 */
async function loadPromptTemplate() {
  const res = await fetch('/prompt_script.txt');
  if (!res.ok) throw new Error('Failed to load prompt_script.txt');
  return res.text();
}

/**
 * Generate a JSON array of scenes from a movie idea.
 * @param {string} movieIdea - The user's movie idea/script idea
 * @returns {Promise<Array<{sceneNumber: number, description: string, narration: string}>>}
 */
export async function generateScenes(movieIdea) {
  if (!ai) throw new Error('API key not configured');
  const template = await loadPromptTemplate();
  const prompt = template.replace(/\{\{MOVIE_IDEA\}\}/g, movieIdea.trim());
  const response = await ai.models.generateContent({
    model: MODELS.text,
    contents: [{ parts: [{ text: prompt }] }],
  });
  const text = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('No response from Gemini');
  const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Generate an image from a description using Imagen/Gemini image model.
 *
 * PROMPT CONSTRUCTION:
 * 1. Text prompt: We instruct the model that reference images may be provided (image 1, 2, 3).
 * 2. If the description references "image 1", "image 2", or "image 3", we include the corresponding
 *    anchor images in the API call, in that order (1, 2, 3).
 * 3. Content parts order: [textPrompt, image1Data, image2Data, image3Data] — only images that are
 *    both referenced and provided are included.
 * 4. The text tells the model: "Generate an image based on: {description}. Reference images are
 *    provided below in order: image 1, image 2, image 3. Use them as specified."
 *
 * @param {string} description - Visual description (may reference "image 1", "image 2", "image 3")
 * @param {Array<Blob|null>} anchorImages - Optional [image1, image2, image3] blobs
 * @param {string} modelId - Image model (e.g. gemini-2.5-flash-image, gemini-3-pro-image-preview)
 * @returns {Promise<Blob>} - PNG image blob
 */
export async function generateImage(description, anchorImages = [], modelId = MODELS.image) {
  if (!ai) throw new Error('API key not configured');

  const refs = [];
  const desc = (description || '').toLowerCase();
  if (desc.includes('image 1') && anchorImages[0]) refs.push(1);
  if (desc.includes('image 2') && anchorImages[1]) refs.push(2);
  if (desc.includes('image 3') && anchorImages[2]) refs.push(3);

  const parts = [];
  const promptPrefix = refs.length > 0
    ? `Generate an image based on this description. Reference images are provided below in order as image 1, image 2, image 3. Use them according to the description.\n\nDescription: `
    : '';
  parts.push({ text: promptPrefix + description });

  for (const n of refs) {
    const blob = anchorImages[n - 1];
    if (!blob) continue;
    const base64 = await blobToBase64(blob);
    const mime = blob.type || 'image/png';
    parts.push({ inlineData: { mimeType: mime, data: base64 } });
  }

  const response = await ai.models.generateContent({
    model: modelId,
    contents: [{ parts }],
    config: { responseModalities: ['TEXT', 'IMAGE'] },
  });
  const outParts = response?.candidates?.[0]?.content?.parts || [];
  for (const part of outParts) {
    if (part.inlineData?.data) {
      const bytes = Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0));
      return new Blob([bytes], { type: part.inlineData.mimeType || 'image/png' });
    }
  }
  throw new Error('No image in response');
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
 * Generate audio from text using Gemini TTS.
 * @param {string} text - Narration text
 * @param {string} voice - One of Kore, Aoede, Callirrhoe
 * @returns {Promise<Blob>} - WAV audio blob
 */
export async function generateTTSGemini(text, voice = 'Kore') {
  if (!ai) throw new Error('API key not configured');
  const validIds = GEMINI_TTS_VOICES.map((v) => v.id);
  const voiceName = validIds.includes(voice) ? voice : 'Kore';
  const response = await ai.models.generateContent({
    model: MODELS.tts,
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });
  const data = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!data) throw new Error('No audio in response');
  const pcm = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  return pcmToWav(pcm, 24000, 1);
}

/**
 * Fetch all available voices from ElevenLabs.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function fetchElevenLabsVoices() {
  const apiKey = (process.env.REACT_APP_ELEVENLABS_API_KEY || '').trim();
  if (!apiKey) throw new Error('ElevenLabs API key required');

  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    method: 'GET',
    headers: { 'xi-api-key': apiKey },
  });

  if (!res.ok) throw new Error('Failed to fetch ElevenLabs voices');

  const data = await res.json();
  return data.voices
    .map((v) => ({ id: v.voice_id, name: v.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Generate audio from text using ElevenLabs TTS.
 * @param {string} text - Narration text
 * @param {string} voiceId - ElevenLabs voice ID
 * @returns {Promise<Blob>} - MP3 audio blob
 */
export async function generateTTSElevenLabs(text, voiceId) {
  const apiKey = (process.env.REACT_APP_ELEVENLABS_API_KEY || '').trim();
  if (!apiKey) throw new Error('ElevenLabs API key required in .env');
  if (!voiceId) throw new Error('Select an ElevenLabs voice');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text, model_id: 'eleven_v3' }),
  });
  if (!res.ok) {
    const err = await res.text();
    const msg = res.status === 401
      ? `ElevenLabs 401: Invalid API key or voice. Check your .env (REACT_APP_ELEVENLABS_API_KEY) and restart the dev server. Response: ${err}`
      : `ElevenLabs error: ${res.status} ${err}`;
    throw new Error(msg);
  }
  return await res.blob();
}

/**
 * Generate TTS - dispatches to Gemini or ElevenLabs based on provider.
 * @param {string} text - Narration text
 * @param {string} provider - 'gemini' or 'elevenlabs'
 * @param {string} voice - For Gemini: Kore, Aoede, Callirrhoe. For ElevenLabs: voice ID
 */
export async function generateTTS(text, provider = 'gemini', voice = 'Kore') {
  if (provider === 'elevenlabs') return generateTTSElevenLabs(text, voice);
  return generateTTSGemini(text, voice);
}

/**
 * Batch translate narrations to a target language. Returns array of strings in same order.
 * Preserves meaning, tone, and bracketed TTS tags like [whispering]. Returns ONLY valid JSON array.
 * @param {string[]} narrations - Array of narration texts to translate
 * @param {string} targetLanguageLabel - Target language (e.g. "French", "Mandarin Chinese")
 * @returns {Promise<string[]>}
 */
export async function translateNarrationsBatch(narrations, targetLanguageLabel) {
  if (!ai) throw new Error('API key not configured');
  if (!narrations?.length) return [];
  const prompt = `You are a professional translator. Translate the following narration lines into ${targetLanguageLabel}. Preserve meaning and tone. Keep bracketed TTS/emotional tags (e.g. [excited], [whispering]) exactly unchanged. Do not add any commentary—return ONLY a valid JSON array of strings in the same order and length as the input.\n\nNarrations:\n${narrations.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;
  const response = await ai.models.generateContent({
    model: MODELS.text,
    contents: [{ parts: [{ text: prompt }] }],
  });
  const text = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('No translation response');
  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Translation did not return valid JSON array');
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  if (arr.length !== narrations.length) throw new Error(`Translation returned ${arr.length} items, expected ${narrations.length}`);
  return arr.map((s) => (typeof s === 'string' ? s : String(s ?? '')));
}

/** @deprecated Use translateNarrationsBatch(narrations, targetLanguage) */
export async function translateNarrations(targetLanguage, narrations) {
  return translateNarrationsBatch(narrations, targetLanguage);
}

/**
 * Generate a YouTube title from script summary and optional scene images as context.
 * @param {string} scriptSummary - Full script text (descriptions + narrations)
 * @param {Array<Blob>} [sceneImageBlobs] - Optional scene images for visual context
 * @returns {Promise<string>}
 */
export async function generateYouTubeTitle(scriptSummary, sceneImageBlobs = []) {
  if (!ai) throw new Error('API key not configured');
  const prompt = `Generate a single catchy YouTube video title (under 100 characters) for this reel. Use the script below and the attached scene images as context. Return ONLY the title text, no quotes or extra text.\n\nScript:\n${scriptSummary}`;
  const parts = [{ text: prompt }];
  for (const blob of (sceneImageBlobs || []).filter(Boolean).slice(0, 3)) {
    const base64 = await blobToBase64(blob);
    parts.push({ inlineData: { mimeType: blob.type || 'image/png', data: base64 } });
  }
  const response = await ai.models.generateContent({
    model: MODELS.text,
    contents: [{ parts }],
  });
  const title = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return title || 'Untitled';
}

/**
 * Generate a YouTube description from script summary and optional scene images as context.
 * @param {string} scriptSummary - Full script text
 * @param {Array<Blob>} [sceneImageBlobs] - Optional scene images for visual context
 * @returns {Promise<string>}
 */
export async function generateYouTubeDescription(scriptSummary, sceneImageBlobs = []) {
  if (!ai) throw new Error('API key not configured');
  const prompt = `Generate a YouTube video description (2-4 short paragraphs, engaging and SEO-friendly) for this reel. Use the script and attached scene images below. Return ONLY the description text.\n\nScript:\n${scriptSummary}`;
  const parts = [{ text: prompt }];
  for (const blob of (sceneImageBlobs || []).filter(Boolean).slice(0, 3)) {
    const base64 = await blobToBase64(blob);
    parts.push({ inlineData: { mimeType: blob.type || 'image/png', data: base64 } });
  }
  const response = await ai.models.generateContent({
    model: MODELS.text,
    contents: [{ parts }],
  });
  const desc = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return desc || '';
}

/**
 * Generate a YouTube thumbnail image from script and optional scene images.
 * @param {string} scriptSummary - Summary or full script for context
 * @param {Array<Blob|null>} sceneImageBlobs - Optional scene images for style reference
 * @param {string} modelId - 'gemini-2.5-flash-image' (cheap) or 'gemini-3-pro-image-preview' (expensive)
 * @returns {Promise<Blob>}
 */
export async function generateYouTubeThumbnail(scriptSummary, sceneImageBlobs = [], modelId = 'gemini-2.5-flash-image') {
  if (!ai) throw new Error('API key not configured');
  const prompt = `Create a single, eye-catching YouTube thumbnail image for this video reel. The thumbnail should be vertical (9:16) or square, bold and click-worthy. Base it on this content:\n\n${scriptSummary}\n\nMake it visually striking with clear focal point, suitable for YouTube/Shorts.`;
  const parts = [{ text: prompt }];
  const refBlobs = (sceneImageBlobs || []).filter(Boolean).slice(0, 2);
  for (const blob of refBlobs) {
    const base64 = await blobToBase64(blob);
    const mime = blob.type || 'image/png';
    parts.push({ inlineData: { mimeType: mime, data: base64 } });
  }
  const response = await ai.models.generateContent({
    model: modelId,
    contents: [{ parts }],
    config: { responseModalities: ['TEXT', 'IMAGE'] },
  });
  const outParts = response?.candidates?.[0]?.content?.parts || [];
  for (const part of outParts) {
    if (part.inlineData?.data) {
      const bytes = Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0));
      return new Blob([bytes], { type: part.inlineData.mimeType || 'image/png' });
    }
  }
  throw new Error('No image in response');
}

function pcmToWav(pcm, sampleRate = 24000, numChannels = 1) {
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  return new Blob([header, pcm], { type: 'audio/wav' });
}

