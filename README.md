# FORGE v2 — Research + Audio-Reactive AI Video Engine

FORGE generates full AI code-rendered videos: every frame is programmatically
animated Remotion/React code. No stock assets. No templates. Pure generative
visuals driven by research-grounded narration and audio-reactive waveform data.

## Architecture

```
Stage 0  Research        DuckDuckGo · Wikipedia · arXiv · HackerNews
Stage 1  Blueprint       NVIDIA Kimi-K3 — scene plan + style manifest
Stage 2  Script          NVIDIA Kimi-K3 — narration + word emphasis
Stage 3  Voiceover       ElevenLabs — MP3 + word-level timestamps
Stage 4  Waveform        Audio analysis for reactive animation
Stage 5  Scene Code      NVIDIA Kimi-K3 — Remotion React component per scene
Stage 6  Captions        Sync'd SRT from word timestamps
Stage 7  Remotion Build  Compose scenes + audio + captions
Stage 8  Render          FFmpeg via @remotion/cli
Stage 9  Quality Check   Post-render validation
```

## Setup

```bash
cp .env.example .env
# Edit .env — add any FORGE_API_XX_KEY values you actually have and your ELEVENLABS_API_KEY

npm install
```

## Run

```bash
node src/pipeline.js "How CRISPR gene editing works" geometric_sharp 60
```

**Arguments**
- `"prompt"` — topic or question
- `style` — `particle_cosmos | geometric_sharp | fluid_organic | data_manifold | abstract_kinetic | cinematic_dark | typographic_storm`
- `duration_seconds` — target video length (default 60)

**npm test shortcuts**
```bash
npm run test:science    # CRISPR, geometric, 60s
npm run test:space      # Black holes, particle, 60s
npm run test:history    # Roman Empire, cinematic, 90s
npm run test:economy    # Inflation, data_manifold, 60s
npm run test:current    # AI rise, typographic, 60s
```

## Local deterministic checks (no API keys needed)

```bash
npm run test:local
```

Checks required files, import/export contracts, Node syntax, the AI output
firewall, schema normalization, API-pool routing, and safety token budgets.
No real provider request is made.

## Environment Variables

The automatic brain pool supports up to 20 API slots. Empty slots are ignored.
You can configure 1, 5, 10, 16, 20, or any number in between.

| Variable | Default | Description |
|---|---:|---|
| `FORGE_API_SLOTS` | `20` | Maximum number of slots scanned |
| `FORGE_GLOBAL_CONCURRENCY` | `0` | `0` = sum configured concurrency, capped at 16 |
| `FORGE_SCENE_WORKERS` | `16` | Maximum parallel scene workers |
| `FORGE_STRUCTURED_ATTEMPTS` | `2` | Bounded semantic-generation attempts |
| `FORGE_API_RETRY_ATTEMPTS` | `2` | Bounded transport failover attempts; failed slots are excluded |
| `FORGE_AUDIO_DURATION_TOLERANCE` | `0.05` | Allowed TTS duration error as a fraction of target |
| `FORGE_AUDIO_DURATION_ATTEMPTS` | `3` | Maximum duration-aware script/TTS regeneration cycles |
| `FORGE_API_TIMEOUT_MS` | `1800000` | Per-request timeout |
| `FORGE_REASONING_POLICY` | `auto` | Automatic reasoning selection |
| `FORGE_API_XX_KEY` | empty | Provider credential for slot XX |
| `FORGE_API_XX_PROVIDER` | `nvidia` | Provider name |
| `FORGE_API_XX_BASE` | provider default | OpenAI-compatible API base |
| `FORGE_API_XX_MODEL` | provider default | Model used by slot XX |
| `FORGE_API_XX_CONCURRENCY` | `1` | Concurrent requests allowed on slot XX |
| `FORGE_API_XX_WEIGHT` | `1` | Routing preference weight |
| `FORGE_API_XX_REASONING_LEVELS` | provider default | Supported `low,medium,high,max` levels |
| `FORGE_API_XX_ENABLED` | `true` | Enable/disable slot XX |
| `ELEVENLABS_API_KEY` | empty | Voiceover provider key |

Legacy `NVIDIA_API_KEY` + `NVIDIA_MODEL` are still accepted as a one-slot
fallback when `FORGE_API_01_KEY` is empty.

## Provider

- **Brain**: NVIDIA NIM — `https://integrate.api.nvidia.com/v1/chat/completions`
- **Model**: `moonshotai/kimi-k3` (2.8T MoE, 1M context, always-on reasoning)
- **Audio**: ElevenLabs with word-level timestamps

## Requirements

- Node.js ≥ 18
- ffmpeg in PATH (for rendering)
- Runs on Android/Termux — Node.js 18+ and ffmpeg are required

## Automatic API Pool / Parallel Brain

FORGE now supports up to 20 independent API slots. You can fill only the slots
you actually have; empty slots are ignored automatically.

Example:

```env
FORGE_API_SLOTS=20
FORGE_GLOBAL_CONCURRENCY=0
FORGE_SCENE_WORKERS=16
FORGE_STRUCTURED_ATTEMPTS=2
FORGE_REASONING_POLICY=auto

FORGE_API_01_KEY=...
FORGE_API_01_PROVIDER=nvidia
FORGE_API_01_BASE=https://integrate.api.nvidia.com/v1
FORGE_API_01_MODEL=moonshotai/kimi-k3
FORGE_API_01_CONCURRENCY=1
FORGE_API_01_REASONING_LEVELS=low,high,max

FORGE_API_02_KEY=...
FORGE_API_02_PROVIDER=groq
FORGE_API_02_MODEL=...
FORGE_API_02_CONCURRENCY=1
FORGE_API_02_REASONING_LEVELS=low,medium,high
```

### What FORGE decides automatically

- Which configured API should receive each job.
- How many scene workers can run at once.
- Reasoning level by task: validation is cheap; planning is stronger; complex
  scene work gets more reasoning.
- The closest supported reasoning level when a provider does not expose every
  level. NVIDIA Kimi-K3, for example, is configured for `low,high,max`.
- A provider/model that rejects `reasoning_effort` is retried without that
  parameter.
- Temporary provider failures are moved away from by the load/reliability
  scorer.
- Scene generation is parallel; generated scenes are sorted back into timeline
  order before rendering.
- Structured model retries are bounded. There is no unbounded retry storm.

### Reliability model

AI output is never treated as trusted code. Scene output passes deterministic
checks before entering the renderer. The Remotion build and final ffprobe
quality check remain the final gates. A failed scene is retried in a controlled
way rather than corrupting the complete job.

The old single `NVIDIA_API_KEY` configuration remains supported as a one-slot
fallback, so existing installations do not have to migrate immediately.



## AI Output Firewall

Every model response is treated as untrusted input. Before output can reach
the renderer, FORGE rejects:

- Markdown/code fences and conversational preambles
- special/internal model tokens such as `<|...|>`
- malformed JSON or anything outside the single-object contract
- control-character corruption and degenerate repeated output
- missing/invalid scene-code structure
- forbidden runtime APIs in generated scene code
- unbalanced delimiters and other deterministic scene-code failures

Failed output is discarded and the bounded recovery/router path chooses another
available API when possible. The system never silently cleans up arbitrary AI
chatter and then renders it.
