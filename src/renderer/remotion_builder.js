/**
 * FORGE — Remotion Project Builder v2
 * Fixed: Rspack disabled via env var (not just config) to work on ARM64/Termux AND GitHub Actions
 */

import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';
import { execSync } from 'child_process';
import { writeFileAtomic, copyFileAtomic, assertNonEmptyFile } from '../utils/fs_helpers.js';

export async function buildRemotionProject(
  blueprint, script, generatedScenes,
  captionsData, audioResult, waveformPath, tempDir
) {
  const projectDir = path.join(tempDir, 'remotion_project');

  log(`  Building Remotion project at: ${projectDir}`);

  const dirs = [
    projectDir,
    path.join(projectDir, 'src'),
    path.join(projectDir, 'src', 'scenes'),
    path.join(projectDir, 'public'),
  ];
  dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

  // Copy audio
  copyFileAtomic(audioResult.audioPath, path.join(projectDir, 'public', 'voiceover.mp3'));
  assertNonEmptyFile(path.join(projectDir, 'public', 'voiceover.mp3'), 'render voiceover');

  // Copy waveform
  if (waveformPath && fs.existsSync(waveformPath)) {
    copyFileAtomic(waveformPath, path.join(projectDir, 'public', 'waveform.json'));
    log(`  Waveform data copied`);
  }

  // Copy scene components
  for (const scene of generatedScenes) {
    assertNonEmptyFile(scene.codePath, `source Scene ${scene.scene_id}`);
    copyFileAtomic(scene.codePath, path.join(projectDir, 'src', 'scenes', `Scene${scene.scene_id}.js`));
  }

  // Copy caption overlay
  assertNonEmptyFile(captionsData.captionComponentPath, 'caption component source');
  copyFileAtomic(captionsData.captionComponentPath, path.join(projectDir, 'src', 'CaptionOverlay.js'));

  // Generate Root composition
  const rootContent = buildRootComposition(blueprint, script, generatedScenes, audioResult, waveformPath);
  writeFileAtomic(path.join(projectDir, 'src', 'Root.jsx'), rootContent);

  // Index entry
  writeFileAtomic(path.join(projectDir, 'src', 'index.js'), buildIndexFile());

  // package.json — CRITICAL: pin remotion to 4.0.229 which has stable webpack support
  writeFileAtomic(path.join(projectDir, 'package.json'), JSON.stringify(buildPackageJson(), null, 2));

  // remotion.config.js — webpack only, no rspack
  writeFileAtomic(path.join(projectDir, 'remotion.config.js'), buildRemotionConfig());

  // .npmrc — force legacy peer deps to avoid install failures
  writeFileAtomic(path.join(projectDir, '.npmrc'), 'legacy-peer-deps=true\n');

  // Install deps with RSPACK disabled via env var (belt AND suspenders)
  log(`  Installing Remotion dependencies...`);
  try {
    execSync('npm install --legacy-peer-deps', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 300000,
      env: {
        ...process.env,
        // Force webpack bundler — prevents rspack from loading ARM64 native bindings
        REMOTION_BUNDLER: 'webpack',
        // Suppress rspack's own detection
        DISABLE_RSPACK: '1',
      },
    });
    log(`  Dependencies installed`);
  } catch (err) {
    throw new Error(`REMOTION_DEPENDENCY_INSTALL_FAILED: ${err.message.slice(0, 500)}`);
  }

  // Preflight — with REMOTION_BUNDLER=webpack so rspack never loads
  log(`  Running Remotion preflight check...`);
  try {
    execSync('npx remotion compositions', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 300000,
      env: {
        ...process.env,
        REMOTION_BUNDLER: 'webpack',
        DISABLE_RSPACK: '1',
      },
    });
    log(`  Preflight: PASS`);
  } catch (err) {
    throw new Error(`REMOTION_PREFLIGHT_FAILED: ${err.message.slice(0, 1000)}`);
  }

  return projectDir;
}

function buildRootComposition(blueprint, script, generatedScenes, audioResult, waveformPath) {
  const fps = blueprint.style_manifest.canvas.fps;
  const width = blueprint.style_manifest.canvas.width;
  const height = blueprint.style_manifest.canvas.height;
  const totalFrames = blueprint.video_meta.total_duration_seconds * fps;
  const hasWaveform = waveformPath && fs.existsSync(waveformPath);

  const sceneImports = generatedScenes
    .map(s => `import Scene${s.scene_id} from './scenes/Scene${s.scene_id}.js';`)
    .join('\n');

  const sceneSequences = generatedScenes.map(s => {
    const startFrame = Math.round(s.spec.start_second * fps);
    const durationFrames = Math.round(s.spec.duration_seconds * fps);
    return `      <Sequence from={${startFrame}} durationInFrames={${durationFrames}} name="${s.spec.title}">
        <Scene${s.scene_id} waveform={waveform} />
      </Sequence>`;
  }).join('\n');

  return `import { Composition, Sequence, Audio, AbsoluteFill, staticFile } from 'remotion';
import { useState, useEffect } from 'react';
${sceneImports}
import CaptionOverlay from './CaptionOverlay.js';

function useWaveform() {
  const [waveform, setWaveform] = useState([]);
  useEffect(() => {
    ${hasWaveform ? `fetch(staticFile('waveform.json'))
      .then(r => r.json())
      .then(data => setWaveform(data))
      .catch(() => {});` : '// No waveform'}
  }, []);
  return waveform;
}

function ForgeVideo() {
  const waveform = useWaveform();
  return (
    <AbsoluteFill style={{ background: '${blueprint.style_manifest.palette.background}' }}>
${sceneSequences}
      <CaptionOverlay />
      <Audio src={staticFile('voiceover.mp3')} startFrom={0} />
    </AbsoluteFill>
  );
}

export function RemotionRoot() {
  return (
    <Composition
      id="ForgeVideo"
      component={ForgeVideo}
      durationInFrames={${totalFrames}}
      fps={${fps}}
      width={${width}}
      height={${height}}
    />
  );
}`;
}

function buildIndexFile() {
  return `import { registerRoot } from 'remotion';\nimport { RemotionRoot } from './Root.jsx';\nregisterRoot(RemotionRoot);`;
}

function buildPackageJson() {
  return {
    name: 'forge-render',
    version: '2.0.0',
    type: 'module',
    scripts: {
      render: 'remotion render ForgeVideo out/video.mp4',
    },
    dependencies: {
      remotion: '4.0.229',
      '@remotion/cli': '4.0.229',
      react: '^18.0.0',
      'react-dom': '^18.0.0',
      three: '^0.160.0',
    },
  };
}

function buildRemotionConfig() {
  return `import { Config } from '@remotion/cli/config';
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setConcurrency(2);`;
}
