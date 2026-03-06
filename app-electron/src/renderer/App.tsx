import { ModeToggle } from "@/components/mode-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { WindowChrome } from "@/components/window-chrome";
import { cn } from "@/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type FormEvent,
  type MutableRefObject,
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

type ResizeSide = "left" | "right";

type DragState = {
  side: ResizeSide;
  startX: number;
  startLeft: number;
  startRight: number;
};

type DisassemblyColumn = "section" | "address" | "bytes" | "instruction";
type ActivePanel = "browser" | "disassembly" | "inspector";

type ColumnDragState = {
  key: DisassemblyColumn;
  startX: number;
  startWidth: number;
};

type RebaseDirection = -1 | 0 | 1;

type DeferredEdgeRebaseStateRefs = {
  inProgressRef: MutableRefObject<boolean>;
  pendingDirectionRef: MutableRefObject<RebaseDirection>;
  idleTimerRef: MutableRefObject<number | null>;
};

type DeferredEdgeRebaseSetup = {
  scrollElement: HTMLDivElement;
  rowHeight: number;
  windowRowCount: number;
  windowStart: number;
  maxWindowStart: number;
  rebaseMarginRows: number;
  rebaseIdleMs: number;
  setWindowStart: (nextWindowStart: number) => void;
  stateRefs: DeferredEdgeRebaseStateRefs;
};

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

export function toFunctionProvenanceCode(kind: string): string {
  switch (kind) {
    case "pdb":
      return "pdb";
    case "exception":
      return "exc";
    case "import":
      return "imp";
    case "export":
      return "exp";
    case "entry":
      return "ent";
    default:
      return kind.slice(0, 3).toLowerCase();
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT"
  );
}

function clearDeferredEdgeRebaseIdleTimer(
  idleTimerRef: MutableRefObject<number | null>,
): void {
  if (idleTimerRef.current !== null) {
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  }
}

function resetDeferredEdgeRebaseState(
  stateRefs: DeferredEdgeRebaseStateRefs,
): void {
  stateRefs.inProgressRef.current = false;
  stateRefs.pendingDirectionRef.current = 0;
  clearDeferredEdgeRebaseIdleTimer(stateRefs.idleTimerRef);
}

function setupDeferredEdgeRebase({
  scrollElement,
  rowHeight,
  windowRowCount,
  windowStart,
  maxWindowStart,
  rebaseMarginRows,
  rebaseIdleMs,
  setWindowStart,
  stateRefs,
}: DeferredEdgeRebaseSetup): () => void {
  const supportsScrollEnd = "onscrollend" in scrollElement;

  function detectPendingRebaseDirection(): RebaseDirection {
    const viewportRows = Math.max(
      1,
      Math.ceil(scrollElement.clientHeight / rowHeight),
    );
    const marginRows = Math.min(
      rebaseMarginRows,
      Math.max(viewportRows * 2, Math.floor(windowRowCount / 5)),
    );
    const marginPx = marginRows * rowHeight;
    const maxScrollTop = Math.max(
      0,
      scrollElement.scrollHeight - scrollElement.clientHeight,
    );
    if (maxScrollTop <= 0) {
      return 0;
    }
    if (scrollElement.scrollTop <= marginPx && windowStart > 0) {
      return -1;
    }
    if (
      scrollElement.scrollTop >= maxScrollTop - marginPx &&
      windowStart < maxWindowStart
    ) {
      return 1;
    }
    return 0;
  }

  function applyPendingRebase(): void {
    if (stateRefs.inProgressRef.current) {
      return;
    }
    const direction = stateRefs.pendingDirectionRef.current;
    stateRefs.pendingDirectionRef.current = 0;
    if (direction === 0) {
      return;
    }

    const windowShiftRows = Math.max(1, Math.floor(windowRowCount / 2));
    const shiftRows =
      direction < 0
        ? Math.min(windowShiftRows, windowStart)
        : Math.min(windowShiftRows, maxWindowStart - windowStart);
    if (shiftRows <= 0) {
      return;
    }

    const nextWindowStart =
      direction < 0 ? windowStart - shiftRows : windowStart + shiftRows;
    if (nextWindowStart === windowStart) {
      return;
    }

    stateRefs.inProgressRef.current = true;
    setWindowStart(nextWindowStart);
    const nextScrollTop =
      scrollElement.scrollTop +
      (direction < 0 ? shiftRows : -shiftRows) * rowHeight;
    requestAnimationFrame(() => {
      const maxNextScrollTop = Math.max(
        0,
        scrollElement.scrollHeight - scrollElement.clientHeight,
      );
      scrollElement.scrollTop = clamp(nextScrollTop, 0, maxNextScrollTop);
      stateRefs.inProgressRef.current = false;
    });
  }

  function scheduleDeferredRebase() {
    clearDeferredEdgeRebaseIdleTimer(stateRefs.idleTimerRef);
    stateRefs.idleTimerRef.current = window.setTimeout(() => {
      stateRefs.idleTimerRef.current = null;
      applyPendingRebase();
    }, rebaseIdleMs);
  }

  function handleScroll() {
    if (stateRefs.inProgressRef.current) {
      return;
    }
    stateRefs.pendingDirectionRef.current = detectPendingRebaseDirection();
    if (!supportsScrollEnd) {
      scheduleDeferredRebase();
    }
  }

  function handleScrollEnd() {
    clearDeferredEdgeRebaseIdleTimer(stateRefs.idleTimerRef);
    applyPendingRebase();
  }

  scrollElement.addEventListener("scroll", handleScroll, {
    passive: true,
  });
  if (supportsScrollEnd) {
    scrollElement.addEventListener("scrollend", handleScrollEnd, {
      passive: true,
    });
  }

  return () => {
    clearDeferredEdgeRebaseIdleTimer(stateRefs.idleTimerRef);
    stateRefs.pendingDirectionRef.current = 0;
    scrollElement.removeEventListener("scroll", handleScroll);
    if (supportsScrollEnd) {
      scrollElement.removeEventListener("scrollend", handleScrollEnd);
    }
  };
}

