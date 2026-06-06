import { expect, test } from "bun:test";
import { getWorkspaceLayout, getWorkspaceLayoutMode } from "./layout";

test("classifies workspace layout from terminal dimensions", () => {
  expect(getWorkspaceLayoutMode({ height: 35, width: 140 })).toBe("wide");
  expect(getWorkspaceLayoutMode({ height: 25, width: 90 })).toBe("medium");
  expect(getWorkspaceLayoutMode({ height: 20, width: 90 })).toBe("compact");
  expect(getWorkspaceLayoutMode({ height: 35, width: 70 })).toBe("compact");
});

test("compact layout gives detail tasks the whole screen", () => {
  expect(
    getWorkspaceLayout({ hasDetailTask: true, height: 20, width: 70 }),
  ).toEqual({ detailTakesOver: true, mode: "compact" });
  expect(
    getWorkspaceLayout({ hasDetailTask: true, height: 35, width: 140 }),
  ).toEqual({ detailTakesOver: false, mode: "wide" });
  expect(
    getWorkspaceLayout({ hasDetailTask: false, height: 20, width: 70 }),
  ).toEqual({ detailTakesOver: false, mode: "compact" });
});
