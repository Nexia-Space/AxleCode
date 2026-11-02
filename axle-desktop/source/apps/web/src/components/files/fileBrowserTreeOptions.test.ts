import { FileTree, createFileTreeIconResolver, preloadFileTree } from "@pierre/trees";
import { describe, expect, it } from "vite-plus/test";

import { FILE_BROWSER_TREE_OPTIONS } from "./fileBrowserTreeOptions";

const PATHS = [
  "README.md",
  "docs/guide.md",
  "src/app.ts",
  "src/components/Button.tsx",
  "src/components/Input.tsx",
];

function directory(model: FileTree, path: string) {
  const item = model.getItem(path);
  if (!item?.isDirectory()) throw new Error(`Expected a directory at ${path}.`);
  return item;
}

describe("workspace file tree defaults", () => {
  it("keeps parent and nested folders closed when the initial paths arrive", () => {
    const model = new FileTree({ ...FILE_BROWSER_TREE_OPTIONS, paths: [] });
    try {
      model.resetPaths(PATHS);
      for (const path of ["docs/", "src/", "src/components/"]) {
        expect(directory(model, path).isExpanded()).toBe(false);
      }
    } finally {
      model.cleanUp();
    }
  });

  it("still lets users open and close folders explicitly", () => {
    const model = new FileTree({ ...FILE_BROWSER_TREE_OPTIONS, paths: PATHS });
    try {
      const folder = directory(model, "src/");
      folder.toggle();
      expect(folder.isExpanded()).toBe(true);
      folder.toggle();
      expect(folder.isExpanded()).toBe(false);
    } finally {
      model.cleanUp();
    }
  });

  it("renders collapsed folders without their children on first open", () => {
    const { shadowHtml } = preloadFileTree({
      ...FILE_BROWSER_TREE_OPTIONS,
      paths: PATHS,
      initialVisibleRowCount: 20,
    });
    expect(shadowHtml).toContain('aria-expanded="false"');
    expect(shadowHtml).toContain('href="#t3-file-icon-folder"');
    expect(shadowHtml).not.toContain('data-item-path="src/app.ts"');
    expect(shadowHtml).not.toContain('data-item-path="docs/guide.md"');
  });

  it("maps the disclosure slot to upright open/closed folder artwork", () => {
    const { icons, unsafeCSS } = FILE_BROWSER_TREE_OPTIONS;
    const resolver = createFileTreeIconResolver(icons);
    expect(resolver.resolveIcon("file-tree-icon-chevron")).toMatchObject({
      name: "t3-file-icon-folder",
      viewBox: "0 0 24 24",
    });
    expect(icons.spriteSheet).toContain('id="t3-file-icon-folder"');
    expect(icons.spriteSheet).toContain("--t3-folder-closed-display");
    expect(icons.spriteSheet).toContain("--t3-folder-open-display");
    expect(unsafeCSS).toContain("[aria-expanded='false']");
    expect(unsafeCSS).toContain("transform: none");
  });
});
