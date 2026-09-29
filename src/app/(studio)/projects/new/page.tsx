import { NewProject } from "@/components/dashboard/NewProject";
import { hasGemini } from "@/server/gemini";
import { hasPexels } from "@/server/pexels";

export const metadata = { title: "New video · ReelSmith" };

export default function Page() {
  return <NewProject gemini={hasGemini()} pexels={hasPexels()} />;
}
