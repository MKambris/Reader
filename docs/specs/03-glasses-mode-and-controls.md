# Spec 03 — Glasses mode & controls

**Depends on:** Specs 01, 02.

## Problem
With the RayNeo Air 3 on, the phone screen is what I see, so I'm tapping blind, and normal reader layouts are hard to read in the glasses. I need a display tuned for the glasses and controls that work without looking at the phone.

## Solution
A full-screen Glasses Mode with large high-contrast text and only the current passage visible. Playback can be controlled three ways, all mapped to one small command set: earbud or Bluetooth media buttons, big tap and swipe zones anywhere on the phone, and push-to-talk voice commands.

## Decisions
- Glasses Mode: light text on a pure black background (black looks transparent in these glasses), adjustable font size (default 28 px), a narrow text column, and no visible chrome. It uses the Fullscreen API and a Wake Lock while open.
- Commands: `playPause`, `nextSentence`, `prevSentence`, `nextParagraph`, `prevParagraph`, `nextChapter`, `prevChapter`, `faster`, `slower`, `exitGlassesMode`.
- Media buttons go through the Media Session API: play/pause → `playPause`, next track → `nextSentence`, previous track → `prevSentence`.
- Tap zones: single tap anywhere → `playPause`. Swipe left/right → next/previous sentence. Swipe up/down → next/previous paragraph. Long press for 1 s → push-to-talk.
- Voice commands are push-to-talk only (long press), using Web Speech recognition. Narration pauses while listening and resumes afterwards. Recognized phrases are listed in the Acceptance criteria below.

## Non-goals
- Always-on listening or a wake word.
- Using the glasses' own buttons or sensors (head tracking, IMU).
- Controls on the lock screen or notification shade beyond what the Media Session API gives while the app is in front.
- Offline voice commands. Chrome's recognition may use Google's servers, and the app says so the first time it's used.
- Side-by-side 3D modes.

## Test seam
`dispatch(command: Command)` is the only entry point into playback and navigation. Input adapters (`mediaSession`, `gestures`, `voice`) are pure mappings from their raw events or phrases to a `Command` and are each unit-tested. `dispatch` is tested against the Narrator with the fake engine from Spec 02.

## Acceptance criteria
1. The gesture adapter maps tap → `playPause`, swipe-left → `nextSentence`, swipe-right → `prevSentence`, swipe-up → `nextParagraph`, swipe-down → `prevParagraph`, and a 1 s hold → push-to-talk start. A drag under 30 px counts as a tap.
2. The voice adapter maps "pause", "stop", "play", "resume", "next", "back", "next chapter", "previous chapter", "faster", "slower" and "exit" (case-insensitive, extra words ignored) to their commands, and returns `null` for anything else. A `null` result plays a short error tone and changes nothing.
3. The media-session adapter maps play, pause, nexttrack and previoustrack as described in the Decisions section.
4. Calling `dispatch(nextChapter)` during playback moves narration to the first sentence of the next section, and the highlight follows.
5. Entering Glasses Mode makes the app fullscreen on a #000000 background and holds a screen wake lock. Exiting releases both.
6. In Glasses Mode, everything except the current and next paragraph has opacity 0 or is not rendered.
7. Font size in Glasses Mode can be changed (20–48 px) from a settings sheet, and the setting is kept.
8. Pressing play/pause on Bluetooth earbuds while in Glasses Mode toggles narration (checked by hand on the device).
9. Long-pressing, saying "next chapter" and releasing pauses narration, jumps to the next chapter and resumes it (checked by hand on the device with earbuds).
10. With the glasses connected, text at the default size reads comfortably in the glasses without moving the head (the user signs this off by hand).
