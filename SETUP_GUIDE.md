# FORGE v2 — Setup Guide

## 1. Termux prerequisites

```bash
pkg update
pkg install nodejs-lts ffmpeg -y
node --version
npm --version
ffmpeg -version
```

FORGE requires Node.js 18+.

## 2. Enter the project

If you extracted the supplied ZIP as `~/forge/FORGE_FINAL`:

```bash
cd ~/forge/FORGE_FINAL/forge_nvidia
```

This is the directory containing `package.json`.

## 3. Install dependencies

```bash
npm install
```

If installation finishes successfully, verify the project before using API
quota:

```bash
npm run test:local
```

## 4. Configure environment

```bash
cp .env.example .env
nano .env
```

Fill only the API slots you actually have. Empty slots are ignored.

Example for one NVIDIA slot:

```env
FORGE_API_01_KEY=YOUR_REAL_NVIDIA_KEY
FORGE_API_01_PROVIDER=nvidia
FORGE_API_01_MODEL=moonshotai/kimi-k3
FORGE_API_01_CONCURRENCY=1
FORGE_API_01_REASONING_LEVELS=low,high,max
FORGE_API_01_ENABLED=true

ELEVENLABS_API_KEY=YOUR_REAL_ELEVENLABS_KEY
```

You can fill any number of slots from `01` through `20`. FORGE automatically
routes requests based on task, supported reasoning level, capacity and recent
failures. It does not permanently assign one API to one pipeline stage.

## 5. Run FORGE

```bash
node src/pipeline.js "How CRISPR gene editing works" geometric_sharp 30
```

The duration is in seconds.

## 6. Pipeline behavior

1. Research
2. Blueprint
3. Script
4. Voiceover
5. Waveform analysis
6. Parallel scene generation
7. Captions
8. Remotion build
9. Render
10. Quality check

Independent scene generation runs through the shared API pool. The router
selects the best currently available slot instead of pinning one API to one
stage.

## 7. AI output firewall

Model output is untrusted. Before generated scene code can reach Remotion,
FORGE performs deterministic checks for:

- malformed JSON
- Markdown/code fences
- assistant chatter
- special/internal tokens such as `<|...|>`
- repetitive/degenerate output
- missing default export
- missing Remotion import
- forbidden runtime APIs
- unbalanced delimiters
- oversized/corrupt scene code

Invalid output is discarded. Only bounded recovery attempts are allowed.

## 8. Legacy compatibility

The old:

```env
NVIDIA_API_KEY=...
NVIDIA_MODEL=moonshotai/kimi-k3
```

configuration remains supported as a one-slot fallback if
`FORGE_API_01_KEY` is empty.

Never commit `.env`.
