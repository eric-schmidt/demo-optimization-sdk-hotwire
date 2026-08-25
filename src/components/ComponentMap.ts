import { Duplex } from "./Duplex";
import { Hero } from "./Hero";
import type { BlockProps } from "../lib/types";

// Keyed on entry.sys.contentType.sys.id.
// TODO: Add additional mapping for more component types.
export const ComponentMap: Record<
  string,
  ((props: BlockProps) => unknown) | undefined
> = {
  hero: Hero,
  duplex: Duplex,
};
