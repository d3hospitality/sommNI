import { EvenAppBridge, ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';

export async function pushLogoToGlasses(bridge: EvenAppBridge, logoBase64: string): Promise<void> {
  const data: ImageRawDataUpdate = { 
    containerID: 4, 
    containerName: "logo", 
    imageData: logoBase64
  };
  const result = await bridge.updateImageRawData(data);
  console.log("[sommNI] Logo update:", result);
}

export async function imageUrlToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
