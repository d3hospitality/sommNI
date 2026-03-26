// ═══════════════════════════════════════════════════════════════════
// sommNI TG — Voice Search
// Push-to-talk (3 seconds) via Even Realities mic
// Transcription via Vercel proxy → fuzzy wine matching
// From sommNI 2 + sommNI Android scoring algorithm
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { WINES, Wine, WineType } from './constants';
import { log } from './ui';

const TRANSCRIBE_API = "https://sommni-api.vercel.app/api/transcribe";

let audioChunks: Uint8Array[] = [];
let isListening = false;
let listenTimeout: ReturnType<typeof setTimeout> | null = null;

export interface WineWithNav extends Wine {
  type: WineType;
  country: string;
}

type WineMatchCallback = (wine: WineWithNav) => void;
let onWineMatchCallback: WineMatchCallback | null = null;
let bridgeRef: EvenAppBridge | null = null;

// ═══ FLATTEN ALL WINES ═══
function getAllWines(): WineWithNav[] {
  const all: WineWithNav[] = [];
  for (const [type, countries] of Object.entries(WINES)) {
    for (const [country, wines] of Object.entries(countries)) {
      for (const wine of wines) {
        all.push({ ...wine, type: type as WineType, country });
      }
    }
  }
  return all;
}

// ═══ INIT ═══
export function initVoice(
  bridge: EvenAppBridge,
  _openaiApiKey: string,
  callback: WineMatchCallback
): void {
  bridgeRef = bridge;
  onWineMatchCallback = callback;
  log("[VOICE] Ready (double-tap to search)", "success");
}

// ═══ START LISTENING ═══
export async function startListening(): Promise<void> {
  if (!bridgeRef || isListening) return;
  isListening = true;
  audioChunks = [];

  await bridgeRef.audioControl(true);
  log("[VOICE] Listening... (3 sec)");

  listenTimeout = setTimeout(async () => {
    await stopAndProcess();
  }, 3000);
}

// ═══ HANDLE AUDIO CHUNK ═══
export function handleAudioEvent(pcm: Uint8Array): void {
  if (!isListening) return;
  audioChunks.push(new Uint8Array(pcm));
}

// ═══ STOP & PROCESS ═══
async function stopAndProcess(): Promise<void> {
  if (!bridgeRef) return;
  await bridgeRef.audioControl(false);
  isListening = false;

  if (listenTimeout) { clearTimeout(listenTimeout); listenTimeout = null; }
  if (audioChunks.length === 0) { log("[VOICE] No audio", "error"); return; }

  const totalLength = audioChunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of audioChunks) { combined.set(chunk, offset); offset += chunk.length; }
  audioChunks = [];

  log(`[VOICE] Processing ${totalLength} bytes...`);
  const base64 = uint8ArrayToBase64(combined);

  try {
    log("[VOICE] Transcribing...");
    const resp = await fetch(TRANSCRIBE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64 }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Transcription failed');
    }

    const result = await resp.json();
    const transcript = result.text || '';
    log(`[VOICE] Heard: "${transcript}"`);

    const wine = findWineByVoice(transcript);
    if (wine && onWineMatchCallback) {
      log(`[VOICE] Match: ${wine.name}`, "success");
      onWineMatchCallback(wine);
    } else {
      log("[VOICE] No match found", "error");
    }
  } catch (err) {
    log(`[VOICE] Error: ${err}`, "error");
  }
}

// ═══ FUZZY WINE MATCH (from sommNI Android scoring) ═══
function findWineByVoice(transcript: string): WineWithNav | null {
  const text = transcript.toLowerCase();
  const allWines = getAllWines();

  // Extract type filter from speech
  let typeFilter: WineType | null = null;
  if (text.includes("red")) typeFilter = "Red";
  else if (text.includes("white")) typeFilter = "White";
  else if (text.includes("sparkling")) typeFilter = "Sparkling";
  else if (text.includes("rose") || text.includes("rosé")) typeFilter = "Rose";
  else if (text.includes("orange")) typeFilter = "Orange";
  else if (text.includes("dessert") || text.includes("sweet")) typeFilter = "Dessert";

  const pool = typeFilter ? allWines.filter(w => w.type === typeFilter) : allWines;

  let best: WineWithNav | null = null;
  let bestScore = 0;

  for (const wine of pool) {
    let score = 0;
    const wineName = wine.name.toLowerCase();

    // Exact name match
    if (text.includes(wineName)) score += 20;

    // Word-level matching
    const wineWords = wineName.split(/[\s\-–—"'()]+/).filter(w => w.length > 2);
    const textWords = text.split(/[\s\-–—"'()]+/).filter(w => w.length > 2);

    for (const ww of wineWords) {
      if (text.includes(ww)) score += 5;
      for (const tw of textWords) {
        if (ww.includes(tw) || tw.includes(ww)) score += 3;
      }
    }

    // Grape match
    const grapeWords = wine.grape.toLowerCase().split(/[\s\/\-()]+/).filter(w => w.length > 3);
    for (const g of grapeWords) {
      if (text.includes(g)) score += 4;
    }

    // Country match
    if (text.includes(wine.country.toLowerCase())) score += 3;

    if (score > bestScore) { bestScore = score; best = wine; }
  }

  log(`[VOICE] Best: ${best?.name} (score: ${bestScore})`);
  return bestScore >= 5 ? best : null;
}

// ═══ UTIL ═══
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
