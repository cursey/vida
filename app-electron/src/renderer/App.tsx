import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  FunctionSeed,
  LinearRow,
  MethodResult,
  SectionInfo,
} from "../shared/protocol";

type ResizeSide = "left" | "right";

type DragState = {
  side: ResizeSide;
  startX: number;
  startLeft: number;
  startRight: number;
};

type DisassemblyColumn = "section" | "address" | "bytes" | "instruction";

type ColumnDragState = {
  key: DisassemblyColumn;
  startX: number;
  startWidth: number;
};

const MIN_PANEL_WIDTH = 220;
const MAX_PANEL_WIDTH = 420;
const MIN_CENTER_WIDTH = 420;
const SPLITTER_WIDTH = 8;

const PAGE_SIZE = 512;
const OVERSCAN_ROWS = 40;
const MAX_CACHED_PAGES = 32;
const MAX_SELECTION_HISTORY = 512;

const MAX_COLUMN_WIDTH = 1200;
const MIN_COLUMN_WIDTHS: Record<DisassemblyColumn, number> = {
  section: 72,
  address: 90,
  bytes: 120,
  instruction: 120,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function makePageKey(index: number): number {
  return Math.floor(index / PAGE_SIZE);
}

function parseHexRva(value: string): number | null {
  const parsed = Number.parseInt(value, 16);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

export function App() {
  const [engineStatus, setEngineStatus] = useState<string>("checking");
  const [modulePath, setModulePath] = useState<string>("");
  const [moduleId, setModuleId] = useState<string>("");
  const [entryRva, setEntryRva] = useState<string>("");
  const [goToAddress, setGoToAddress] = useState<string>("");
  const [functions, setFunctions] = useState<FunctionSeed[]>([]);
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [linearInfo, setLinearInfo] = useState<
    MethodResult["linear.getViewInfo"] | null
  >(null);
  const [pendingScrollRow, setPendingScrollRow] = useState<number | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  const [errorText, setErrorText] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isColumnResizing, setIsColumnResizing] = useState(false);
  const [cacheEpoch, setCacheEpoch] = useState(0);
  const [panelWidths, setPanelWidths] = useState({ left: 268, right: 300 });
  const [disassemblyColumnWidths, setDisassemblyColumnWidths] = useState({
    section: 88,
    address: 110,
    bytes: 180,
    instruction: 420,
  });

  const layoutRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const columnDragStateRef = useRef<ColumnDragState | null>(null);
  const disassemblyScrollRef = useRef<HTMLDivElement | null>(null);
  const pageCacheRef = useRef<Map<number, LinearRow[]>>(new Map());
  const inflightPagesRef = useRef<Set<number>>(new Set());
  const activeModuleIdRef = useRef("");
  const selectionHistoryRef = useRef<string[]>([]);
  const selectionHistoryIndexRef = useRef(-1);

  useEffect(() => {
    activeModuleIdRef.current = moduleId;
  }, [moduleId]);

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

  const disassemblyColumnStyle = useMemo(
    () =>
      ({
        "--col-section-width": `${disassemblyColumnWidths.section}px`,
        "--col-address-width": `${disassemblyColumnWidths.address}px`,
        "--col-bytes-width": `${disassemblyColumnWidths.bytes}px`,
        "--col-instruction-width": `${disassemblyColumnWidths.instruction}px`,
      }) as CSSProperties,
    [disassemblyColumnWidths],
  );

  const sectionRanges = useMemo(() => {
    return sections
      .map((section) => {
        const start = parseHexRva(section.startRva);
        const end = parseHexRva(section.endRva);
        if (start === null || end === null || end <= start) {
          return null;
        }
        return {
          name: section.name,
          start,
          end,
        };
      })
      .filter((range): range is { name: string; start: number; end: number } =>
        Boolean(range),
      )
      .sort((left, right) => left.start - right.start);
  }, [sections]);

  const rowCount = linearInfo?.rowCount ?? 0;
  const rowHeight = linearInfo?.rowHeight ?? 24;

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => disassemblyScrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN_ROWS,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const visibleStart = virtualItems.length > 0 ? virtualItems[0].index : 0;
  const visibleEnd =
    virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : 0;

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

  useEffect(() => {
    if (
      !moduleId ||
      !linearInfo ||
      rowCount <= 0 ||
      virtualItems.length === 0
    ) {
      return;
    }

    const firstPage = makePageKey(visibleStart);
    const lastPage = makePageKey(visibleEnd);

    for (let page = firstPage - 1; page <= lastPage + 1; page += 1) {
      if (page < 0) {
        continue;
      }
      void fetchLinearPage(moduleId, page);
    }
  }, [
    moduleId,
    linearInfo,
    rowCount,
    visibleStart,
    visibleEnd,
    virtualItems.length,
  ]);

  useEffect(() => {
    if (pendingScrollRow === null || rowCount === 0) {
      return;
    }

    const nextIndex = clamp(pendingScrollRow, 0, rowCount - 1);
    setSelectedRowIndex(nextIndex);
    rowVirtualizer.scrollToIndex(nextIndex, { align: "center" });
    setPendingScrollRow(null);
  }, [pendingScrollRow, rowCount, rowVirtualizer]);

  function resetLinearCache() {
    pageCacheRef.current.clear();
    inflightPagesRef.current.clear();
    setCacheEpoch((value) => value + 1);
  }

  function readRow(index: number): LinearRow | undefined {
    const page = makePageKey(index);
    const pageRows = pageCacheRef.current.get(page);
    if (!pageRows) {
      return undefined;
    }

    return pageRows[index % PAGE_SIZE];
  }

  function resetSelectionHistory(initialRva: string | null = null) {
    selectionHistoryRef.current = [];
    selectionHistoryIndexRef.current = -1;

    if (!initialRva) {
      return;
    }

    selectionHistoryRef.current.push(initialRva);
    selectionHistoryIndexRef.current = 0;
  }

  const pushSelectionHistory = useCallback((rva: string) => {
    if (!rva) {
      return;
    }

    const history = selectionHistoryRef.current;
    const currentIndex = selectionHistoryIndexRef.current;

    if (currentIndex >= 0 && history[currentIndex] === rva) {
      return;
    }

    if (currentIndex < history.length - 1) {
      history.splice(currentIndex + 1);
    }

    history.push(rva);

    if (history.length > MAX_SELECTION_HISTORY) {
      const overflow = history.length - MAX_SELECTION_HISTORY;
      history.splice(0, overflow);
    }

    selectionHistoryIndexRef.current = history.length - 1;
  }, []);

  async function fetchLinearPage(currentModuleId: string, page: number) {
    if (pageCacheRef.current.has(page) || inflightPagesRef.current.has(page)) {
      return;
    }

    inflightPagesRef.current.add(page);

    try {
      const payload = {
        moduleId: currentModuleId,
        startRow: page * PAGE_SIZE,
        rowCount: PAGE_SIZE,
      };
      const response = await window.electronAPI.getLinearRows(payload);
      if (currentModuleId !== activeModuleIdRef.current) {
        return;
      }

      if (pageCacheRef.current.has(page)) {
        pageCacheRef.current.delete(page);
      }
      pageCacheRef.current.set(page, response.rows);

      while (pageCacheRef.current.size > MAX_CACHED_PAGES) {
        const oldestKey = pageCacheRef.current.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        pageCacheRef.current.delete(oldestKey);
      }

      setCacheEpoch((value) => value + 1);
    } catch (error: unknown) {
      setErrorText(
        error instanceof Error ? error.message : "Failed to load linear rows",
      );
    } finally {
      inflightPagesRef.current.delete(page);
    }
  }

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
      const initialRva = listed.functions[0]?.start ?? opened.entryRva;

      const viewInfo = await window.electronAPI.getLinearViewInfo(
        opened.moduleId,
      );
      const rowLookup = await window.electronAPI.findLinearRowByRva({
        moduleId: opened.moduleId,
        rva: initialRva,
      });

      setModulePath(chosenPath);
      setModuleId(opened.moduleId);
      setEntryRva(opened.entryRva);
      setSections(info.sections);
      setFunctions(listed.functions);
      setLinearInfo(viewInfo);
      setGoToAddress(initialRva);
      setSelectedRowIndex(null);
      resetSelectionHistory(initialRva);
      resetLinearCache();
      setPendingScrollRow(rowLookup.rowIndex);
    } catch (error: unknown) {
      setErrorText(
        error instanceof Error ? error.message : "Failed to open executable",
      );
    } finally {
      setIsLoading(false);
    }
  }

  const navigateToRva = useCallback(
    async (
      rva: string,
      options: { recordHistory?: boolean } = { recordHistory: true },
    ) => {
      if (!moduleId) {
        return false;
      }

      setErrorText("");

      try {
        const found = await window.electronAPI.findLinearRowByRva({
          moduleId,
          rva,
        });
        if (options.recordHistory !== false) {
          pushSelectionHistory(rva);
        }
        setGoToAddress(rva);
        setPendingScrollRow(found.rowIndex);
        return true;
      } catch (error: unknown) {
        setErrorText(
          error instanceof Error ? error.message : "Address lookup failed",
        );
        return false;
      }
    },
    [moduleId, pushSelectionHistory],
  );

  const navigateSelectionHistory = useCallback(
    async (direction: -1 | 1) => {
      if (!moduleId) {
        return;
      }

      const history = selectionHistoryRef.current;
      const currentIndex = selectionHistoryIndexRef.current;
      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= history.length) {
        return;
      }

      const targetRva = history[nextIndex];
      selectionHistoryIndexRef.current = nextIndex;
      const navigated = await navigateToRva(targetRva, {
        recordHistory: false,
      });
      if (!navigated) {
        selectionHistoryIndexRef.current = currentIndex;
      }
    },
    [moduleId, navigateToRva],
  );

  useEffect(() => {
    function handleMouseHistoryButtons(event: MouseEvent) {
      if (!moduleId) {
        return;
      }
      if (event.button !== 3 && event.button !== 4) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void navigateSelectionHistory(event.button === 3 ? -1 : 1);
    }

    window.addEventListener("mousedown", handleMouseHistoryButtons);
    return () => {
      window.removeEventListener("mousedown", handleMouseHistoryButtons);
    };
  }, [moduleId, navigateSelectionHistory]);

  function handleGoToSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void navigateToRva(goToAddress);
  }

  function findSectionName(address: string): string {
    const rva = parseHexRva(address);
    if (rva === null) {
      return "";
    }
    for (const range of sectionRanges) {
      if (rva >= range.start && rva < range.end) {
        return range.name;
      }
    }
    return "";
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
                    onClick={() => void navigateToRva(func.start)}
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
              {linearInfo ? `${linearInfo.rowCount} rows` : "Ready"}
            </span>
          </header>
          <div className="panel-body table-body" style={disassemblyColumnStyle}>
            <div className="disassembly-columns-header">
              <div className="column-header-cell">
                <span>Section</span>
                <button
                  className="column-resizer"
                  type="button"
                  aria-label="Resize Section column"
                  onPointerDown={(event) =>
                    startColumnResizing("section", event)
                  }
                />
              </div>
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
              <div className="column-header-cell">
                <span>Bytes</span>
                <button
                  className="column-resizer"
                  type="button"
                  aria-label="Resize Bytes column"
                  onPointerDown={(event) => startColumnResizing("bytes", event)}
                />
              </div>
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
              <div className="column-header-cell">
                <span>Comment</span>
              </div>
            </div>

            <div
              className="disassembly-scroll-region"
              ref={disassemblyScrollRef}
            >
              <div
                className="disassembly-rows-canvas"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {virtualItems.map((virtualRow) => {
                  const row = readRow(virtualRow.index);
                  const top = virtualRow.start;

                  if (!row) {
                    return (
                      <div
                        key={`loading-${virtualRow.index}`}
                        className="disassembly-row row-loading"
                        style={{ transform: `translateY(${top}px)` }}
                      >
                        <div className="cell section-cell" />
                        <div className="cell">
                          <code>...</code>
                        </div>
                        <div className="cell">
                          <code>...</code>
                        </div>
                        <div className="cell">loading</div>
                        <div className="cell" />
                      </div>
                    );
                  }

                  return (
                    <div
                      key={`${virtualRow.index}-${cacheEpoch}-${row.address}`}
                      className={`disassembly-row kind-${row.kind} ${
                        selectedRowIndex === virtualRow.index
                          ? "is-current"
                          : ""
                      }`}
                      style={{ transform: `translateY(${top}px)` }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) {
                          return;
                        }
                        setSelectedRowIndex(virtualRow.index);
                        setGoToAddress(row.address);
                        pushSelectionHistory(row.address);
                      }}
                    >
                      <div className="cell section-cell">
                        {findSectionName(row.address)}
                      </div>
                      <div className="cell">
                        <code>{row.address}</code>
                      </div>
                      <div className="cell">
                        <code>{row.bytes}</code>
                      </div>
                      <div className="cell">
                        {row.mnemonic}
                        {row.operands ? ` ${row.operands}` : ""}
                      </div>
                      <div className="cell comment-cell">
                        {row.comment ? <span>{`; ${row.comment}`}</span> : null}
                        {row.branchTarget ? (
                          <a
                            className="comment-link"
                            href={`#${row.branchTarget}`}
                            onClick={(event) => {
                              event.preventDefault();
                              void navigateToRva(row.branchTarget ?? "");
                            }}
                          >
                            ; branch -&gt; {row.branchTarget}
                          </a>
                        ) : null}
                        {row.callTarget ? (
                          <a
                            className="comment-link"
                            href={`#${row.callTarget}`}
                            onClick={(event) => {
                              event.preventDefault();
                              void navigateToRva(row.callTarget ?? "");
                            }}
                          >
                            ; call -&gt; {row.callTarget}
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
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
                  <button
                    className={
                      goToAddress === section.startRva ? "is-active" : ""
                    }
                    type="button"
                    onClick={() => void navigateToRva(section.startRva)}
                  >
                    <code>{section.name}</code>
                    <span>
                      {section.startRva} - {section.endRva}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
