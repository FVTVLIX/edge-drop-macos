import type { ClipboardItem } from "../store";
import { getFileKind } from "./fileType";

export type TypeFilter = "all" | "text" | "links" | "images" | "files";

function basename(path: string): string {
  return path.split("/").pop() || path;
}

export function isImageItem(item: ClipboardItem): boolean {
  if (item.data.kind === "image" || item.data.kind === "image-collection") return true;
  if (item.data.kind !== "files" || item.data.paths.length === 0) return false;
  return item.data.paths.every((path, index) =>
    !item.entries?.[index]?.isDirectory &&
    (item.entries?.[index]?.isImage || getFileKind(path).kind === "image")
  );
}

export function matchesType(item: ClipboardItem, filter: TypeFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "text": return item.data.kind === "text" && !item.data.isUrl;
    case "links": return item.data.kind === "text" && item.data.isUrl;
    case "images": return isImageItem(item);
    case "files": return item.data.kind === "files" && !isImageItem(item);
  }
}

export function matchesSearch(item: ClipboardItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (item.data.kind === "text") return item.data.text.toLowerCase().includes(needle);
  if (item.data.kind === "files") {
    return item.data.paths.some((path, index) =>
      (item.entries?.[index]?.name || basename(path)).toLowerCase().includes(needle)
    );
  }
  return false;
}

export function filterItems(
  items: ClipboardItem[],
  query: string,
  filter: TypeFilter,
): ClipboardItem[] {
  return items.filter((item) => matchesType(item, filter) && matchesSearch(item, query));
}
