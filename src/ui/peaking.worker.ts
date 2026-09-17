import { fitPeakingDimensions, peakingPixels } from "./peaking";

let canvas: OffscreenCanvas | null = null;
self.onmessage = (event: MessageEvent<{ image: ImageBitmap; threshold: number }>) => {
  const { image, threshold } = event.data;
  try {
    const { width, height } = fitPeakingDimensions(image.width, image.height);
    canvas ??= new OffscreenCanvas(width, height);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No worker canvas context");
    context.drawImage(image, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height);
    data.data.set(peakingPixels(data.data, width, height, threshold));
    context.putImageData(data, 0, 0);
    const mask = canvas.transferToImageBitmap();
    self.postMessage({ mask }, { transfer: [mask] });
  } catch {
    self.postMessage({ error: true });
  } finally {
    image.close();
  }
};
