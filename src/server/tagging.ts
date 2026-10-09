import "server-only";

/** Searchable tags from a file name (e.g. "squat-pr-gym.mp4" -> squat, gym). */
export function nameTags(name: string) {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !/^(img|vid|dsc|mov|pxl|mvimg|screenshot|video|photo|image)$/.test(w));
}
