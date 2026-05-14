---
name: butler-voice
description: Automatic voice post-processing for a deeper, butler-like voice.
---

# Butler Voice Pipeline

This skill enables a voice processing pipeline using ffmpeg to add a butler-like deep tone and reverb to generated audio.

## Pipeline Steps:
1. Generate base audio via TTS (ElevenLabs).
2. Process with ffmpeg:
   - Pitch shifting (lowering)
   - Reverb/Echo effects
   - Equalization

## Adjustment Guideline
- Default settings (asetrate=44100*0.9) can be too heavy.
- Start with a lighter pitch shift (asetrate=44100*0.99) for a subtle butler-like effect.
- Only increase depth if the user explicitly requests a deeper voice.

## Usage
When the TTS tool generates an audio file, immediately run:
`ffmpeg -i input.mp3 -af "asetrate=44100*0.9,aresample=44100,aecho=0.8:0.9:100:0.3" output.mp3`
