# Spec 02 — Read aloud

**Depends on:** Spec 01 (`Doc` / blocks).

## Problem
Reading on the glasses for a long time is tiring, and system voices sound robotic. I want natural-sounding narration that is free and offline, with the text following along so I can listen, glance, or both.

## Solution
A play button starts narration from the current position. Speech uses Kokoro if the phone can keep up, otherwise Piper, otherwise the phone's built-in voice, and all of them run on the device. The sentence being spoken is highlighted and kept on screen. Speed and voice can be changed, and the position is saved as narration moves.

## Decisions
- Engines are tried in order: Kokoro (kokoro-js, WebGPU, then WASM), Piper (piper-tts-web, WASM), then Web Speech API system voices.
- Engine choice: on first run (and on demand from settings) the app synthesizes a fixed ~10 s benchmark passage. Kokoro is chosen if its realtime factor (audio seconds ÷ compute seconds) is ≥ 1.3. Otherwise Piper is chosen if its factor is ≥ 1.3. Otherwise the system voice is used. The result is saved, and the user can override it.
- Narration runs one sentence at a time. Sentences are split with `Intl.Segmenter`, and the next 2 sentences are synthesized ahead so playback has no gaps.
- Model files are downloaded once after the user confirms (the size is shown), then cached for offline use.

## Non-goals
- Cloud voices or API keys. The engine interface allows them later, but none are built now.
- Playback with the screen locked or the app in the background.
- Exporting audio files.
- Highlighting individual words. Highlighting is per sentence only.
- Voice cloning or custom voices.

## Test seam
`Narrator` takes an injected `TtsEngine` interface (`synthesize(text): Promise<{ audio, durationMs }>`) and emits `sentencestart`, `sentenceend` and `ended` events with `{ blockId, sentenceIndex }`. The pure function `chooseEngine(benchResults): EngineId` is tested separately. Tests use a fake engine; the real engines are only checked manually on the device.

## Acceptance criteria
1. Using the fake engine, `Narrator.play(doc, fromBlockId)` emits `sentencestart` for every sentence from that block to the end, in order, and then `ended`.
2. While sentence N is playing, the fake engine has already been asked for sentences N+1 and N+2, and never for more than N+2.
3. `chooseEngine` returns `kokoro` for {kokoro: 1.5, piper: 4}, `piper` for {kokoro: 0.9, piper: 4}, and `system` for {kokoro: 0.5, piper: 1.0}. It returns `piper` when Kokoro failed to load.
4. If an engine throws mid-book, narration continues with the next engine in the order from the same sentence, and a one-line notice says which voice took over.
5. During playback the current sentence is highlighted. When it would fall below the visible area, the view scrolls to keep it in the middle third of the screen.
6. Changing speed (0.75×–2.0× in 0.25 steps) applies from the next sentence and is remembered across sessions.
7. Pausing, closing the app and reopening, then pressing play resumes from the start of the sentence that was paused.
8. Before the first model download, a dialog shows the engine name and download size. Declining uses the system voice.
9. In airplane mode after models are cached, Kokoro or Piper narration works.
10. On the user's phone with the glasses connected, 10 minutes of narration with the selected engine has no audible gaps longer than 1 s between sentences (checked by hand).
