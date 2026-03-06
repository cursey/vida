import { ModeToggle } from "@/components/mode-toggle";
import { Badge } from "@/components/ui/badge";

type AppStatusBarProps = {
  engineStatus: string;
  engineStateClass: string;
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
    <span aria-live="polite" className="status-searching">
      {normalizedText}
      <span aria-hidden="true" className="status-searching-dots">
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </span>
  );
}

export function AppStatusBar({
  engineStatus,
  engineStateClass,
  isSearchingFunctions,
  isBuildingGraph,
  analysisMessage,
  transientMessage,
}: AppStatusBarProps) {
  return (
    <footer className="status-bar">
      <Badge className={`engine-state ${engineStateClass}`} variant="outline">
        Engine {engineStatus}
      </Badge>
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
        <span aria-live="polite" className="status-message">
          {transientMessage}
        </span>
      ) : null}
      <div className="status-spacer" />
      <ModeToggle />
    </footer>
  );
}
