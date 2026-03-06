import { WindowChrome } from "@/components/window-chrome";
import { GoToDialog, LoadingDialog } from "@/features/app/app-dialogs";
import { AppStatusBar } from "@/features/app/status-bar";
import { BrowserPanel } from "@/features/browser/browser-panel";
import { DisassemblyPanel } from "@/features/disassembly/disassembly-panel";
import { GraphPanel } from "@/features/graph/graph-panel";
import {
  resetDeferredEdgeRebaseState,
  setupDeferredEdgeRebase,
} from "@/features/shared/deferred-edge-rebase";
import { isEditableTarget } from "@/features/shared/dom-utils";
import { clamp, makePageKey, parseHexVa } from "@/features/shared/number-utils";
import { cn } from "@/lib/utils";
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
  TitleBarMenuModel,
  WindowChromeState,
  WindowControlAction,
} from "../shared/protocol";

type DragState = {
  startX: number;
  startLeft: number;
};

type DisassemblyColumn = "section" | "address" | "bytes" | "instruction";
type ActivePanel = "browser" | "disassembly";
type CenterView = "disassembly" | "graph";

type ColumnDragState = {
  key: DisassemblyColumn;
  startX: number;
  startWidth: number;
};

export { toFunctionProvenanceCode } from "@/features/browser/function-provenance";

const MIN_PANEL_WIDTH = 220;
const MAX_PANEL_WIDTH = 420;
const MIN_CENTER_WIDTH = 420;
const SPLITTER_WIDTH = 8;

const PAGE_SIZE = 512;
const OVERSCAN_ROWS = 40;
const MAX_CACHED_PAGES = 32;
const MAX_SELECTION_HISTORY = 512;
const FUNCTION_ROW_HEIGHT = 26;
const FUNCTION_OVERSCAN_ROWS = 12;
const MAX_FUNCTION_WINDOW_ROWS = 100_000;
const FUNCTION_REBASE_MARGIN_ROWS = 20_000;
const FUNCTION_REBASE_IDLE_MS = 140;
const FUNCTION_SEARCH_CHUNK_SIZE = 2_000;
const MAX_DISASSEMBLY_WINDOW_ROWS = 100_000;
const DISASSEMBLY_REBASE_MARGIN_ROWS = 20_000;
const DISASSEMBLY_REBASE_IDLE_MS = 140;

const MAX_COLUMN_WIDTH = 1200;
const MIN_COLUMN_WIDTHS: Record<DisassemblyColumn, number> = {
  section: 72,
  address: 90,
  bytes: 120,
  instruction: 120,
};

