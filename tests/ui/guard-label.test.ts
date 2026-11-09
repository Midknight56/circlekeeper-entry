import { expect, it } from "vitest";
import circleSource from "../../public/js/circle.js?raw";

it("the guard button names isolated checks, not attacks", () => {
  expect(circleSource).toContain('button("Run the three isolated checks"');
  expect(circleSource).not.toMatch(/button\("[^"]*attack/i);
});
