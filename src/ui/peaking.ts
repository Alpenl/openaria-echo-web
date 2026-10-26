const PEAKING_PIXEL_BUDGET = 512 * 1024;

export function fitPeakingDimensions(sourceWidth: number, sourceHeight: number) {
  const width = Math.max(0, Math.floor(sourceWidth));
  const height = Math.max(0, Math.floor(sourceHeight));
  if (!width || !height) return { width, height };
  const scale = Math.min(1, Math.sqrt(PEAKING_PIXEL_BUDGET / (width * height)));
  return { width: Math.max(0, Math.floor(width * scale)), height: Math.max(0, Math.floor(height * scale)) };
}

/** One bounded scratch buffer per renderer; replaces ImageData pixels in place. */
export class PeakingProcessor {
  private luminance = new Uint8Array(0);

  apply(pixels: Uint8ClampedArray, width: number, height: number, threshold: number): void {
    const count = width * height;
    if (this.luminance.length !== count) this.luminance = new Uint8Array(count);
    const luminance = this.luminance;
    // Finish reading the source before overwriting its storage with the mask.
    for (let pixel = 0; pixel < count; pixel++) {
      const index = pixel * 4;
      luminance[pixel] = (pixels[index] ?? 0) * 0.299 + (pixels[index + 1] ?? 0) * 0.587 + (pixels[index + 2] ?? 0) * 0.114;
    }
    pixels.fill(0);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const pixel = y * width + x;
        const horizontal = Math.abs((luminance[pixel - 1] ?? 0) - (luminance[pixel + 1] ?? 0));
        const vertical = Math.abs((luminance[pixel - width] ?? 0) - (luminance[pixel + width] ?? 0));
        if (Math.max(horizontal, vertical) > threshold) {
          const index = pixel * 4;
          pixels[index] = 232;
          pixels[index + 1] = 88;
          pixels[index + 2] = 255;
          pixels[index + 3] = 230;
        }
      }
    }
  }
}
