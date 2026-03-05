import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  FunctionSeed,
  LinearInstruction,
  SectionInfo,
  StopReason,
} from "../shared/protocol";

type ResizeSide = "left" | "right";

type DragState = {
  side: ResizeSide;
  startX: number;
  startLeft: number;
  startRight: number;
};

type DisassemblyColumn = "address" | "bytes" | "instruction" | "operands";

type ColumnDragState = {
  key: DisassemblyColumn;
  startX: number;
  startWidth: number;
};

const MIN_PANEL_WIDTH = 220;
const MAX_PANEL_WIDTH = 420;
const MIN_CENTER_WIDTH = 420;
const SPLITTER_WIDTH = 8;
const MAX_COLUMN_WIDTH = 1200;
const MIN_COLUMN_WIDTHS: Record<DisassemblyColumn, number> = {
  address: 90,
  bytes: 120,
  instruction: 120,
  operands: 140,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function App() {
  const [engineStatus, setEngineStatus] = useState<string>("checking");
  const [modulePath, setModulePath] = useState<string>("");
  const [moduleId, setModuleId] = useState<string>("");
  const [entryRva, setEntryRva] = useState<string>("");
  const [goToAddress, setGoToAddress] = useState<string>("");
  const [functions, setFunctions] = useState<FunctionSeed[]>([]);
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [instructions, setInstructions] = useState<LinearInstruction[]>([]);
  const [stopReason, setStopReason] = useState<StopReason | "">("");
  const [errorText, setErrorText] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isColumnResizing, setIsColumnResizing] = useState(false);
  const [panelWidths, setPanelWidths] = useState({ left: 268, right: 300 });
  const [disassemblyColumnWidths, setDisassemblyColumnWidths] = useState({
    address: 110,
    bytes: 180,
    instruction: 160,
    operands: 320,
  });

  const layoutRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const columnDragStateRef = useRef<ColumnDragState | null>(null);

  useEffect(() => {
    void window.electronAPI
      .pingEngine()
      .then((value) => {
        setEngineStatus(`online (${value.version})`);
      })
      .catch((error: unknown) => {
        setEngineStatus("unavailable");
        setErrorText(
          error instanceof Error ? error.message : "Failed to ping engine",
        );
      });
  }, []);

  const engineStateClass = useMemo(() => {
    if (engineStatus.startsWith("online")) {
      return "state-online";
    }

    if (engineStatus === "checking") {
      return "state-checking";
    }

    return "state-offline";
  }, [engineStatus]);

  const layoutStyle = useMemo(
    () =>
      ({
        "--left-panel-width": `${panelWidths.left}px`,
        "--right-panel-width": `${panelWidths.right}px`,
      }) as CSSProperties,
    [panelWidths.left, panelWidths.right],
  );

  const disassemblyTableStyle = useMemo(
    () =>
      ({
        "--col-address-width": `${disassemblyColumnWidths.address}px`,
        "--col-bytes-width": `${disassemblyColumnWidths.bytes}px`,
        "--col-instruction-width": `${disassemblyColumnWidths.instruction}px`,
        "--col-operands-width": `${disassemblyColumnWidths.operands}px`,
      }) as CSSProperties,
    [disassemblyColumnWidths],
  );

  useEffect(() => {
    function clampPanelWidths() {
      if (!layoutRef.current || window.innerWidth <= 1250) {
        return;
      }

      const layoutWidth = layoutRef.current.clientWidth;
      const maxLeft = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(
          MAX_PANEL_WIDTH,
          layoutWidth -
            panelWidths.right -
            MIN_CENTER_WIDTH -
            SPLITTER_WIDTH * 2,
        ),
      );
      const clampedLeft = clamp(panelWidths.left, MIN_PANEL_WIDTH, maxLeft);

      const maxRight = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(
          MAX_PANEL_WIDTH,
          layoutWidth - clampedLeft - MIN_CENTER_WIDTH - SPLITTER_WIDTH * 2,
        ),
      );
      const clampedRight = clamp(panelWidths.right, MIN_PANEL_WIDTH, maxRight);

      if (
        clampedLeft !== panelWidths.left ||
        clampedRight !== panelWidths.right
      ) {
        setPanelWidths({ left: clampedLeft, right: clampedRight });
      }
    }

    window.addEventListener("resize", clampPanelWidths);
    clampPanelWidths();

    return () => {
      window.removeEventListener("resize", clampPanelWidths);
    };
  }, [panelWidths.left, panelWidths.right]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    function handlePointerMove(event: globalThis.PointerEvent) {
      const drag = dragStateRef.current;
      const layout = layoutRef.current;

      if (!drag || !layout) {
        return;
      }

      const dx = event.clientX - drag.startX;
      const layoutWidth = layout.clientWidth;

      if (drag.side === "left") {
        const maxLeft = Math.max(
          MIN_PANEL_WIDTH,
          Math.min(
            MAX_PANEL_WIDTH,
            layoutWidth -
              drag.startRight -
              MIN_CENTER_WIDTH -
              SPLITTER_WIDTH * 2,
          ),
        );

        setPanelWidths((prev) => ({
          ...prev,
          left: clamp(drag.startLeft + dx, MIN_PANEL_WIDTH, maxLeft),
        }));
        return;
      }

      const maxRight = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(
          MAX_PANEL_WIDTH,
          layoutWidth - drag.startLeft - MIN_CENTER_WIDTH - SPLITTER_WIDTH * 2,
        ),
      );

      setPanelWidths((prev) => ({
        ...prev,
        right: clamp(drag.startRight - dx, MIN_PANEL_WIDTH, maxRight),
      }));
    }

    function stopResizing() {
      dragStateRef.current = null;
      setIsResizing(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!isColumnResizing) {
      return;
    }

    function handlePointerMove(event: globalThis.PointerEvent) {
      const drag = columnDragStateRef.current;
      if (!drag) {
        return;
      }

      const dx = event.clientX - drag.startX;
      const nextWidth = clamp(
        drag.startWidth + dx,
        MIN_COLUMN_WIDTHS[drag.key],
        MAX_COLUMN_WIDTH,
      );

      setDisassemblyColumnWidths((prev) => ({
        ...prev,
        [drag.key]: nextWidth,
      }));
    }

    function stopColumnResizing() {
      columnDragStateRef.current = null;
      setIsColumnResizing(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopColumnResizing);
    window.addEventListener("pointercancel", stopColumnResizing);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopColumnResizing);
      window.removeEventListener("pointercancel", stopColumnResizing);
    };
  }, [isColumnResizing]);

  function startResizing(
    side: ResizeSide,
    event: PointerEvent<HTMLDivElement>,
  ) {
    if (window.innerWidth <= 1250) {
      return;
    }

    event.preventDefault();
    dragStateRef.current = {
      side,
      startX: event.clientX,
      startLeft: panelWidths.left,
      startRight: panelWidths.right,
    };
    setIsResizing(true);
  }

  function startColumnResizing(
    key: DisassemblyColumn,
    event: PointerEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    columnDragStateRef.current = {
      key,
      startX: event.clientX,
      startWidth: disassemblyColumnWidths[key],
    };
    setIsColumnResizing(true);
  }

  async function openExecutable() {
    setErrorText("");
    const chosenPath = await window.electronAPI.pickExecutable();
    if (!chosenPath) {
      return;
    }

    setIsLoading(true);

    try {
      const opened = await window.electronAPI.openModule(chosenPath);
      const info = await window.electronAPI.getModuleInfo(opened.moduleId);
      const listed = await window.electronAPI.listFunctions(opened.moduleId);
      const initialStart = listed.functions[0]?.start ?? opened.entryRva;
      const linear = await window.electronAPI.disassembleLinear({
        moduleId: opened.moduleId,
        start: initialStart,
        maxInstructions: 250,
      });

      setModulePath(chosenPath);
      setModuleId(opened.moduleId);
      setEntryRva(opened.entryRva);
      setSections(info.sections);
      setFunctions(listed.functions);
      setInstructions(linear.instructions);
      setStopReason(linear.stopReason);
      setGoToAddress(initialStart);
    } catch (error: unknown) {
      setErrorText(
        error instanceof Error ? error.message : "Failed to open executable",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function disassembleAt(start: string) {
    if (!moduleId) {
      return;
    }

    setIsLoading(true);
    setErrorText("");

    try {
      const linear = await window.electronAPI.disassembleLinear({
        moduleId,
        start,
        maxInstructions: 250,
      });
      setInstructions(linear.instructions);
      setStopReason(linear.stopReason);
      setGoToAddress(start);
    } catch (error: unknown) {
      setErrorText(
        error instanceof Error ? error.message : "Disassembly failed",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleGoToSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void disassembleAt(goToAddress);
  }

  return (
    <div
      className={`shell ${isResizing || isColumnResizing ? "is-resizing" : ""}`}
    >
      <header className="transport-strip">
        <div className="transport-left">
          <div className="app-badge" aria-label="Application identity">
            ELECTRON DISASSEMBLER
          </div>
          <button
            className="transport-button"
            onClick={openExecutable}
            type="button"
            disabled={isLoading}
          >
            Open EXE
          </button>
        </div>

        <form className="transport-center" onSubmit={handleGoToSubmit}>
          <label htmlFor="goto-address">Go To</label>
          <input
            id="goto-address"
            value={goToAddress}
            onChange={(event) => setGoToAddress(event.target.value)}
            placeholder="0x140001000"
          />
          <button type="submit" disabled={!moduleId || isLoading}>
            Jump
          </button>
        </form>

        <div className="transport-right">
          <span className={`engine-state ${engineStateClass}`}>
            Engine {engineStatus}
          </span>
          <span className="module-path" title={modulePath}>
            {modulePath || "No module loaded"}
          </span>
        </div>
      </header>

      {errorText ? <div className="error-banner">{errorText}</div> : null}

      <main className="layout" ref={layoutRef} style={layoutStyle}>
        <section className="panel panel-nav">
          <header className="panel-header">
            <h2>Browser</h2>
            <span>{functions.length} functions</span>
          </header>
          <div className="panel-body">
            <ul className="function-list">
              {functions.map((func) => (
                <li key={`${func.kind}-${func.start}`}>
                  <button
                    className={func.start === goToAddress ? "is-active" : ""}
                    type="button"
                    onClick={() => void disassembleAt(func.start)}
                  >
                    <span className="function-meta">{func.kind}</span>
                    <span>{func.name}</span>
                    <code>{func.start}</code>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <div
          className="splitter splitter-left"
          role="separator"
          aria-label="Resize browser panel"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => startResizing("left", event)}
        />

        <section className="panel panel-disassembly">
          <header className="panel-header">
            <h2>Disassembly</h2>
            <span className="panel-stop">
              {stopReason ? `Stop ${stopReason}` : "Ready"}
            </span>
          </header>
          <div className="panel-body table-body">
            <table className="disassembly-table" style={disassemblyTableStyle}>
              <colgroup>
                <col className="col-address" />
                <col className="col-bytes" />
                <col className="col-instruction" />
                <col className="col-operands" />
                <col className="col-comment" />
              </colgroup>
              <thead>
                <tr>
                  <th>
                    <div className="column-header-cell">
                      <span>Address</span>
                      <button
                        className="column-resizer"
                        type="button"
                        aria-label="Resize Address column"
                        onPointerDown={(event) =>
                          startColumnResizing("address", event)
                        }
                      />
                    </div>
                  </th>
                  <th>
                    <div className="column-header-cell">
                      <span>Bytes</span>
                      <button
                        className="column-resizer"
                        type="button"
                        aria-label="Resize Bytes column"
                        onPointerDown={(event) =>
                          startColumnResizing("bytes", event)
                        }
                      />
                    </div>
                  </th>
                  <th>
                    <div className="column-header-cell">
                      <span>Instruction</span>
                      <button
                        className="column-resizer"
                        type="button"
                        aria-label="Resize Instruction column"
                        onPointerDown={(event) =>
                          startColumnResizing("instruction", event)
                        }
                      />
                    </div>
                  </th>
                  <th>
                    <div className="column-header-cell">
                      <span>Operands</span>
                      <button
                        className="column-resizer"
                        type="button"
                        aria-label="Resize Operands column"
                        onPointerDown={(event) =>
                          startColumnResizing("operands", event)
                        }
                      />
                    </div>
                  </th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {instructions.map((instruction) => {
                  const branchTarget = instruction.branchTarget;
                  const callTarget = instruction.callTarget;

                  return (
                    <tr key={`${instruction.address}-${instruction.bytes}`}>
                      <td>
                        <code>{instruction.address}</code>
                      </td>
                      <td>
                        <code>{instruction.bytes}</code>
                      </td>
                      <td>{instruction.mnemonic}</td>
                      <td>
                        <span>{instruction.operands}</span>
                      </td>
                      <td className="comment-cell">
                        {branchTarget ? (
                          <a
                            className="comment-link"
                            href={`#${branchTarget}`}
                            onClick={(event) => {
                              event.preventDefault();
                              void disassembleAt(branchTarget);
                            }}
                          >
                            ; branch -&gt; {branchTarget}
                          </a>
                        ) : null}
                        {callTarget ? (
                          <a
                            className="comment-link"
                            href={`#${callTarget}`}
                            onClick={(event) => {
                              event.preventDefault();
                              void disassembleAt(callTarget);
                            }}
                          >
                            ; call -&gt; {callTarget}
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div
          className="splitter splitter-right"
          role="separator"
          aria-label="Resize inspector panel"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => startResizing("right", event)}
        />

        <section className="panel panel-inspector">
          <header className="panel-header">
            <h2>Inspector</h2>
            <span>{moduleId || "No module"}</span>
          </header>
          <div className="panel-body inspector-grid">
            <div className="detail-row">
              <span>Module ID</span>
              <code>{moduleId || "-"}</code>
            </div>
            <div className="detail-row">
              <span>Entry RVA</span>
              <code>{entryRva || "-"}</code>
            </div>
            <h3>Sections</h3>
            <ul className="section-list">
              {sections.map((section) => (
                <li key={`${section.name}-${section.startRva}`}>
                  <div>
                    <code>{section.name}</code>
                  </div>
                  <div>
                    {section.startRva} - {section.endRva}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
