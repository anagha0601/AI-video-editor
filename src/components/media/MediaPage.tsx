"use client";

import { MediaLibrary, useAssets } from "./MediaLibrary";

export function MediaPage() {
  const [assets, setAssets] = useAssets();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Media library</h1>
        <p className="text-sm text-muted-foreground">
          Your own clips and photos are used first when building a first cut. Tags from the file name (e.g. &ldquo;squat-gym-mirror.mp4&rdquo;) decide which scene they match.
        </p>
      </div>
      <MediaLibrary assets={assets} setAssets={setAssets} />
    </div>
  );
}
