import { describe, expect, it } from "vitest";
import { MODEL_ID, NEURONS_PER_INPUT_TOKEN, NEURONS_PER_OUTPUT_TOKEN, RETIRING_MODEL_IDS } from "../../src/caps";

describe("Workers AI model configuration", () => {
  it("does not use a model listed as retiring", () => {
    expect(RETIRING_MODEL_IDS).toContain("@cf/qwen/qwen3-30b-a3b-fp8");
    expect(RETIRING_MODEL_IDS).not.toContain(MODEL_ID);
  });

  it("uses Granite 4.0 H Micro neuron prices", () => {
    expect(NEURONS_PER_INPUT_TOKEN).toBe(1542 / 1_000_000);
    expect(NEURONS_PER_OUTPUT_TOKEN).toBe(10158 / 1_000_000);
  });
});
