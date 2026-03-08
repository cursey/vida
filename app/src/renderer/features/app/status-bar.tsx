import { ModeToggle } from "@/components/mode-toggle";

type AppStatusBarProps = {
  isSearchingFunctions: boolean;
  isBuildingGraph: boolean;
  analysisMessage: string;
  transientMessage: string;
};

function StatusWithAnimatedDots({ text }: { text: string }) {
  const normalizedText = text
    .trim()
    .replace(/(?:\.{3}|…)$/, "")
    .trimEnd();

  return (
    <span
      aria-live="polite"
      className="inline-flex h-5 items-center whitespace-nowrap text-[11px] leading-none text-muted-foreground"
    >
      {normalizedText}
      <span aria-hidden="true" className="inline-flex min-w-3 justify-start">
        <span className="animate-[status-searching-dot-pulse_900ms_ease-in-out_infinite] opacity-25">
          .
        </span>
        <span className="animate-[status-searching-dot-pulse_900ms_ease-in-out_infinite] opacity-25 [animation-delay:120ms]">
          .
        </span>
        <span className="animate-[status-searching-dot-pulse_900ms_ease-in-out_infinite] opacity-25 [animation-delay:240ms]">
          .
        </span>
      </span>
    </span>
  );
}

export function AppStatusBar({
  isSearchingFunctions,
  isBuildingGraph,
  analysisMessage,
  transientMessage,
}: AppStatusBarProps) {
  return (
    <footer className="-mx-2 -mb-2 flex h-[30px] min-h-[30px] items-center justify-start gap-2 border-t border-border bg-background px-2">
      {isBuildingGraph ? (
        <StatusWithAnimatedDots text="Building graph" />
      ) : null}
      {isSearchingFunctions ? (
        <StatusWithAnimatedDots text="Searching" />
      ) : null}
      {analysisMessage ? (
        <StatusWithAnimatedDots text={analysisMessage} />
      ) : null}
      {transientMessage ? (
        <span
          aria-live="polite"
          className="max-w-[min(60vw,700px)] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-none text-foreground/72"
        >
          {transientMessage}
        </span>
      ) : null}
      <div className="flex-1" />
      <ModeToggle />
    </footer>
  );
}
