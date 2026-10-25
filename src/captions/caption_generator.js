/**
 * FORGE — Caption Generator
 * Converts word timestamps into SRT and a Remotion caption overlay component
 */

import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';
import { writeFileAtomic, assertNonEmptyFile } from '../utils/fs_helpers.js';

const WORDS_PER_CAPTION_LINE = 7;  // How many words per subtitle chunk
const MAX_LINE_CHARS = 45;         // Max characters per line before wrapping

/**
 * Generate captions from word timestamps
 */
export async function generateCaptions(script, wordTimestamps, styleManifest, outputDir, durationLimit = null) {
  log('  Building caption lines from word timestamps...');

  const captionLines = buildCaptionLines(wordTimestamps, script, durationLimit);
  const srtContent = generateSRT(captionLines);
  const srtPath = path.join(outputDir, 'captions.srt');
  writeFileAtomic(srtPath, srtContent);
  assertNonEmptyFile(srtPath, 'captions.srt');

  // Generate Remotion caption overlay component
  const captionComponentCode = generateCaptionComponent(captionLines, styleManifest);
  const captionComponentPath = path.join(outputDir, 'CaptionOverlay.js');
  writeFileAtomic(captionComponentPath, captionComponentCode);
  assertNonEmptyFile(captionComponentPath, 'CaptionOverlay.js');

  // Save caption data as JSON for pipeline use
  const captionDataPath = path.join(outputDir, 'captions.json');
  writeFileAtomic(captionDataPath, JSON.stringify(captionLines, null, 2));
  assertNonEmptyFile(captionDataPath, 'captions.json');

  log(`  Generated ${captionLines.length} caption lines`);
  log(`  SRT: ${srtPath}`);
  log(`  Component: ${captionComponentPath}`);

  return {
    srtPath,
    captionComponentPath,
    captionDataPath,
    captionLines,
    lineCount: captionLines.length,
  };
}

/**
 * Group word timestamps into displayable caption lines
 */
function buildCaptionLines(wordTimestamps, script, durationLimit = null) {
  const lines = [];
  let currentLine = [];
  let lineIndex = 0;

  // Get emphasis words from all script scenes
  const emphasisWords = new Set(
    script.scenes.flatMap(s => s.emphasis_words || []).map(w => w.toLowerCase())
  );

  for (let i = 0; i < wordTimestamps.length; i++) {
    const wordData = wordTimestamps[i];
    const isEmphasis = emphasisWords.has(wordData.word.toLowerCase().replace(/[.,!?]/g, ''));

    currentLine.push({
      word: wordData.word,
      start_time: wordData.start_time,
      end_time: wordData.end_time,
      is_emphasis: isEmphasis,
    });

    const lineText = currentLine.map(w => w.word).join(' ');
    const isEndOfSentence = /[.!?]$/.test(wordData.word);
    const isLineFull = currentLine.length >= WORDS_PER_CAPTION_LINE;
    const isLastWord = i === wordTimestamps.length - 1;

    if (isEndOfSentence || isLineFull || isLastWord) {
      if (currentLine.length > 0) {
        const lineStart = currentLine[0].start_time;
        const lineEnd = currentLine[currentLine.length - 1].end_time;

        lines.push({
          index: lineIndex,
          text: lineText,
          words: [...currentLine],
          start_time: lineStart,
          end_time: durationLimit ? Math.min(durationLimit, lineEnd + 0.1) : lineEnd + 0.1,
          has_emphasis: currentLine.some(w => w.is_emphasis),
        });

        lineIndex++;
        currentLine = [];
      }
    }
  }

  return lines;
}

/**
 * Generate SRT format subtitle file
 */
function generateSRT(captionLines) {
  return captionLines.map((line, index) => {
    const start = formatSRTTime(line.start_time);
    const end = formatSRTTime(line.end_time);
    return `${index + 1}\n${start} --> ${end}\n${line.text}\n`;
  }).join('\n');
}

function formatSRTTime(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

/**
 * Generate the Remotion caption overlay React component
 * This component reads captions.json and renders them frame-accurately
 */
function generateCaptionComponent(captionLines, styleManifest) {
  const captionJson = JSON.stringify(captionLines);
  const palette = styleManifest.palette;
  const typography = styleManifest.typography;
  const fps = styleManifest.canvas.fps;

  return `
/**
 * FORGE — Caption Overlay Component
 * Auto-generated. Renders synchronized captions on top of the video.
 */
import { useCurrentFrame, useVideoConfig } from 'remotion';

const CAPTIONS = ${captionJson};

export default function CaptionOverlay() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTimeSeconds = frame / fps;

  // Find the active caption for this frame
  const activeCaption = CAPTIONS.find(
    line => currentTimeSeconds >= line.start_time && currentTimeSeconds < line.end_time
  );

  if (!activeCaption) return null;

  const lineProgress = (currentTimeSeconds - activeCaption.start_time) /
    (activeCaption.end_time - activeCaption.start_time);

  // Fade in quickly, hold, fade out quickly
  let opacity = 1;
  const fadeFrames = 8;
  const framesElapsed = (currentTimeSeconds - activeCaption.start_time) * fps;
  const framesRemaining = (activeCaption.end_time - currentTimeSeconds) * fps;

  if (framesElapsed < fadeFrames) opacity = framesElapsed / fadeFrames;
  if (framesRemaining < fadeFrames) opacity = framesRemaining / fadeFrames;

  // Slide up slightly on enter
  const slideY = framesElapsed < fadeFrames
    ? (1 - framesElapsed / fadeFrames) * 12
    : 0;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 80,
        left: '50%',
        transform: \`translateX(-50%) translateY(\${slideY}px)\`,
        opacity,
        zIndex: 9999,
        maxWidth: 1400,
        textAlign: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'inline-block',
          background: 'rgba(0,0,0,0.72)',
          padding: '12px 28px',
          borderRadius: 4,
        }}
      >
        {activeCaption.words.map((wordData, i) => (
          <span
            key={i}
            style={{
              fontFamily: "'${typography.body_font}', sans-serif",
              fontSize: 38,
              fontWeight: wordData.is_emphasis ? 800 : ${typography.body_weight},
              color: wordData.is_emphasis ? '${palette.accent}' : '${palette.primary}',
              marginRight: 8,
              display: 'inline-block',
            }}
          >
            {wordData.word}
          </span>
        ))}
      </div>
    </div>
  );
}
`.trim();
}
