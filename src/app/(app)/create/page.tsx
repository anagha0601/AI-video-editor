import { getCurrentUser } from "@/lib/auth";
import { aiProviderLabel } from "@/lib/ai";
import { stockEnabled } from "@/lib/media";
import { isPro } from "@/lib/plans";
import { Composer } from "@/components/Composer";

export const metadata = { title: "Create — ReelSmith" };

export default async function CreatePage() {
  const user = (await getCurrentUser())!;
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold sm:text-3xl">Create a video</h1>
      <p className="mb-6 mt-1 text-zinc-400">Describe an idea or paste a script. You&apos;ll get an editable, ready-to-post video in under a minute.</p>
      <Composer pro={isPro(user.plan)} aiProvider={aiProviderLabel()} stockEnabled={stockEnabled()} />
    </div>
  );
}
