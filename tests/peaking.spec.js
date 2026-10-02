// @ts-check
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PeakingProcessor } from "../src/ui/peaking.ts";

function samplePixels() {
  let seed = 0x12345678;
  const pixels = new Uint8ClampedArray(17 * 13 * 4);
  for (let index = 0; index < pixels.length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[index] = seed >>> 24;
  }
  return pixels;
}

test("reused in-place peaking preserves the previous renderer's exact pixels", () => {
  // Captured from the pre-refactor renderer for this deterministic RGB/alpha input.
  const expected = [
    [0, "f3847346616a5ff53ba8d16b90ad9bcc2c5362ff87cae186510dc5bda5d51a86"],
    [32, "650caf97770d7014cb57384a5a5766f6cce25c0ec6b550f2630f948ade753dc4"],
    [72, "dae099108562acc7ce87e87cad5dc14cf5038a70356b244ff6c7e3598e2cec17"],
    [128, "f3e6a518f4a22615dca397806017132b9d94b0076d98cb14b28b1c17a2beb68d"],
    [254, "6ca83adefc47fc9ab71637c150b95b33083e61e507dff2ee5f2692aa27e1453e"],
    [255, "6ca83adefc47fc9ab71637c150b95b33083e61e507dff2ee5f2692aa27e1453e"],
  ];
  const processor = new PeakingProcessor();
  for (const [threshold, digest] of [...expected, ...expected.reverse()]) {
    const pixels = samplePixels();
    processor.apply(pixels, 17, 13, Number(threshold));
    expect(createHash("sha256").update(pixels).digest("hex")).toBe(digest);
  }
});

test("peaking clears old edges across flat frames, resized images and tiny frames", () => {
  const processor = new PeakingProcessor();
  for (const [width, height] of [[17, 13], [13, 17], [3, 3], [1, 5], [5, 1], [0, 0], [17, 13]]) {
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    processor.apply(pixels, width, height, 0);
    expect(pixels.every((value) => value === 0)).toBe(true);
  }
  const pixels = samplePixels();
  processor.apply(pixels, 17, 13, 72);
  expect(createHash("sha256").update(pixels).digest("hex")).toBe(
    "dae099108562acc7ce87e87cad5dc14cf5038a70356b244ff6c7e3598e2cec17",
  );
});
