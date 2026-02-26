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
  console.log("[sommNI] Fetching logo from:", url);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch logo: ${response.status} ${response.statusText}`);
  }
  
  const blob = await response.blob();
  console.log("[sommNI] Logo blob size:", blob.size);
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      console.log("[sommNI] Logo base64 length:", base64.length);
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
