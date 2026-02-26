// ══════════════════════════════════════════════════════════════════════════
// VOICE COMMANDS - Push-to-talk (3 seconds)
// ══════════════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { WINES, Wine, WineType } from './constants';
import { log } from './ui';

// Vercel API endpoint
const TRANSCRIBE_API = "https://sommni-api.vercel.app/api/transcribe";

// Audio buffer
let audioChunks: Uint8Array[] = [];
let isListening = false;
let listenTimeout: ReturnType<typeof setTimeout> | null = null;

// Extended wine with navigation info
export interface WineWithNav extends Wine {
  type: WineType;
  country: string;
}

// Callbacks and refs
type WineMatchCallback = (wine: WineWithNav) => void;
let onWineMatchCallback: WineMatchCallback | null = null;
let bridgeRef: EvenAppBridge | null = null;

// ══════════════════════════════════════════════════════════════════════════
// GET ALL WINES (flattened with type/country)
// ══════════════════════════════════════════════════════════════════════════
function getAllWines(): WineWithNav[] {
  const all: WineWithNav[] = [];
  
  for (const [type, countries] of Object.entries(WINES)) {
    for (const [country, wines] of Object.entries(countries)) {
      for (const wine of wines) {
        all.push({
          ...wine,
          type: type as WineType,
          country: country,
        });
      }
    }
  }
  
  return all;
}

// ══════════════════════════════════════════════════════════════════════════
// INITIALIZE VOICE (no API key needed - Vercel handles it)
// ══════════════════════════════════════════════════════════════════════════
export function initVoice(
  bridge: EvenAppBridge,
  _openaiApiKey: string, // kept for compatibility, not used
  callback: WineMatchCallback
): void {
  bridgeRef = bridge;
  onWineMatchCallback = callback;
  
  log("[VOICE] Ready (double-tap to search)", "success");
}

// ══════════════════════════════════════════════════════════════════════════
// START LISTENING (3 seconds)
// ══════════════════════════════════════════════════════════════════════════
export async function startListening(): Promise<void> {
  if (!bridgeRef || isListening) return;
  
  isListening = true;
  audioChunks = [];
  
  // Open mic
  await bridgeRef.audioControl(true);
  log("[VOICE] 🎤 Listening... (3 sec)");
  
  // Stop after 3 seconds
  listenTimeout = setTimeout(async () => {
    await stopAndProcess();
  }, 3000);
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLE AUDIO EVENT
// ══════════════════════════════════════════════════════════════════════════
export function handleAudioEvent(pcm: Uint8Array): void {
  if (!isListening) return;
  audioChunks.push(new Uint8Array(pcm));
}

// ══════════════════════════════════════════════════════════════════════════
// STOP AND PROCESS
// ══════════════════════════════════════════════════════════════════════════
async function stopAndProcess(): Promise<void> {
  if (!bridgeRef) return;
  
  await bridgeRef.audioControl(false);
  isListening = false;
  
  if (listenTimeout) {
    clearTimeout(listenTimeout);
    listenTimeout = null;
  }
  
  if (audioChunks.length === 0) {
    log("[VOICE] No audio captured", "error");
    return;
  }
  
  // Combine chunks
  const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combinedAudio = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of audioChunks) {
    combinedAudio.set(chunk, offset);
    offset += chunk.length;
  }
  audioChunks = [];
  
  log(`[VOICE] Processing ${totalLength} bytes...`);
  
  // Convert to base64
  const base64Audio = uint8ArrayToBase64(combinedAudio);
  
  try {
    log("[VOICE] Transcribing...");
    
    const response = await fetch(TRANSCRIBE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audio: base64Audio }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Transcription failed');
    }
    
    const result = await response.json();
    const transcript = result.text || '';
    
    log(`[VOICE] Heard: "${transcript}"`);
    
    const wine = findWineByVoice(transcript);
    if (wine && onWineMatchCallback) {
      log(`[VOICE] → ${wine.name}`, "success");
      onWineMatchCallback(wine);
    } else {
      log("[VOICE] No wine found", "error");
    }
  } catch (err) {
    log(`[VOICE] Error: ${err}`, "error");
  }
}

// ══════════════════════════════════════════════════════════════════════════
// FIND WINE BY VOICE
// ══════════════════════════════════════════════════════════════════════════
function findWineByVoice(transcript: string): WineWithNav | null {
  const text = transcript.toLowerCase();
  
  const allWines = getAllWines();
  
  // Type filter
  let typeFilter: WineType | null = null;
  if (text.includes("red")) typeFilter = "Red";
  else if (text.includes("white")) typeFilter = "White";
  else if (text.includes("sparkling")) typeFilter = "Sparkling";
  else if (text.includes("rose") || text.includes("rosé")) typeFilter = "Rose";
  else if (text.includes("orange")) typeFilter = "Orange";
  else if (text.includes("dessert") || text.includes("sweet")) typeFilter = "Dessert";
  
  const winesToSearch = typeFilter 
    ? allWines.filter(w => w.type === typeFilter)
    : allWines;
  
  let bestMatch: WineWithNav | null = null;
  let bestScore = 0;
  
  for (const wine of winesToSearch) {
    let score = 0;
    const wineName = wine.name.toLowerCase();
    
    if (text.includes(wineName)) score += 20;
    
    const wineWords = wineName.split(/[\s\-–—"'()]+/).filter(w => w.length > 2);
    const textWords = text.split(/[\s\-–—"'()]+/).filter(w => w.length > 2);
    
    for (const wineWord of wineWords) {
      if (text.includes(wineWord)) score += 5;
      for (const textWord of textWords) {
        if (wineWord.includes(textWord) || textWord.includes(wineWord)) score += 3;
      }
    }
    
    const grapeWords = wine.grape.toLowerCase().split(/[\s\/\-()]+/).filter(w => w.length > 3);
    for (const grape of grapeWords) {
      if (text.includes(grape)) score += 4;
    }
    
    if (text.includes(wine.country.toLowerCase())) score += 3;
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = wine;
    }
  }
  
  log(`[VOICE] Best: ${bestMatch?.name} (score: ${bestScore})`);
  
  return bestScore >= 5 ? bestMatch : null;
}

// ══════════════════════════════════════════════════════════════════════════
// UINT8ARRAY TO BASE64
// ══════════════════════════════════════════════════════════════════════════
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}