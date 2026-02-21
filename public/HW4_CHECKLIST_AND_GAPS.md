# HW4 Checklist + Current Gaps (Step 0)

## Requirements vs current state

| # | Requirement | Status | Gap |
|---|-------------|--------|-----|
| 1 | Smart chat context: full script (all scenes) in chat messages | Partial | buildScriptContext exists and is injected; does NOT include "Narration (translated)" per scene. Format should be "CURRENT SCRIPT:" + scene blocks with original + translated. |
| 2 | Translation UI: language dropdown (all continents), Translate button, Original/Translated toggle | Done | Uses separate `translatedNarrations` state; plan wants `narrationTranslated` on each scene. Prop names can align (translationLanguage, onTranslateAllNarrations, translating). |
| 3 | YouTube metadata UI: title/description buttons + display; thumbnail cheap/expensive + image | Done | scriptContext for YouTube could include translated narrations; already uses script + images. |
| 4 | Chat tool translateNarrations defined in code + chat_prompt.txt | Done | Implemented. Handler writes to translated state; plan also wants writing to scene.narrationTranslated. |
| 5 | Chat tool generateYouTubeTitle | Done | Implemented. |
| 6 | Chat tool generateYouTubeDescription | Done | Implemented. |
| 7 | Chat tool generateYouTubeThumbnail | Done | Implemented. Optional: accept prompt + modelTier from model. |
| — | chat_prompt: do NOT always call generateMovieScript | Gap | Prompt currently pushes script generation; must allow improvement Q&A without calling tool. |

## Implementation plan (minimal files)

1. **Scene model (App.js):** Add `narrationTranslated` to initialScene; handleUpdateScene already supports any field; save translation results to scenes[].narrationTranslated; optionally keep translatedNarrations derived or remove.
2. **SceneEditor.js:** Display scene.narration vs scene.narrationTranslated from toggle; accept translationLanguage, onTranslationLanguageChange, onTranslateAllNarrations, translating; edit updates narration or narrationTranslated.
3. **gemini.js:** Add or keep translateNarrationsBatch (same as translateNarrations); strict JSON array, preserve TTS tags.
4. **App.js:** handleTranslateAllNarrations → translateNarrationsBatch → set scenes[i].narrationTranslated; setShowTranslated(true). State: translationLanguage.
5. **apiService.js:** buildScriptContext include "Narration (translated): ..." when present; prefix "CURRENT SCRIPT:\n...\n\nUSER MESSAGE:\n".
6. **apiService.js:** generateYouTubeThumbnail tool accept optional prompt + modelTier; handler use args.prompt or build from script; callbacks already update UI.
7. **public/chat_prompt.txt:** Rewrite: list all 5 tools with WHEN to call; do not always call generateMovieScript; improvement requests = respond with text, only call tools when user asks (translate, YouTube, or apply changes).
