import { createFileRoute } from "@tanstack/react-router";
import { PairsTerminal } from "@/components/PairsTerminal";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export const Route = createFileRoute("/meme")({ component: MemePage });

function MemePage() {
  // Terminal home gets just the bare site name — no leading label.
  useDocumentTitle(null);
  return <PairsTerminal />;
}
