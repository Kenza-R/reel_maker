import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  generateScenes,
  generateImage,
  generateTTS,
  fetchElevenLabsVoices,
  translateNarrationsBatch,
  generateYouTubeTitle as genYouTubeTitleAPI,
  generateYouTubeDescription as genYouTubeDescriptionAPI,
  generateYouTubeThumbnail as genYouTubeThumbnailAPI,
} from './services/gemini';
import { assembleVideo } from './services/ffmpegService';
import { createAssistantChat, sendAssistantMessage } from './services/apiService';
import MovieInput from './components/MovieInput';
import AnchorImages from './components/AnchorImages';
import AnimatedDots from './components/AnimatedDots';
import SceneEditor from './components/SceneEditor';
import VideoAssembly from './components/VideoAssembly';
import ChatAssistant from './components/ChatAssistant';
import YouTubeMetadata from './components/YouTubeMetadata';

function getProjectName() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `video_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

const initialScene = (item) => ({
  sceneNumber: item.sceneNumber ?? 0,
  description: item.description ?? '',
  narration: item.narration ?? '',
  narrationTranslated: item.narrationTranslated ?? '',
  imageBlob: null,
  audioBlob: null,
});

function App() {
  const [projectName, setProjectName] = useState(null);
  const [movieIdea, setMovieIdea] = useState('');
  const [anchorImages, setAnchorImages] = useState([null, null, null]);
  const [scenes, setScenes] = useState([]);
  const [imageModel, setImageModel] = useState('gemini-2.5-flash-image');
  const [voiceProvider, setVoiceProvider] = useState('gemini');
  const [voice, setVoice] = useState('Kore');
  const [elevenLabsVoices, setElevenLabsVoices] = useState([]);
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatingIndex, setGeneratingIndex] = useState(null);
  const [assembleProgress, setAssembleProgress] = useState(null);
  const [assembleStatus, setAssembleStatus] = useState({ currentScene: null, totalScenes: 0 });
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [outputBlob, setOutputBlob] = useState(null);
  const [error, setError] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const assistantChatRef = useRef(null);
  const [translationLanguage, setTranslationLanguage] = useState('English');
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [youtubeTitle, setYoutubeTitle] = useState('');
  const [youtubeDescription, setYoutubeDescription] = useState('');
  const [youtubeThumbnailBlob, setYoutubeThumbnailBlob] = useState(null);
  const [youtubeTitleLoading, setYoutubeTitleLoading] = useState(false);
  const [youtubeDescriptionLoading, setYoutubeDescriptionLoading] = useState(false);
  const [youtubeThumbnailLoading, setYoutubeThumbnailLoading] = useState(false);

  const handleGenerateScenes = useCallback(async () => {
    if (!movieIdea.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const generated = await generateScenes(movieIdea.trim());
      setScenes(generated.map(initialScene));
      setProjectName(getProjectName());
    } catch (err) {
      setError(err?.message || 'Failed to generate scenes');
    } finally {
      setLoading(false);
    }
  }, [movieIdea]);

  const handleUpdateScene = useCallback((index, field, value) => {
    setScenes((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  }, []);

  const handleGenerateImage = useCallback(async (index) => {
    const scene = scenes[index];
    if (!scene?.description) return;
    setGeneratingIndex(index);
    setError(null);
    try {
      const blob = await generateImage(scene.description, anchorImages, imageModel);
      setScenes((prev) =>
        prev.map((s, i) => (i === index ? { ...s, imageBlob: blob } : s))
      );
    } catch (err) {
      setError(err?.message || 'Failed to generate image');
    } finally {
      setGeneratingIndex(null);
    }
  }, [scenes, anchorImages, imageModel]);

  React.useEffect(() => {
    if (voiceProvider === 'elevenlabs') {
      fetchElevenLabsVoices()
        .then((voices) => {
          setElevenLabsVoices(voices);
          if (voices.length > 0 && !elevenLabsVoiceId) setElevenLabsVoiceId(voices[0].id);
        })
        .catch((err) => console.error('Error loading ElevenLabs voices:', err));
    }
  }, [voiceProvider]);

  const handleAnchorChange = useCallback((index, file) => {
    setAnchorImages((prev) => {
      const next = [...prev];
      next[index] = file;
      return next;
    });
  }, []);

  const handleGenerateAudio = useCallback(async (index) => {
    const scene = scenes[index];
    if (!scene?.narration) return;
    setGeneratingIndex(index);
    setError(null);
    try {
      const voiceToUse = voiceProvider === 'elevenlabs' ? elevenLabsVoiceId : voice;
      const blob = await generateTTS(scene.narration, voiceProvider, voiceToUse);
      setScenes((prev) =>
        prev.map((s, i) => (i === index ? { ...s, audioBlob: blob } : s))
      );
    } catch (err) {
      setError(err?.message || 'Failed to generate audio');
    } finally {
      setGeneratingIndex(null);
    }
  }, [scenes, voice, voiceProvider, elevenLabsVoiceId]);

  const handleAssistantScript = useCallback((args) => {
    if (!args?.scenes || !Array.isArray(args.scenes)) return;
    const normalized = args.scenes.map((s) => initialScene(s));
    setScenes(normalized);
    setProjectName(getProjectName());
  }, []);

  const scriptSummary = useMemo(() => {
    if (!scenes.length) return '';
    return scenes
      .map((s) => {
        let block = `Scene ${s.sceneNumber}:\nDescription: ${s.description || ''}\nNarration (original): ${s.narration || ''}`;
        if (s.narrationTranslated) block += `\nNarration (translated): ${s.narrationTranslated}`;
        return block;
      })
      .join('\n\n');
  }, [scenes]);

  const handleTranslateAllNarrations = useCallback(
    async () => {
      const narrations = scenes.map((s) => s.narration || '');
      if (!narrations.some(Boolean)) return;
      setTranslating(true);
      setError(null);
      try {
        const translated = await translateNarrationsBatch(narrations, translationLanguage);
        setScenes((prev) =>
          prev.map((s, i) => ({ ...s, narrationTranslated: translated[i] ?? '' }))
        );
        setShowTranslated(true);
      } catch (err) {
        setError(err?.message || 'Translation failed');
      } finally {
        setTranslating(false);
      }
    },
    [scenes, translationLanguage]
  );

  const sceneImageBlobs = useMemo(() => scenes.map((s) => s.imageBlob).filter(Boolean), [scenes]);

  const handleGenerateYouTubeTitle = useCallback(async () => {
    if (!scriptSummary.trim()) return;
    setYoutubeTitleLoading(true);
    setError(null);
    try {
      const title = await genYouTubeTitleAPI(scriptSummary, sceneImageBlobs);
      setYoutubeTitle(title);
    } catch (err) {
      setError(err?.message || 'Failed to generate title');
    } finally {
      setYoutubeTitleLoading(false);
    }
  }, [scriptSummary, sceneImageBlobs]);

  const handleGenerateYouTubeDescription = useCallback(async () => {
    if (!scriptSummary.trim()) return;
    setYoutubeDescriptionLoading(true);
    setError(null);
    try {
      const description = await genYouTubeDescriptionAPI(scriptSummary, sceneImageBlobs);
      setYoutubeDescription(description);
    } catch (err) {
      setError(err?.message || 'Failed to generate description');
    } finally {
      setYoutubeDescriptionLoading(false);
    }
  }, [scriptSummary, sceneImageBlobs]);

  const handleGenerateYouTubeThumbnail = useCallback(
    async (modelId) => {
      if (!scriptSummary.trim()) return;
      setYoutubeThumbnailLoading(true);
      setError(null);
      try {
        const blob = await genYouTubeThumbnailAPI(scriptSummary, sceneImageBlobs, modelId === 'expensive' ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image');
        setYoutubeThumbnailBlob(blob);
      } catch (err) {
        setError(err?.message || 'Failed to generate thumbnail');
      } finally {
        setYoutubeThumbnailLoading(false);
      }
    },
    [scriptSummary, sceneImageBlobs]
  );

  const handleChatTranslateNarrations = useCallback((args) => {
    if (Array.isArray(args.translatedNarrations) && args.translatedNarrations.length) {
      setScenes((prev) =>
        prev.map((s, i) => ({ ...s, narrationTranslated: args.translatedNarrations[i] ?? '' }))
      );
    } else if (Array.isArray(args.scenes) && args.scenes.length) {
      setScenes((prev) => {
        const next = prev.map((s) => ({ ...s, narrationTranslated: '' }));
        for (const s of args.scenes) {
          const idx = (s.sceneNumber || 0) - 1;
          if (idx >= 0 && idx < next.length) next[idx] = { ...next[idx], narrationTranslated: s.narration ?? '' };
        }
        return next;
      });
    } else return;
    setShowTranslated(true);
  }, []);

  const handleChatSend = useCallback(
    async (message) => {
      if (!message.trim()) return;
      setChatMessages((prev) => [...prev, { role: 'user', content: message }]);
      setChatLoading(true);
      setError(null);
      try {
        console.log('[AI Reel Maker] Sending message...');
        if (!assistantChatRef.current) {
          assistantChatRef.current = await createAssistantChat();
          console.log('[AI Reel Maker] Chat created');
        }
        const chat = assistantChatRef.current;
        if (!chat) {
          setChatMessages((prev) => [...prev, { role: 'assistant', content: 'API key not configured. Add REACT_APP_GEMINI_API_KEY to .env' }]);
          return;
        }
        setChatMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
        const onChunk = (text) => {
          setChatMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: text };
            return next;
          });
        };
        /* HW4 Task 1: scenes passed so script is loaded into chat context. Tasks 4-7: callbacks for translateNarrations, YouTube title/description/thumbnail */
        await sendAssistantMessage(
          chat,
          message,
          handleAssistantScript,
          anchorImages,
          onChunk,
          scenes,
          handleChatTranslateNarrations,
          setYoutubeTitle,
          setYoutubeDescription,
          (blob) => setYoutubeThumbnailBlob(blob)
        );
      } catch (err) {
        console.error('[AI Reel Maker] Error:', err);
        setChatMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant' && last?.content === '') {
            next[next.length - 1] = { ...last, content: err?.message || 'Failed to get response' };
          } else {
            next.push({ role: 'assistant', content: err?.message || 'Failed to get response' });
          }
          return next;
        });
        setError(err?.message || 'Assistant error');
      } finally {
        setChatLoading(false);
      }
    },
    [
      handleAssistantScript,
      anchorImages,
      scenes,
      handleChatTranslateNarrations,
    ]
  );

  const handleAssemble = useCallback(async () => {
    const ready = scenes.filter((s) => s.imageBlob && s.audioBlob);
    if (ready.length !== scenes.length) {
      setError('Generate images and audio for all scenes first');
      return;
    }
    setAssembleProgress(0);
    setAssembleStatus({ currentScene: null, totalScenes: scenes.length });
    setError(null);
    try {
      const blob = await assembleVideo(
        scenes,
        (p, status) => {
          setAssembleProgress(p);
          if (status) setAssembleStatus(status);
        },
        { includeSubtitles }
      );
      setOutputBlob(blob);
      setAssembleProgress(1);
      setAssembleStatus({ currentScene: null, totalScenes: scenes.length });
    } catch (err) {
      setError(err?.message || 'Failed to assemble video');
      setAssembleProgress(null);
      setAssembleStatus({ currentScene: null, totalScenes: 0 });
    }
  }, [scenes, includeSubtitles]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-slate-100">AI Reel Maker</h1>
          <p className="text-slate-400 mt-1">Create videos from ideas with AI-generated scenes, images, and narration</p>
        </header>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-200 text-sm">
            {error}
          </div>
        )}

        <section className="mb-8 p-6 rounded-xl bg-slate-800/50 border border-slate-700">
          <h2 className="text-lg font-semibold text-slate-200 mb-4">1. Movie Idea</h2>
          <MovieInput
            value={movieIdea}
            onChange={setMovieIdea}
            disabled={loading}
          />
          <div className="mt-6 pt-6 border-t border-slate-600">
            <h3 className="text-sm font-medium text-slate-300 mb-3">Anchor Images (optional)</h3>
            <AnchorImages anchorImages={anchorImages} onAnchorChange={handleAnchorChange} />
          </div>
          <div className="mt-6 pt-6 border-t border-slate-600">
            <button
              onClick={handleGenerateScenes}
              disabled={loading || !movieIdea.trim()}
              className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium transition-colors"
            >
              {loading ? <AnimatedDots prefix="Generating" /> : 'Generate Scenes'}
            </button>
          </div>
        </section>

        {scenes.length > 0 && (
          <>
            {/* HW4 Task 2: Translation Feature (UI) — dropdown, Translate button, Original/Translated toggle in SceneEditor below */}
            <section className="mb-8 p-6 rounded-xl bg-slate-800/50 border border-slate-700">
              <h2 className="text-lg font-semibold text-slate-200 mb-4">2. Edit Scenes</h2>
              <SceneEditor
                scenes={scenes}
                onUpdate={handleUpdateScene}
                imageModel={imageModel}
                onImageModelChange={setImageModel}
                voiceProvider={voiceProvider}
                onVoiceProviderChange={setVoiceProvider}
                voice={voice}
                onVoiceChange={setVoice}
                elevenLabsVoices={elevenLabsVoices}
                elevenLabsVoiceId={elevenLabsVoiceId}
                onElevenLabsVoiceChange={setElevenLabsVoiceId}
                onGenerateImage={handleGenerateImage}
                onGenerateAudio={handleGenerateAudio}
                generating={generatingIndex}
                translationLanguage={translationLanguage}
                onTranslationLanguageChange={setTranslationLanguage}
                showTranslated={showTranslated}
                onToggleShowTranslated={setShowTranslated}
                onTranslateAllNarrations={handleTranslateAllNarrations}
                translating={translating}
              />
            </section>

            {/* HW4 Task 3: YouTube Metadata Suite (UI) — Title & Description buttons (AI), Thumbnail dropdown + Generate Image */}
            <section className="mb-8 p-6 rounded-xl bg-slate-800/50 border border-slate-700">
              <h2 className="text-lg font-semibold text-slate-200 mb-4">YouTube Metadata</h2>
              <YouTubeMetadata
                scriptSummary={scriptSummary}
                sceneImageBlobs={scenes.map((s) => s.imageBlob).filter(Boolean)}
                onGenerateTitle={handleGenerateYouTubeTitle}
                onGenerateDescription={handleGenerateYouTubeDescription}
                onGenerateThumbnail={handleGenerateYouTubeThumbnail}
                title={youtubeTitle}
                description={youtubeDescription}
                thumbnailBlob={youtubeThumbnailBlob}
                titleLoading={youtubeTitleLoading}
                descriptionLoading={youtubeDescriptionLoading}
                thumbnailLoading={youtubeThumbnailLoading}
              />
            </section>

            <section className="mb-8 p-6 rounded-xl bg-slate-800/50 border border-slate-700">
              <h2 className="text-lg font-semibold text-slate-200 mb-4">3. Video Generation</h2>
              <VideoAssembly
                onAssemble={handleAssemble}
                assembleProgress={assembleProgress}
                assembleStatus={assembleStatus}
                includeSubtitles={includeSubtitles}
                onIncludeSubtitlesChange={setIncludeSubtitles}
                outputBlob={outputBlob}
                projectName={projectName}
              />
            </section>
          </>
        )}
      </div>

      {chatOpen ? (
        <ChatAssistant
          messages={chatMessages}
          onSend={handleChatSend}
          loading={chatLoading}
          onClose={() => setChatOpen(false)}
          isOpen={true}
        />
      ) : (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg flex items-center justify-center z-40 transition-colors"
          aria-label="Open assistant"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default App;
