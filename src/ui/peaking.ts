const PEAKING_PIXEL_BUDGET = 512 * 1024;

export function fitPeakingDimensions(sourceWidth: number, sourceHeight: number) {
  const width = Math.max(0, Math.floor(sourceWidth));
  const height = Math.max(0, Math.floor(sourceHeight));
  if (!width || !height) return { width, height };
  const scale = Math.min(1, Math.sqrt(PEAKING_PIXEL_BUDGET / (width * height)));
  return { width: Math.max(0, Math.floor(width * scale)), height: Math.max(0, Math.floor(height * scale)) };
}

export function peakingPixels(source: Uint8ClampedArray, width: number, height: number, threshold: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height * 4);
  const luminance = new Uint8Array(width * height);
  for (let pixel = 0; pixel < luminance.length; pixel++) {
    const index = pixel * 4;
    luminance[pixel] = (source[index] ?? 0) * 0.299 + (source[index + 1] ?? 0) * 0.587 + (source[index + 2] ?? 0) * 0.114;
  }
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const pixel = y * width + x;
      const horizontal = Math.abs((luminance[pixel - 1] ?? 0) - (luminance[pixel + 1] ?? 0));
      const vertical = Math.abs((luminance[pixel - width] ?? 0) - (luminance[pixel + width] ?? 0));
      if (Math.max(horizontal, vertical) > threshold) output.set([232, 88, 255, 230], pixel * 4);
    }
  }
  return output;
}
