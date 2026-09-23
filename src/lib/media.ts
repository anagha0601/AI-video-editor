import "server-only";

type PexelsPhoto = { src: { portrait: string; landscape: string; large: string }; photographer: string };

export const MEDIA_HOSTS = ["images.pexels.com"];

// Finds a stock photo for a scene. Returns null when no key is configured
// (the renderer then draws an animated gradient instead).
export async function findStockImage(query: string, aspect: string) {
  const key = process.env.PEXELS_API_KEY;
  if (!key || !query) return null;
  const orientation = aspect === "16:9" ? "landscape" : aspect === "1:1" ? "square" : "portrait";
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=${orientation}`,
      { headers: { Authorization: key }, cache: "force-cache" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { photos: PexelsPhoto[] };
    const photo = data.photos[Math.floor(Math.random() * Math.min(3, data.photos.length))];
    if (!photo) return null;
    const src = aspect === "16:9" ? photo.src.landscape : aspect === "1:1" ? photo.src.large : photo.src.portrait;
    // Proxied so the canvas renderer can read pixels without CORS tainting.
    return { url: `/api/media?u=${encodeURIComponent(src)}`, credit: `Photo: ${photo.photographer} / Pexels` };
  } catch {
    return null;
  }
}

export function stockEnabled() {
  return Boolean(process.env.PEXELS_API_KEY);
}

export function voiceEnabled() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}
