import { expect, it } from "vitest";
import { iosTopFallback } from "./mobile-safe-area";

it("reserves notch space in an old installed iPhone shell with a missing inset", () => {
  expect(iosTopFallback({nativeIOS:true,measuredTop:0,portrait:true,tablet:false})).toBe(64);
});
it("trusts a real system inset instead of adding a second safe area", () => {
  expect(iosTopFallback({nativeIOS:true,measuredTop:59,portrait:true,tablet:false})).toBe(0);
});
it("does not add phone notch padding in the browser, Android or landscape", () => {
  expect(iosTopFallback({nativeIOS:false,measuredTop:0,portrait:true,tablet:false})).toBe(0);
  expect(iosTopFallback({nativeIOS:true,measuredTop:0,portrait:false,tablet:false})).toBe(0);
  expect(iosTopFallback({nativeIOS:true,measuredTop:0,portrait:true,tablet:true})).toBe(24);
});
