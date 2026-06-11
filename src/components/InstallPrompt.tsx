// PWA install banner. Listens for beforeinstallprompt, shows a tasteful chip
// at the bottom of the screen. Dismissable; respects user choice via localStorage.

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

const KEY = "monad.installDismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(KEY) === "1") return;
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    if (isStandalone) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!visible || !evt) return null;

  const install = async () => {
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice.outcome === "dismissed") localStorage.setItem(KEY, "1");
    setVisible(false);
  };
  const dismiss = () => {
    localStorage.setItem(KEY, "1");
    setVisible(false);
  };

  return (
    <div className="fixed bottom-20 md:bottom-4 inset-x-3 z-40 mx-auto max-w-sm rounded-2xl bg-background/95 backdrop-blur-md border border-white/10 p-3 flex items-center gap-3"
      style={{ boxShadow: "0 20px 50px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)" }}
    >
      <div className="size-10 rounded-xl grid place-items-center text-primary"
        style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.20), rgba(168,85,247,0.08))" }}
      >
        <Download className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">Install trench.meme</p>
        <p className="text-[11px] text-muted-foreground">Faster, full-screen, with home-screen icon.</p>
      </div>
      <button onClick={install} className="h-8 px-3 rounded-full lit-purple text-xs font-bold">Install</button>
      <button onClick={dismiss} className="size-7 grid place-items-center rounded-full bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
