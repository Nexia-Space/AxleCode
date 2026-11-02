import type { FileTreeOptions } from "@pierre/trees";

import { T3_PIERRE_ICONS } from "~/pierre-icons";

const TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
  }
  button[data-type='item'] { border-radius: 5px; }

  /* Replace the rotating disclosure arrow with a stateful folder icon. Sticky
     ancestor rows have no aria-expanded attribute and represent open folders. */
  [data-item-type='folder'] [data-icon-name='file-tree-icon-chevron'] {
    --t3-folder-closed-display: none;
    --t3-folder-open-display: inline;
    transform: none;
  }
  [data-item-type='folder'][aria-expanded='false'] [data-icon-name='file-tree-icon-chevron'] {
    --t3-folder-closed-display: inline;
    --t3-folder-open-display: none;
  }
`;

export const FILE_BROWSER_TREE_OPTIONS = {
  density: "compact",
  fileTreeSearchMode: "hide-non-matches",
  flattenEmptyDirectories: true,
  initialExpansion: "closed",
  icons: T3_PIERRE_ICONS,
  unsafeCSS: TREE_UNSAFE_CSS,
} satisfies Pick<
  FileTreeOptions,
  | "density"
  | "fileTreeSearchMode"
  | "flattenEmptyDirectories"
  | "initialExpansion"
  | "icons"
  | "unsafeCSS"
>;
