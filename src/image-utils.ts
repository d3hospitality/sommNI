import { EvenAppBridge, ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';
import { encodeGrayscalePng } from './pngEncoder';

/**
 * Download image and convert to grayscale PNG bytes
 */
async function downloadImageAsGrayscalePng(source: string, targetWidth: number, targetHeight: number): Promise<Uint8Array> {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Could not get canvas context');
  }
  
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const data = imageData.data;
  
  const grayscaleData = new Uint8Array(targetWidth * targetHeight);
  
  for (let i = 0; i < targetWidth * targetHeight; i++) {
    const offset = i * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const avg = 0.299 * r + 0.587 * g + 0.114 * b;
    grayscaleData[i] = avg;
  }
  
  return encodeGrayscalePng(targetWidth, targetHeight, grayscaleData);
}

export async function pushLogoToGlasses(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  try {
    console.log("[sommNI] Loading split logo (200x200 total)...");
    
    // Top half (200x100)
    const topUrl = baseUrl + "assets/80x80ER_sommni_blkWht_top_200x100.png";
    console.log("[sommNI] Top URL:", topUrl);
    const topPngBytes = await downloadImageAsGrayscalePng(topUrl, 200, 100);
    console.log("[sommNI] Top PNG bytes:", topPngBytes.length);
    
    await bridge.updateImageRawData(new ImageRawDataUpdate({
      containerID: 3, 
      containerName: "logo-top", 
      imageData: Array.from(topPngBytes),
    }));
    
    // Bottom half (200x100)
    const bottomUrl = baseUrl + "assets/80x80ER_sommni_blkWht_bottom_200x100.png";
    console.log("[sommNI] Bottom URL:", bottomUrl);
    const bottomPngBytes = await downloadImageAsGrayscalePng(bottomUrl, 200, 100);
    console.log("[sommNI] Bottom PNG bytes:", bottomPngBytes.length);
    
    await bridge.updateImageRawData(new ImageRawDataUpdate({
      containerID: 4, 
      containerName: "logo-bottom", 
      imageData: Array.from(bottomPngBytes),
    }));
    
    console.log("[sommNI] Split logo pushed (200x200)!");
  } catch (err) {
    console.error("[sommNI] Logo error:", err);
    throw err;
  }
}

export async function imageUrlToBase64(url: string): Promise<string> {
  return url;
}