export function App() {
  const [engineStatus, setEngineStatus] = useState<string>("checking");
  const [modulePath, setModulePath] = useState<string>("");
  const [moduleId, setModuleId] = useState<string>("");
  const [entryRva, setEntryRva] = useState<string>("");
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
  const [isGoToModalOpen, setIsGoToModalOpen] = useState(false);
  const [goToInputValue, setGoToInputValue] = useState("");

  const [errorText, setErrorText] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPath, setLoadingPath] = useState<string>("");
  const [isResizing, setIsResizing] = useState(false);
  const [isColumnResizing, setIsColumnResizing] = useState(false);
  const [cacheEpoch, setCacheEpoch] = useState(0);
  const [panelWidths, setPanelWidths] = useState({ left: 268, right: 300 });
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

  useEffect(() => {
    activeModuleIdRef.current = moduleId;
  }, [moduleId]);

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
    setErrorText("");
    setIsLoading(false);
    setLoadingPath("");
    setIsGoToModalOpen(false);
    setGoToInputValue("");
    setModulePath("");
    setModuleId("");
    setEntryRva("");
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

  const functionCount = functions.length;
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

  async function openModuleFromPath(chosenPath: string) {
    setErrorText("");
    setIsLoading(true);
    setLoadingPath(chosenPath);

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
      resetDeferredEdgeRebaseState({
        inProgressRef: functionRebaseInProgressRef,
        pendingDirectionRef: functionPendingRebaseDirectionRef,
        idleTimerRef: functionRebaseIdleTimerRef,
      });
      setFunctionWindowStartIndex(0);
      setLinearInfo(viewInfo);
      setGoToAddress(initialRva);
      setSelectedRowIndex(null);
      setDisassemblyWindowStartRow(0);
      resetSelectionHistory(initialRva);
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

  const openGoToModal = useCallback(() => {
    if (!moduleId) {
      return;
    }
    setGoToInputValue(goToAddress || entryRva || "");
    setIsGoToModalOpen(true);
  }, [moduleId, goToAddress, entryRva]);

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
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && isGoToModalOpen) {
        event.preventDefault();
        setIsGoToModalOpen(false);
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

      if (activePanel !== "disassembly" || !moduleId || isGoToModalOpen) {
        return;
      }

      event.preventDefault();
      openGoToModal();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePanel, moduleId, isGoToModalOpen, openGoToModal]);

  async function handleGoToSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = goToInputValue.trim();
    if (!target) {
      return;
    }
    const navigated = await navigateToRva(target);
    if (navigated) {
      setIsGoToModalOpen(false);
    }
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
        <section
          className={`panel panel-nav ${
            activePanel === "browser" ? "is-panel-active" : ""
          }`}
          onPointerDown={() => setActivePanel("browser")}
          onWheel={() => setActivePanel("browser")}
          onFocusCapture={() => setActivePanel("browser")}
        >
          <header className="panel-header">
            <h2>Browser</h2>
            <span>{moduleId ? `${functions.length} functions` : ""}</span>
          </header>
          <div className="panel-body">
            <div className="function-scroll-region" ref={functionScrollRef}>
              <ul
                className="function-list"
                style={{ height: `${functionRowVirtualizer.getTotalSize()}px` }}
              >
                {functionVirtualItems.map((virtualRow) => {
                  const logicalFunctionIndex =
                    boundedFunctionWindowStart + virtualRow.index;
                  const func = functions[logicalFunctionIndex];
                  if (!func) {
                    return null;
                  }
                  return (
                    <li
                      className="function-row"
                      key={`${func.kind}-${func.start}-${logicalFunctionIndex}`}
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <Button
                        className={cn(
                          "function-link",
                          func.start === goToAddress && "is-active",
                        )}
                        variant="ghost"
                        type="button"
                        onClick={() => void navigateToRva(func.start)}
                      >
                        <span
                          className={cn(
                            "function-meta",
                            `function-meta-${func.kind}`,
                          )}
                        >
                          {toFunctionProvenanceCode(func.kind)}
                        </span>
                        <span className="function-name">{func.name}</span>
                        <code>{func.start}</code>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
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

        <section
          className={`panel panel-disassembly ${
            activePanel === "disassembly" ? "is-panel-active" : ""
          }`}
          onPointerDown={() => setActivePanel("disassembly")}
          onWheel={() => setActivePanel("disassembly")}
          onFocusCapture={() => setActivePanel("disassembly")}
        >
          <header className="panel-header">
            <h2>Disassembly</h2>
            <span>
              {moduleId && linearInfo ? `${linearInfo.rowCount} rows` : ""}
            </span>
          </header>
          <div className="panel-body table-body" style={disassemblyColumnStyle}>
            <div className="disassembly-columns-header">
              <div className="column-header-cell">
                <span>Section</span>
                <Button
                  className="column-resizer"
                  size="icon"
                  variant="ghost"
                  aria-label="Resize Section column"
                  onPointerDown={(event) =>
                    startColumnResizing("section", event)
                  }
                />
              </div>
              <div className="column-header-cell">
                <span>Address</span>
                <Button
                  className="column-resizer"
                  size="icon"
                  variant="ghost"
                  aria-label="Resize Address column"
                  onPointerDown={(event) =>
                    startColumnResizing("address", event)
                  }
                />
              </div>
              <div className="column-header-cell">
                <span>Bytes</span>
                <Button
                  className="column-resizer"
                  size="icon"
                  variant="ghost"
                  aria-label="Resize Bytes column"
                  onPointerDown={(event) => startColumnResizing("bytes", event)}
                />
              </div>
              <div className="column-header-cell">
                <span>Instruction</span>
                <Button
                  className="column-resizer"
                  size="icon"
                  variant="ghost"
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
                  const logicalRowIndex =
                    boundedDisassemblyWindowStart + virtualRow.index;
                  const row = readRow(logicalRowIndex);
                  const top = virtualRow.start;

                  if (!row) {
                    return (
                      <div
                        key={`loading-${logicalRowIndex}`}
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
                      key={`${logicalRowIndex}-${cacheEpoch}-${row.address}`}
                      className={`disassembly-row kind-${row.kind} ${
                        selectedRowIndex === logicalRowIndex ? "is-current" : ""
                      }`}
                      style={{ transform: `translateY(${top}px)` }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) {
                          return;
                        }
                        setSelectedRowIndex(logicalRowIndex);
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
                        <span
                          className={`mnemonic mnemonic-${
                            row.instructionCategory ?? "other"
                          }`}
                        >
                          {row.mnemonic}
                        </span>
                        {row.operands ? (
                          <span className="operands">{row.operands}</span>
                        ) : null}
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

        <section
          className={`panel panel-inspector ${
            activePanel === "inspector" ? "is-panel-active" : ""
          }`}
          onPointerDown={() => setActivePanel("inspector")}
          onWheel={() => setActivePanel("inspector")}
          onFocusCapture={() => setActivePanel("inspector")}
        >
          <header className="panel-header">
            <h2>Inspector</h2>
            <span>{moduleId}</span>
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
            <Separator />
            <h3>Sections</h3>
            <ScrollArea className="h-full">
              <ul className="section-list">
                {sections.map((section) => (
                  <li key={`${section.name}-${section.startRva}`}>
                    <Button
                      className={cn(
                        "section-link",
                        goToAddress === section.startRva && "is-active",
                      )}
                      variant="ghost"
                      type="button"
                      onClick={() => void navigateToRva(section.startRva)}
                    >
                      <code>{section.name}</code>
                      <span>
                        {section.startRva} - {section.endRva}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        </section>
      </main>

      <footer className="status-bar">
        <Badge className={`engine-state ${engineStateClass}`} variant="outline">
          Engine {engineStatus}
        </Badge>
        <div className="status-spacer" />
        <ModeToggle />
      </footer>

      <Dialog open={isLoading}>
        <DialogContent
          className="loading-modal"
          overlayClassName="loading-modal-overlay"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="loading-header">
            <div aria-hidden="true" className="loading-spinner" />
            <DialogTitle className="loading-title">Loading File</DialogTitle>
          </DialogHeader>
          <DialogHeader className="loading-copy">
            <DialogDescription className="loading-description">
              The selected file is being loaded and analyzed. Please wait.
            </DialogDescription>
          </DialogHeader>
          <code className="loading-path">{loadingPath}</code>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setIsGoToModalOpen} open={isGoToModalOpen}>
        <DialogContent className="go-to-modal">
          <DialogHeader>
            <DialogTitle className="go-to-title">Go To Address</DialogTitle>
          </DialogHeader>
          <form
            className="go-to-form"
            onSubmit={(event) => {
              void handleGoToSubmit(event);
            }}
          >
            <Input
              ref={goToInputRef}
              value={goToInputValue}
              onChange={(event) => setGoToInputValue(event.target.value)}
              placeholder="0x140001000"
            />
            <DialogFooter className="go-to-modal-actions">
              <Button
                onClick={() => setIsGoToModalOpen(false)}
                type="button"
                variant="outline"
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!moduleId || isLoading}>
                Jump
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