export function App() {
  const [engineStatus, setEngineStatus] = useState<string>("checking");
  const [modulePath, setModulePath] = useState<string>("");
  const [moduleId, setModuleId] = useState<string>("");
  const [entryVa, setEntryVa] = useState<string>("");
  const [goToAddress, setGoToAddress] = useState<string>("");
  const [functions, setFunctions] = useState<FunctionSeed[]>([]);
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [windowChromeState, setWindowChromeState] = useState<WindowChromeState>(
    {
      useCustomChrome: true,
      platform: "win32",
      isMaximized: false,
      isFocused: false,
    },
  );
  const [titleBarMenuModel, setTitleBarMenuModel] = useState<TitleBarMenuModel>(
    { menus: [] },
  );
  const [linearInfo, setLinearInfo] = useState<
    MethodResult["linear.getViewInfo"] | null
  >(null);
  const [pendingScrollRow, setPendingScrollRow] = useState<number | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel>("disassembly");
  const [centerView, setCenterView] = useState<CenterView>("disassembly");
  const [graphData, setGraphData] = useState<
    MethodResult["function.getGraphByVa"] | null
  >(null);
  const [isGoToModalOpen, setIsGoToModalOpen] = useState(false);
  const [goToInputValue, setGoToInputValue] = useState("");
  const [isBrowserSearchVisible, setIsBrowserSearchVisible] = useState(false);
  const [functionSearchQuery, setFunctionSearchQuery] = useState("");
  const [searchedFunctionIndexes, setSearchedFunctionIndexes] = useState<
    number[] | null
  >(null);
  const [appliedFunctionSearchQuery, setAppliedFunctionSearchQuery] =
    useState("");
  const [isSearchingFunctions, setIsSearchingFunctions] = useState(false);

  const [errorText, setErrorText] = useState<string>("");
  const [transientStatusMessage, setTransientStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPath, setLoadingPath] = useState<string>("");
  const [isResizing, setIsResizing] = useState(false);
  const [isColumnResizing, setIsColumnResizing] = useState(false);
  const [cacheEpoch, setCacheEpoch] = useState(0);
  const [leftPanelWidth, setLeftPanelWidth] = useState(268);
  const [functionWindowStartIndex, setFunctionWindowStartIndex] = useState(0);
  const [disassemblyWindowStartRow, setDisassemblyWindowStartRow] = useState(0);
  const [disassemblyColumnWidths, setDisassemblyColumnWidths] = useState({
    section: 88,
    address: 110,
    bytes: 180,
    instruction: 420,
  });

  const layoutRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const columnDragStateRef = useRef<ColumnDragState | null>(null);
  const functionScrollRef = useRef<HTMLDivElement | null>(null);
  const disassemblyScrollRef = useRef<HTMLDivElement | null>(null);
  const goToInputRef = useRef<HTMLInputElement | null>(null);
  const browserSearchInputRef = useRef<HTMLInputElement | null>(null);
  const pageCacheRef = useRef<Map<number, LinearRow[]>>(new Map());
  const inflightPagesRef = useRef<Set<number>>(new Set());
  const functionRebaseInProgressRef = useRef(false);
  const functionPendingRebaseDirectionRef = useRef<-1 | 0 | 1>(0);
  const functionRebaseIdleTimerRef = useRef<number | null>(null);
  const disassemblyRebaseInProgressRef = useRef(false);
  const disassemblyPendingRebaseDirectionRef = useRef<-1 | 0 | 1>(0);
  const disassemblyRebaseIdleTimerRef = useRef<number | null>(null);
  const activeModuleIdRef = useRef("");
  const selectionHistoryRef = useRef<string[]>([]);
  const selectionHistoryIndexRef = useRef(-1);
  const functionSearchJobIdRef = useRef(0);
  const statusMessageTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeModuleIdRef.current = moduleId;
  }, [moduleId]);

  useEffect(() => {
    return () => {
      if (statusMessageTimerRef.current !== null) {
        window.clearTimeout(statusMessageTimerRef.current);
        statusMessageTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    document.title = modulePath
      ? `${modulePath} - Electron Disassembler`
      : "Electron Disassembler";
  }, [modulePath]);

  useEffect(() => {
    let isMounted = true;
    void Promise.all([
      window.electronAPI.getWindowChromeState(),
      window.electronAPI.getTitleBarMenuModel(),
    ])
      .then(([chromeState, menuModel]) => {
        if (!isMounted) {
          return;
        }
        setWindowChromeState(chromeState);
        setTitleBarMenuModel(menuModel);
      })
      .catch((error: unknown) => {
        setErrorText(
          error instanceof Error
            ? error.message
            : "Failed to load window chrome state",
        );
      });

    const unsubscribeChrome = window.electronAPI.onWindowChromeStateChanged(
      (state) => {
        setWindowChromeState(state);
      },
    );
    const unsubscribeMenu = window.electronAPI.onTitleBarMenuModelChanged(
      (model) => {
        setTitleBarMenuModel(model);
      },
    );

    return () => {
      isMounted = false;
      unsubscribeChrome();
      unsubscribeMenu();
    };
  }, []);

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

  useEffect(() => {
    const unsubscribe = window.electronAPI.onMenuOpenExecutable(() => {
      void openExecutableFromPicker();
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onMenuOpenRecentExecutable(
      (selectedPath: string) => {
        setErrorText("");
        void openModuleFromPath(selectedPath);
      },
    );
    return () => {
      unsubscribe();
    };
  }, []);

  const unloadCurrentModule = useCallback(() => {
    functionSearchJobIdRef.current += 1;
    if (statusMessageTimerRef.current !== null) {
      window.clearTimeout(statusMessageTimerRef.current);
      statusMessageTimerRef.current = null;
    }
    setErrorText("");
    setTransientStatusMessage("");
    setIsLoading(false);
    setLoadingPath("");
    setIsGoToModalOpen(false);
    setGoToInputValue("");
    setIsBrowserSearchVisible(false);
    setFunctionSearchQuery("");
    setSearchedFunctionIndexes(null);
    setAppliedFunctionSearchQuery("");
    setIsSearchingFunctions(false);
    setModulePath("");
    setModuleId("");
    setEntryVa("");
    setSections([]);
    setFunctions([]);
    resetDeferredEdgeRebaseState({
      inProgressRef: functionRebaseInProgressRef,
      pendingDirectionRef: functionPendingRebaseDirectionRef,
      idleTimerRef: functionRebaseIdleTimerRef,
    });
    setFunctionWindowStartIndex(0);
    setLinearInfo(null);
    setGoToAddress("");
    setSelectedRowIndex(null);
    setPendingScrollRow(null);
    setDisassemblyWindowStartRow(0);
    setCenterView("disassembly");
    setGraphData(null);
    resetSelectionHistory();
    resetLinearCache();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onMenuUnloadModule(() => {
      unloadCurrentModule();
    });
    return () => {
      unsubscribe();
    };
  }, [unloadCurrentModule]);

  const engineStateClass = useMemo(() => {
    if (engineStatus.startsWith("online")) {
      return "state-online";
    }

    if (engineStatus === "checking") {
      return "state-checking";
    }

    return "state-offline";
  }, [engineStatus]);

  const showTransientStatusMessage = useCallback((message: string) => {
    if (statusMessageTimerRef.current !== null) {
      window.clearTimeout(statusMessageTimerRef.current);
      statusMessageTimerRef.current = null;
    }
    setTransientStatusMessage(message);
    statusMessageTimerRef.current = window.setTimeout(() => {
      setTransientStatusMessage("");
      statusMessageTimerRef.current = null;
    }, 2500);
  }, []);

  const layoutStyle = useMemo(
    () =>
      ({
        "--left-panel-width": `${leftPanelWidth}px`,
      }) as CSSProperties,
    [leftPanelWidth],
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
        const start = parseHexVa(section.startVa);
        const end = parseHexVa(section.endVa);
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

  const normalizedFunctionSearchQuery = useMemo(
    () => functionSearchQuery.trim().toLowerCase(),
    [functionSearchQuery],
  );
  const normalizedFunctionNames = useMemo(
    () => functions.map((func) => func.name.toLowerCase()),
    [functions],
  );
  const displayedFunctionIndexes = searchedFunctionIndexes;
  const totalFunctionCount = functions.length;
  const functionCount =
    displayedFunctionIndexes === null
      ? totalFunctionCount
      : displayedFunctionIndexes.length;
  const functionWindowSize = Math.min(functionCount, MAX_FUNCTION_WINDOW_ROWS);
  const maxFunctionWindowStart = Math.max(
    0,
    functionCount - functionWindowSize,
  );
  const boundedFunctionWindowStart = Math.min(
    functionWindowStartIndex,
    maxFunctionWindowStart,
  );
  const functionWindowRowCount = Math.min(
    functionWindowSize,
    Math.max(0, functionCount - boundedFunctionWindowStart),
  );

  const functionRowVirtualizer = useVirtualizer({
    count: functionWindowRowCount,
    getScrollElement: () => functionScrollRef.current,
    estimateSize: () => FUNCTION_ROW_HEIGHT,
    overscan: FUNCTION_OVERSCAN_ROWS,
  });
  const functionVirtualItems = functionRowVirtualizer.getVirtualItems();

  const rowCount = linearInfo?.rowCount ?? 0;
  const rowHeight = linearInfo?.rowHeight ?? 24;
  const disassemblyWindowSize = Math.min(rowCount, MAX_DISASSEMBLY_WINDOW_ROWS);
  const maxDisassemblyWindowStart = Math.max(
    0,
    rowCount - disassemblyWindowSize,
  );
  const boundedDisassemblyWindowStart = Math.min(
    disassemblyWindowStartRow,
    maxDisassemblyWindowStart,
  );
  const disassemblyWindowRowCount = Math.min(
    disassemblyWindowSize,
    Math.max(0, rowCount - boundedDisassemblyWindowStart),
  );

  const rowVirtualizer = useVirtualizer({
    count: disassemblyWindowRowCount,
    getScrollElement: () => disassemblyScrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN_ROWS,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const visibleStart =
    virtualItems.length > 0
      ? boundedDisassemblyWindowStart + virtualItems[0].index
      : boundedDisassemblyWindowStart;
  const visibleEnd =
    virtualItems.length > 0
      ? boundedDisassemblyWindowStart +
        virtualItems[virtualItems.length - 1].index
      : boundedDisassemblyWindowStart;

  useEffect(() => {
    setDisassemblyWindowStartRow((prev) =>
      clamp(prev, 0, maxDisassemblyWindowStart),
    );
  }, [maxDisassemblyWindowStart]);

  useEffect(() => {
    setFunctionWindowStartIndex((prev) =>
      clamp(prev, 0, maxFunctionWindowStart),
    );
  }, [maxFunctionWindowStart]);

  const resetFunctionBrowserViewport = useCallback(() => {
    resetDeferredEdgeRebaseState({
      inProgressRef: functionRebaseInProgressRef,
      pendingDirectionRef: functionPendingRebaseDirectionRef,
      idleTimerRef: functionRebaseIdleTimerRef,
    });
    setFunctionWindowStartIndex(0);
    if (functionScrollRef.current) {
      functionScrollRef.current.scrollTop = 0;
    }
  }, []);

  useEffect(() => {
    functionSearchJobIdRef.current += 1;
    const jobId = functionSearchJobIdRef.current;
    const query = normalizedFunctionSearchQuery;

    if (!moduleId || totalFunctionCount === 0) {
      setIsSearchingFunctions(false);
      setSearchedFunctionIndexes(null);
      setAppliedFunctionSearchQuery("");
      return;
    }

    if (query.length === 0) {
      setIsSearchingFunctions(false);
      setSearchedFunctionIndexes(null);
      setAppliedFunctionSearchQuery("");
      resetFunctionBrowserViewport();
      return;
    }

    setIsSearchingFunctions(true);
    void (async () => {
      const matchedIndexes: number[] = [];

      for (
        let chunkStart = 0;
        chunkStart < normalizedFunctionNames.length;
        chunkStart += FUNCTION_SEARCH_CHUNK_SIZE
      ) {
        if (functionSearchJobIdRef.current !== jobId) {
          return;
        }

        const chunkEnd = Math.min(
          chunkStart + FUNCTION_SEARCH_CHUNK_SIZE,
          normalizedFunctionNames.length,
        );
        for (let index = chunkStart; index < chunkEnd; index += 1) {
          if (normalizedFunctionNames[index]?.includes(query)) {
            matchedIndexes.push(index);
          }
        }

        if (chunkEnd < normalizedFunctionNames.length) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 0);
          });
        }
      }

      if (functionSearchJobIdRef.current !== jobId) {
        return;
      }

      setSearchedFunctionIndexes(matchedIndexes);
      setAppliedFunctionSearchQuery(query);
      setIsSearchingFunctions(false);
      resetFunctionBrowserViewport();
    })();
  }, [
    moduleId,
    normalizedFunctionNames,
    normalizedFunctionSearchQuery,
    resetFunctionBrowserViewport,
    totalFunctionCount,
  ]);

  useEffect(() => {
    return () => {
      functionSearchJobIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const scrollElementCandidate = functionScrollRef.current;
    if (
      !scrollElementCandidate ||
      functionCount <= functionWindowSize ||
      functionWindowRowCount <= 0
    ) {
      return;
    }
    return setupDeferredEdgeRebase({
      scrollElement: scrollElementCandidate,
      rowHeight: FUNCTION_ROW_HEIGHT,
      windowRowCount: functionWindowRowCount,
      windowStart: boundedFunctionWindowStart,
      maxWindowStart: maxFunctionWindowStart,
      rebaseMarginRows: FUNCTION_REBASE_MARGIN_ROWS,
      rebaseIdleMs: FUNCTION_REBASE_IDLE_MS,
      setWindowStart: setFunctionWindowStartIndex,
      stateRefs: {
        inProgressRef: functionRebaseInProgressRef,
        pendingDirectionRef: functionPendingRebaseDirectionRef,
        idleTimerRef: functionRebaseIdleTimerRef,
      },
    });
  }, [
    functionCount,
    functionWindowSize,
    functionWindowRowCount,
    boundedFunctionWindowStart,
    maxFunctionWindowStart,
  ]);

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
          layoutWidth - MIN_CENTER_WIDTH - SPLITTER_WIDTH,
        ),
      );
      const clampedLeft = clamp(leftPanelWidth, MIN_PANEL_WIDTH, maxLeft);
      if (clampedLeft !== leftPanelWidth) {
        setLeftPanelWidth(clampedLeft);
      }
    }

    window.addEventListener("resize", clampPanelWidths);
    clampPanelWidths();

    return () => {
      window.removeEventListener("resize", clampPanelWidths);
    };
  }, [leftPanelWidth]);

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
      const maxLeft = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(
          MAX_PANEL_WIDTH,
          layoutWidth - MIN_CENTER_WIDTH - SPLITTER_WIDTH,
        ),
      );
      setLeftPanelWidth(clamp(drag.startLeft + dx, MIN_PANEL_WIDTH, maxLeft));
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
    const scrollElementCandidate = disassemblyScrollRef.current;
    if (
      !scrollElementCandidate ||
      rowCount <= disassemblyWindowSize ||
      disassemblyWindowRowCount <= 0 ||
      rowHeight <= 0
    ) {
      return;
    }
    return setupDeferredEdgeRebase({
      scrollElement: scrollElementCandidate,
      rowHeight,
      windowRowCount: disassemblyWindowRowCount,
      windowStart: boundedDisassemblyWindowStart,
      maxWindowStart: maxDisassemblyWindowStart,
      rebaseMarginRows: DISASSEMBLY_REBASE_MARGIN_ROWS,
      rebaseIdleMs: DISASSEMBLY_REBASE_IDLE_MS,
      setWindowStart: setDisassemblyWindowStartRow,
      stateRefs: {
        inProgressRef: disassemblyRebaseInProgressRef,
        pendingDirectionRef: disassemblyPendingRebaseDirectionRef,
        idleTimerRef: disassemblyRebaseIdleTimerRef,
      },
    });
  }, [
    rowCount,
    rowHeight,
    disassemblyWindowSize,
    disassemblyWindowRowCount,
    boundedDisassemblyWindowStart,
    maxDisassemblyWindowStart,
  ]);

  useEffect(() => {
    if (
      !moduleId ||
      !linearInfo ||
      rowCount <= 0 ||
      virtualItems.length === 0
    ) {
      return;
    }

    const firstPage = makePageKey(visibleStart, PAGE_SIZE);
    const lastPage = makePageKey(visibleEnd, PAGE_SIZE);

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
    const nextWindowStart = clamp(
      nextIndex - Math.floor(disassemblyWindowSize / 2),
      0,
      maxDisassemblyWindowStart,
    );
    const windowIndex = nextIndex - nextWindowStart;
    setSelectedRowIndex(nextIndex);
    setDisassemblyWindowStartRow(nextWindowStart);
    requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(windowIndex, { align: "center" });
    });
    setPendingScrollRow(null);
  }, [
    pendingScrollRow,
    rowCount,
    rowVirtualizer,
    disassemblyWindowSize,
    maxDisassemblyWindowStart,
  ]);

  function resetLinearCache() {
    pageCacheRef.current.clear();
    inflightPagesRef.current.clear();
    resetDeferredEdgeRebaseState({
      inProgressRef: disassemblyRebaseInProgressRef,
      pendingDirectionRef: disassemblyPendingRebaseDirectionRef,
      idleTimerRef: disassemblyRebaseIdleTimerRef,
    });
    setCacheEpoch((value) => value + 1);
  }

  const readRow = useCallback((index: number): LinearRow | undefined => {
    const page = makePageKey(index, PAGE_SIZE);
    const pageRows = pageCacheRef.current.get(page);
    if (!pageRows) {
      return undefined;
    }

    return pageRows[index % PAGE_SIZE];
  }, []);

  const toggleGraphViewForSelection = useCallback(async () => {
    if (!moduleId || activePanel !== "disassembly") {
      return;
    }

    if (centerView === "graph") {
      setCenterView("disassembly");
      return;
    }

    if (selectedRowIndex === null) {
      showTransientStatusMessage(
        "Select an instruction in Disassembly before opening Graph View.",
      );
      return;
    }

    let selectedRow = readRow(selectedRowIndex);
    if (!selectedRow) {
      await fetchLinearPage(moduleId, makePageKey(selectedRowIndex, PAGE_SIZE));
      selectedRow = readRow(selectedRowIndex);
    }
    if (!selectedRow || selectedRow.kind !== "instruction") {
      showTransientStatusMessage(
        "The highlighted row is not a function instruction.",
      );
      return;
    }

    try {
      const graph = await window.electronAPI.getFunctionGraphByVa({
        moduleId,
        va: selectedRow.address,
      });
      setGraphData(graph);
      setCenterView("graph");
      setErrorText("");
      if (statusMessageTimerRef.current !== null) {
        window.clearTimeout(statusMessageTimerRef.current);
        statusMessageTimerRef.current = null;
      }
      setTransientStatusMessage("");
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.toUpperCase().includes("INVALID_ADDRESS")
      ) {
        showTransientStatusMessage(
          "The highlighted instruction does not belong to a discovered function.",
        );
        return;
      }

      setErrorText(
        error instanceof Error ? error.message : "Failed to open graph view",
      );
    }
  }, [
    activePanel,
    centerView,
    moduleId,
    readRow,
    selectedRowIndex,
    showTransientStatusMessage,
  ]);

  function resetSelectionHistory(initialVa: string | null = null) {
    selectionHistoryRef.current = [];
    selectionHistoryIndexRef.current = -1;

    if (!initialVa) {
      return;
    }

    selectionHistoryRef.current.push(initialVa);
    selectionHistoryIndexRef.current = 0;
  }

  const pushSelectionHistory = useCallback((va: string) => {
    if (!va) {
      return;
    }

    const history = selectionHistoryRef.current;
    const currentIndex = selectionHistoryIndexRef.current;

    if (currentIndex >= 0 && history[currentIndex] === va) {
      return;
    }

    if (currentIndex < history.length - 1) {
      history.splice(currentIndex + 1);
    }

    history.push(va);

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

  function startResizing(event: PointerEvent<HTMLDivElement>) {
    if (window.innerWidth <= 1250) {
      return;
    }

    event.preventDefault();
    dragStateRef.current = {
      startX: event.clientX,
      startLeft: leftPanelWidth,
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

  async function openModuleFromPath(chosenPath: string) {
    setErrorText("");
    if (statusMessageTimerRef.current !== null) {
      window.clearTimeout(statusMessageTimerRef.current);
      statusMessageTimerRef.current = null;
    }
    setTransientStatusMessage("");
    setIsLoading(true);
    setLoadingPath(chosenPath);

    try {
      const opened = await window.electronAPI.openModule(chosenPath);
      const info = await window.electronAPI.getModuleInfo(opened.moduleId);
      const listed = await window.electronAPI.listFunctions(opened.moduleId);
      const initialVa = listed.functions[0]?.start ?? opened.entryVa;

      const viewInfo = await window.electronAPI.getLinearViewInfo(
        opened.moduleId,
      );
      const rowLookup = await window.electronAPI.findLinearRowByVa({
        moduleId: opened.moduleId,
        va: initialVa,
      });

      setModulePath(chosenPath);
      setModuleId(opened.moduleId);
      setEntryVa(opened.entryVa);
      setSections(info.sections);
      functionSearchJobIdRef.current += 1;
      setIsBrowserSearchVisible(false);
      setFunctionSearchQuery("");
      setSearchedFunctionIndexes(null);
      setAppliedFunctionSearchQuery("");
      setIsSearchingFunctions(false);
      setFunctions(listed.functions);
      resetFunctionBrowserViewport();
      setLinearInfo(viewInfo);
      setGoToAddress(initialVa);
      setSelectedRowIndex(null);
      setDisassemblyWindowStartRow(0);
      setCenterView("disassembly");
      setGraphData(null);
      resetSelectionHistory(initialVa);
      resetLinearCache();
      setPendingScrollRow(rowLookup.rowIndex);
      void window.electronAPI.addRecentExecutable(chosenPath).catch((error) => {
        console.warn("Failed to add executable to recent list:", error);
      });
    } catch (error: unknown) {
      setErrorText(
        error instanceof Error ? error.message : "Failed to open executable",
      );
    } finally {
      setIsLoading(false);
      setLoadingPath("");
    }
  }

  async function openExecutableFromPicker() {
    setErrorText("");
    const chosenPath = await window.electronAPI.pickExecutable();
    if (!chosenPath) {
      return;
    }
    await openModuleFromPath(chosenPath);
  }

  const navigateToVa = useCallback(
    async (
      va: string,
      options: { recordHistory?: boolean } = { recordHistory: true },
    ) => {
      if (!moduleId) {
        return false;
      }

      setErrorText("");

      try {
        const found = await window.electronAPI.findLinearRowByVa({
          moduleId,
          va,
        });
        if (options.recordHistory !== false) {
          pushSelectionHistory(va);
        }
        setGoToAddress(va);
        setCenterView("disassembly");
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

      const targetVa = history[nextIndex];
      selectionHistoryIndexRef.current = nextIndex;
      const navigated = await navigateToVa(targetVa, {
        recordHistory: false,
      });
      if (!navigated) {
        selectionHistoryIndexRef.current = currentIndex;
      }
    },
    [moduleId, navigateToVa],
  );

  const openGoToModal = useCallback(() => {
    if (!moduleId) {
      return;
    }
    setGoToInputValue(goToAddress || entryVa || "");
    setIsGoToModalOpen(true);
  }, [moduleId, goToAddress, entryVa]);

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

  useEffect(() => {
    if (!isGoToModalOpen) {
      return;
    }
    goToInputRef.current?.focus();
    goToInputRef.current?.select();
  }, [isGoToModalOpen]);

  useEffect(() => {
    if (!isBrowserSearchVisible) {
      return;
    }
    browserSearchInputRef.current?.focus();
    browserSearchInputRef.current?.select();
  }, [isBrowserSearchVisible]);

  useEffect(() => {
    if (activePanel === "browser" || !isBrowserSearchVisible) {
      return;
    }
    setIsBrowserSearchVisible(false);
    setFunctionSearchQuery("");
  }, [activePanel, isBrowserSearchVisible]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && isGoToModalOpen) {
        event.preventDefault();
        setIsGoToModalOpen(false);
        return;
      }

      if (
        event.key === "Escape" &&
        isBrowserSearchVisible &&
        activePanel === "browser"
      ) {
        event.preventDefault();
        setIsBrowserSearchVisible(false);
        setFunctionSearchQuery("");
        return;
      }

      if (
        event.key.toLowerCase() === "f" &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.repeat
      ) {
        if (activePanel !== "browser" || !moduleId || isGoToModalOpen) {
          return;
        }

        event.preventDefault();
        setIsBrowserSearchVisible((previous) => {
          const next = !previous;
          if (!next) {
            setFunctionSearchQuery("");
          }
          return next;
        });
        return;
      }

      if (event.code === "Space" && !event.repeat) {
        if (event.ctrlKey || event.metaKey || event.altKey) {
          return;
        }
        if (isEditableTarget(event.target) || isGoToModalOpen || !moduleId) {
          return;
        }

        event.preventDefault();
        void toggleGraphViewForSelection();
        return;
      }

      if (event.key.toLowerCase() !== "g" || event.repeat) {
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (
        activePanel !== "disassembly" ||
        centerView !== "disassembly" ||
        !moduleId ||
        isGoToModalOpen
      ) {
        return;
      }

      event.preventDefault();
      openGoToModal();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    activePanel,
    centerView,
    isBrowserSearchVisible,
    moduleId,
    isGoToModalOpen,
    openGoToModal,
    toggleGraphViewForSelection,
  ]);

  async function handleGoToSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = goToInputValue.trim();
    if (!target) {
      return;
    }
    const navigated = await navigateToVa(target);
    if (navigated) {
      setIsGoToModalOpen(false);
    }
  }

  function findSectionName(address: string): string {
    const va = parseHexVa(address);
    if (va === null) {
      return "";
    }
    for (const range of sectionRanges) {
      if (va >= range.start && va < range.end) {
        return range.name;
      }
    }
    return "";
  }

  const handleWindowControl = useCallback((action: WindowControlAction) => {
    void window.electronAPI.windowControl(action).catch((error: unknown) => {
      setErrorText(
        error instanceof Error ? error.message : "Window control failed",
      );
    });
  }, []);

  const handleInvokeTitleBarMenuAction = useCallback((commandId: string) => {
    void window.electronAPI
      .invokeTitleBarMenuAction(commandId)
      .catch((error: unknown) => {
        setErrorText(
          error instanceof Error ? error.message : "Menu action failed",
        );
      });
  }, []);

  return (
    <div
      className={cn("shell", (isResizing || isColumnResizing) && "is-resizing")}
    >
      {windowChromeState.useCustomChrome ? (
        <WindowChrome
          menuModel={titleBarMenuModel}
          onInvokeMenuAction={handleInvokeTitleBarMenuAction}
          onWindowControl={handleWindowControl}
          titleText={modulePath}
          windowState={windowChromeState}
        />
      ) : null}
      {errorText ? <div className="error-banner">{errorText}</div> : null}

      <main className="layout" ref={layoutRef} style={layoutStyle}>
        <BrowserPanel
          isActive={activePanel === "browser"}
          moduleId={moduleId}
          appliedFunctionSearchQuery={appliedFunctionSearchQuery}
          functionCount={functionCount}
          totalFunctionCount={totalFunctionCount}
          functionScrollRef={functionScrollRef}
          functionListTotalSize={functionRowVirtualizer.getTotalSize()}
          functionVirtualItems={functionVirtualItems}
          boundedFunctionWindowStart={boundedFunctionWindowStart}
          displayedFunctionIndexes={displayedFunctionIndexes}
          functions={functions}
          goToAddress={goToAddress}
          onNavigateToVa={navigateToVa}
          isBrowserSearchVisible={isBrowserSearchVisible}
          browserSearchInputRef={browserSearchInputRef}
          functionSearchQuery={functionSearchQuery}
          onFunctionSearchQueryChange={setFunctionSearchQuery}
          onActivate={() => setActivePanel("browser")}
        />

        <div
          className="splitter splitter-left"
          role="separator"
          aria-label="Resize browser panel"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={startResizing}
        />

        {centerView === "disassembly" ? (
          <DisassemblyPanel
            isActive={activePanel === "disassembly"}
            moduleId={moduleId}
            rowCount={linearInfo?.rowCount ?? 0}
            disassemblyColumnStyle={disassemblyColumnStyle}
            onActivate={() => setActivePanel("disassembly")}
            onStartColumnResizing={startColumnResizing}
            disassemblyScrollRef={disassemblyScrollRef}
            disassemblyListTotalSize={rowVirtualizer.getTotalSize()}
            virtualItems={virtualItems}
            boundedDisassemblyWindowStart={boundedDisassemblyWindowStart}
            readRow={readRow}
            cacheEpoch={cacheEpoch}
            selectedRowIndex={selectedRowIndex}
            onSelectRow={(rowIndex, address) => {
              setSelectedRowIndex(rowIndex);
              setGoToAddress(address);
              pushSelectionHistory(address);
            }}
            findSectionName={findSectionName}
            onNavigateToVa={navigateToVa}
          />
        ) : (
          <GraphPanel
            isActive={activePanel === "disassembly"}
            moduleId={moduleId}
            graph={graphData}
            onActivate={() => setActivePanel("disassembly")}
          />
        )}
      </main>

      <AppStatusBar
        engineStatus={engineStatus}
        engineStateClass={engineStateClass}
        isSearchingFunctions={isSearchingFunctions}
        transientMessage={transientStatusMessage}
      />

      <LoadingDialog isLoading={isLoading} loadingPath={loadingPath} />

      <GoToDialog
        isOpen={isGoToModalOpen}
        isLoading={isLoading}
        moduleId={moduleId}
        goToInputRef={goToInputRef}
        goToInputValue={goToInputValue}
        onGoToInputChange={setGoToInputValue}
        onOpenChange={setIsGoToModalOpen}
        onSubmit={(event) => {
          void handleGoToSubmit(event);
        }}
      />
    </div>
  );
}
