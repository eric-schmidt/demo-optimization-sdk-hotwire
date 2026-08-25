// Provide mapping based on name in Contentful and point to JSX code responsible
// for rendering the content. Uses plain static imports so this map is usable
// from both Server Components (published path) and Client Components (draft /
// Live Preview path) without pulling in client-only helpers like next/dynamic.
import { Hero } from "@/src/components/Hero";
import { Duplex } from "@/src/components/Duplex";

// TODO: Add additional mapping for more component types.
export const ComponentMap = {
  hero: Hero,
  duplex: Duplex,
};
