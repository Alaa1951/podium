import { expect, it } from "vitest";
import { iosTopFallback, nativeStatusInset } from "./mobile-safe-area";

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

it("uses measured iOS status bar heights instead of guessed phone dimensions", () => {
  expect(nativeStatusInset({visible:true,overlays:true,height:59})).toBe(59);
  expect(nativeStatusInset({visible:true,overlays:true,height:20})).toBe(20);
  expect(iosTopFallback({nativeIOS:true,measuredTop:0,portrait:true,tablet:false,nativeMeasurementKnown:true})).toBe(0);
});
it("does not reserve a second native margin or space for a hidden status bar", () => {
  expect(nativeStatusInset({visible:true,overlays:false,height:59})).toBe(0);
  expect(nativeStatusInset({visible:false,overlays:true,height:59})).toBe(0);
  expect(nativeStatusInset({visible:true,overlays:false,height:0})).toBe(0);
});
it("keeps the legacy fallback when the native shell cannot return a measurement", () => {
  expect(nativeStatusInset({visible:true,overlays:true,height:NaN})).toBeUndefined();
  expect(nativeStatusInset({visible:true,overlays:true,height:-1})).toBeUndefined();
  expect(nativeStatusInset({visible:true,overlays:true,height:0})).toBeUndefined();
});
