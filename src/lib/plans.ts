export const FREE_MONTHLY_VIDEOS = 3;

export const PLANS = {
  free: {
    name: "Free",
    price: "$0",
    features: [`${FREE_MONTHLY_VIDEOS} videos / month`, "9:16 vertical format", "Watermarked exports", "Browser voice preview"],
  },
  pro: {
    name: "Pro",
    price: "$19",
    features: ["Unlimited videos", "All formats (9:16, 1:1, 16:9)", "No watermark", "AI voiceover in exports", "Priority generation"],
  },
} as const;

export function isPro(plan: string | null | undefined) {
  return plan === "pro";
}
