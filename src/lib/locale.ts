// The single locale this demo renders.
//
// Extracted from views/Layout so server-side libraries can read it without
// importing a JSX module. Layout re-exports it, so existing imports still work.
//
// One concrete locale is also a hard requirement of the Optimization SDK: a
// `withAllLocales` / `locale=*` payload carries locale-keyed field maps that the
// entry resolver cannot walk, so every entry would silently fall back to baseline.
export const LOCALE = "en-US";
