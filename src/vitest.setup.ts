import { vi } from "vitest";

// `../shared/tabs` computes `TABOR_SIDE_PANEL_URL` via `chrome.runtime.getURL`
// at module load time, so `chrome` must exist as a global before any test
// file's imports are resolved—`vi.stubGlobal` inside a `beforeEach` runs too
// late for that. Individual test files still call `vi.stubGlobal("chrome",
// ...)` themselves for the parts of the API they actually exercise.
vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => path } });
