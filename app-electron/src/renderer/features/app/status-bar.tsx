import { ModeToggle } from "@/components/mode-toggle";
import { Badge } from "@/components/ui/badge";

type AppStatusBarProps = {
  engineStatus: string;
  engineStateClass: string;
  isSearchingFunctions: boolean;
  transientMessage: string;
};

export function AppStatusBar({
  engineStatus,
  engineStateClass,
  isSearchingFunctions,
  transientMessage,
}: AppStatusBarProps) {
  return (
    <footer className="status-bar">
      <Badge className={`engine-state ${engineStateClass}`} variant="outline">
        Engine {engineStatus}
      </Badge>
      {isSearchingFunctions ? (
        <span aria-live="polite" className="status-searching">
          Searching
          <span aria-hidden="true" className="status-searching-dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </span>
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
