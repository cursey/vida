import { BrowserPanel } from "@/features/browser/browser-panel";
import { DisassemblyPanel } from "@/features/disassembly/disassembly-panel";
import { MemoryOverviewBar } from "@/features/disassembly/memory-overview-bar";
import { GraphPanel } from "@/features/graph/graph-panel";
import { isEditableTarget } from "@/lib/dom-utils";
import { clamp, makePageKey, parseHexVa } from "@/lib/number-utils";
import { cn } from "@/lib/utils";
import { desktopApi } from "@/platform/desktop-api";
import { GoToDialog, XrefsDialog } from "@/shell/components/app-dialogs";
import { AppStatusBar } from "@/shell/components/status-bar";
import { WindowChrome } from "@/shell/components/window-chrome";
import { usePanelLayout } from "@/shell/hooks/use-panel-layout";
import { useShellChrome } from "@/shell/hooks/use-shell-chrome";
import { navigateFromDisassemblyOperand } from "@/shell/operand-navigation";
import {
  resetDeferredEdgeRebaseState,
  setupDeferredEdgeRebase,
} from "@/shell/utils/deferred-edge-rebase";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type FormEvent,
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
  XrefRecord,
} from "../../shared";

type ActivePanel = "browser" | "disassembly";
type CenterView = "disassembly" | "graph";

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

export function App() {
  const [modulePath, setModulePath] = useState<string>("");
  const [moduleId, setModuleId] = useState<string>("");
  const [entryVa, setEntryVa] = useState<string>("");
  const [goToAddress, setGoToAddress] = useState<string>("");
  const [functions, setFunctions] = useState<FunctionSeed[]>([]);
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [memoryOverview, setMemoryOverview] = useState<
    MethodResult["module.getMemoryOverview"] | null
  >(null);
  const [analysisStatus, setAnalysisStatus] = useState<
    MethodResult["module.getAnalysisStatus"] | null
  >(null);
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
  const [isXrefsModalOpen, setIsXrefsModalOpen] = useState(false);
  const [xrefsTargetVa, setXrefsTargetVa] = useState("");
  const [xrefs, setXrefs] = useState<XrefRecord[]>([]);
  const [goToInputValue, setGoToInputValue] = useState("");
  const [isBrowserSearchVisible, setIsBrowserSearchVisible] = useState(false);
  const [functionSearchQuery, setFunctionSearchQuery] = useState("");
  const [searchedFunctionIndexes, setSearchedFunctionIndexes] = useState<
    number[] | null
  >(null);
  const [appliedFunctionSearchQuery, setAppliedFunctionSearchQuery] =
    useState("");
  const [isSearchingFunctions, setIsSearchingFunctions] = useState(false);
  const [isBuildingGraph, setIsBuildingGraph] = useState(false);
  const [isLoadingXrefs, setIsLoadingXrefs] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const [errorText, setErrorText] = useState<string>("");
  const [transientStatusMessage, setTransientStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [cacheEpoch, setCacheEpoch] = useState(0);
  const [functionWindowStartIndex, setFunctionWindowStartIndex] = useState(0);
  const [disassemblyWindowStartRow, setDisassemblyWindowStartRow] = useState(0);

  const {
    disassemblyColumnStyle,
    isColumnResizing,
    isResizing,
    layoutRef,
    layoutStyle,
    startColumnResizing,
    startResizing,
  } = usePanelLayout();
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
  const asyncGenerationRef = useRef(0);
  const analysisPollTimerRef = useRef<number | null>(null);
  const readySupplementTimerRef = useRef<number | null>(null);
  const preferredNavigationVaRef = useRef("");
  const selectionHistoryRef = useRef<string[]>([]);
  const selectionHistoryIndexRef = useRef(-1);
  const functionSearchJobIdRef = useRef(0);
  const statusMessageTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeModuleIdRef.current = moduleId;
  }, [moduleId]);

  useEffect(() => {
    return () => {
      if (analysisPollTimerRef.current !== null) {
        window.clearTimeout(analysisPollTimerRef.current);
        analysisPollTimerRef.current = null;
      }
      if (readySupplementTimerRef.current !== null) {
        window.clearTimeout(readySupplementTimerRef.current);
        readySupplementTimerRef.current = null;
      }
      if (statusMessageTimerRef.current !== null) {
        window.clearTimeout(statusMessageTimerRef.current);
        statusMessageTimerRef.current = null;
      }
    };
  }, []);

  const fetchLinearPage = useCallback(
    async (currentModuleId: string, page: number) => {
      if (
        pageCacheRef.current.has(page) ||
        inflightPagesRef.current.has(page)
      ) {
        return;
      }

      inflightPagesRef.current.add(page);

      try {
        const payload = {
          moduleId: currentModuleId,
          startRow: page * PAGE_SIZE,
          rowCount: PAGE_SIZE,
        };
        const response = await desktopApi.getLinearRows(payload);
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
    },
    [],
  );

  useEffect(() => {
    document.title = modulePath ? `${modulePath} - V.ıDA Pro` : "V.ıDA Pro";
  }, [modulePath]);

  const stopAnalysisPolling = useCallback(() => {
    if (analysisPollTimerRef.current !== null) {
      window.clearTimeout(analysisPollTimerRef.current);
      analysisPollTimerRef.current = null;
    }
  }, []);

  const resetLinearCache = useCallback(() => {
    pageCacheRef.current.clear();
    inflightPagesRef.current.clear();
    resetDeferredEdgeRebaseState({
      inProgressRef: disassemblyRebaseInProgressRef,
      pendingDirectionRef: disassemblyPendingRebaseDirectionRef,
      idleTimerRef: disassemblyRebaseIdleTimerRef,
    });
    setCacheEpoch((value) => value + 1);
  }, []);

  const resetSelectionHistory = useCallback(
    (initialVa: string | null = null) => {
      selectionHistoryRef.current = [];
      selectionHistoryIndexRef.current = -1;

      if (!initialVa) {
        return;
      }

      selectionHistoryRef.current.push(initialVa);
      selectionHistoryIndexRef.current = 0;
    },
    [],
  );

  const clearModuleState = useCallback(() => {
    functionSearchJobIdRef.current += 1;
    stopAnalysisPolling();
    if (readySupplementTimerRef.current !== null) {
      window.clearTimeout(readySupplementTimerRef.current);
      readySupplementTimerRef.current = null;
    }
    if (statusMessageTimerRef.current !== null) {
      window.clearTimeout(statusMessageTimerRef.current);
      statusMessageTimerRef.current = null;
    }
    preferredNavigationVaRef.current = "";
    activeModuleIdRef.current = "";
    setTransientStatusMessage("");
    setIsLoading(false);
    setIsGoToModalOpen(false);
    setIsXrefsModalOpen(false);
    setXrefsTargetVa("");
    setXrefs([]);
    setGoToInputValue("");
    setIsBrowserSearchVisible(false);
    setFunctionSearchQuery("");
    setSearchedFunctionIndexes(null);
    setAppliedFunctionSearchQuery("");
    setIsSearchingFunctions(false);
    setIsBuildingGraph(false);
    setIsLoadingXrefs(false);
    setModulePath("");
    setModuleId("");
    setEntryVa("");
    setSections([]);
    setMemoryOverview(null);
    setFunctions([]);
    setAnalysisStatus(null);
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
  }, [resetLinearCache, resetSelectionHistory, stopAnalysisPolling]);

  const unloadCurrentModule = useCallback(async () => {
    const generation = ++asyncGenerationRef.current;
    const currentModuleId = activeModuleIdRef.current;
    setErrorText("");
    clearModuleState();
    if (!currentModuleId) {
      return;
    }

    try {
      await desktopApi.unloadModule(currentModuleId);
    } catch (error: unknown) {
      if (generation !== asyncGenerationRef.current) {
        return;
      }
      setErrorText(
        error instanceof Error ? error.message : "Failed to unload module",
      );
    }
  }, [clearModuleState]);

  useEffect(() => {
    const unlistenDragEnter = desktopApi.onDragEnter(() => {
      setIsDraggingFile(true);
    });
    const unlistenDragLeave = desktopApi.onDragLeave(() => {
      setIsDraggingFile(false);
    });
    const unlistenDragDrop = desktopApi.onDragDrop((payload) => {
      setIsDraggingFile(false);
      if (payload.paths.length > 0) {
        void openModuleFromPath(payload.paths[0]);
      }
    });

    return () => {
      unlistenDragEnter();
      unlistenDragLeave();
      unlistenDragDrop();
    };
  }, []);

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
  const discoveredFunctionCount =
    analysisStatus?.discoveredFunctionCount ?? totalFunctionCount;
  const functionCount =
    displayedFunctionIndexes === null
      ? totalFunctionCount
      : displayedFunctionIndexes.length;
  const moduleAnalysisMessage =
    moduleId && analysisStatus && analysisStatus.state !== "ready"
      ? analysisStatus.message
      : "";
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
    fetchLinearPage,
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

  const readRow = useCallback((index: number): LinearRow | undefined => {
    const page = makePageKey(index, PAGE_SIZE);
    const pageRows = pageCacheRef.current.get(page);
    if (!pageRows) {
      return undefined;
    }

    return pageRows[index % PAGE_SIZE];
  }, []);

  const visibleViewportMarkerVa = useMemo(() => {
    if (!memoryOverview) {
      return null;
    }

    if (virtualItems.length > 0) {
      const startVa = parseHexVa(readRow(visibleStart)?.address ?? "");
      const endVa = parseHexVa(readRow(visibleEnd)?.address ?? "");
      if (startVa !== null && endVa !== null) {
        return Math.floor((startVa + endVa) / 2);
      }
    }

    return parseHexVa(goToAddress);
  }, [
    goToAddress,
    memoryOverview,
    readRow,
    virtualItems.length,
    visibleEnd,
    visibleStart,
  ]);

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
      setIsBuildingGraph(true);
      const graph = await desktopApi.getFunctionGraphByVa({
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
    } finally {
      setIsBuildingGraph(false);
    }
  }, [
    activePanel,
    centerView,
    fetchLinearPage,
    moduleId,
    readRow,
    selectedRowIndex,
    showTransientStatusMessage,
  ]);

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

  const applyReadyModuleAnalysis = useCallback(
    async (
      currentModuleId: string,
      fallbackVa: string,
      generation: number,
    ): Promise<boolean> => {
      const targetVa = preferredNavigationVaRef.current || fallbackVa;
      const viewInfo = await desktopApi.getLinearViewInfo(currentModuleId);
      if (
        generation !== asyncGenerationRef.current ||
        currentModuleId !== activeModuleIdRef.current
      ) {
        return false;
      }

      const rowLookup = await desktopApi.findLinearRowByVa({
        moduleId: currentModuleId,
        va: targetVa,
      });
      if (
        generation !== asyncGenerationRef.current ||
        currentModuleId !== activeModuleIdRef.current
      ) {
        return false;
      }

      setLinearInfo(viewInfo);
      setGoToAddress(targetVa);
      setSelectedRowIndex(null);
      setDisassemblyWindowStartRow(0);
      setCenterView("disassembly");
      setGraphData(null);
      resetSelectionHistory(targetVa);
      resetLinearCache();
      setPendingScrollRow(rowLookup.rowIndex);
      stopAnalysisPolling();
      readySupplementTimerRef.current = window.setTimeout(() => {
        readySupplementTimerRef.current = null;

        void desktopApi
          .listFunctions(currentModuleId)
          .then((listed) => {
            if (
              generation !== asyncGenerationRef.current ||
              currentModuleId !== activeModuleIdRef.current
            ) {
              return;
            }

            setFunctions(listed.functions);
            resetFunctionBrowserViewport();
          })
          .catch((error: unknown) => {
            if (
              generation !== asyncGenerationRef.current ||
              currentModuleId !== activeModuleIdRef.current
            ) {
              return;
            }

            console.warn("Failed to load function list:", error);
          });

        void desktopApi
          .getModuleMemoryOverview(currentModuleId)
          .then((overview) => {
            if (
              generation !== asyncGenerationRef.current ||
              currentModuleId !== activeModuleIdRef.current
            ) {
              return;
            }

            setMemoryOverview(overview);
          })
          .catch((error: unknown) => {
            if (
              generation !== asyncGenerationRef.current ||
              currentModuleId !== activeModuleIdRef.current
            ) {
              return;
            }

            console.warn("Failed to load memory overview:", error);
          });
      }, 0);
      return true;
    },
    [
      resetFunctionBrowserViewport,
      resetLinearCache,
      resetSelectionHistory,
      stopAnalysisPolling,
    ],
  );

  const startAnalysisPolling = useCallback(
    (currentModuleId: string, fallbackVa: string, generation: number) => {
      stopAnalysisPolling();

      const poll = async () => {
        try {
          const status =
            await desktopApi.getModuleAnalysisStatus(currentModuleId);
          if (
            generation !== asyncGenerationRef.current ||
            currentModuleId !== activeModuleIdRef.current
          ) {
            return;
          }

          setAnalysisStatus(status);

          if (status.state === "ready") {
            await applyReadyModuleAnalysis(
              currentModuleId,
              fallbackVa,
              generation,
            );
            return;
          }

          if (status.state === "failed") {
            stopAnalysisPolling();
            setErrorText(status.message);
            return;
          }

          if (status.state === "canceled") {
            stopAnalysisPolling();
            return;
          }

          analysisPollTimerRef.current = window.setTimeout(() => {
            void poll();
          }, 200);
        } catch (error: unknown) {
          if (
            generation !== asyncGenerationRef.current ||
            currentModuleId !== activeModuleIdRef.current
          ) {
            return;
          }

          stopAnalysisPolling();
          setErrorText(
            error instanceof Error
              ? error.message
              : "Failed to poll module analysis status",
          );
        }
      };

      void poll();
    },
    [applyReadyModuleAnalysis, stopAnalysisPolling],
  );

  const openModuleFromPath = useCallback(
    async (chosenPath: string) => {
      const generation = ++asyncGenerationRef.current;
      const previousModuleId = activeModuleIdRef.current;
      setErrorText("");
      clearModuleState();
      setIsLoading(true);

      try {
        if (previousModuleId) {
          await desktopApi.unloadModule(previousModuleId);
          if (generation !== asyncGenerationRef.current) {
            return;
          }
        }

        const opened = await desktopApi.openModule(chosenPath);
        if (generation !== asyncGenerationRef.current) {
          await desktopApi.unloadModule(opened.moduleId).catch(() => {});
          return;
        }

        const info = await desktopApi.getModuleInfo(opened.moduleId);
        if (generation !== asyncGenerationRef.current) {
          await desktopApi.unloadModule(opened.moduleId).catch(() => {});
          return;
        }

        preferredNavigationVaRef.current = opened.entryVa;
        activeModuleIdRef.current = opened.moduleId;
        setModulePath(chosenPath);
        setModuleId(opened.moduleId);
        setEntryVa(opened.entryVa);
        setSections(info.sections);
        setGoToAddress(opened.entryVa);
        setAnalysisStatus({
          state: "queued",
          message: "Queued analysis...",
          discoveredFunctionCount: 0,
        });
        void desktopApi.addRecentExecutable(chosenPath).catch((error) => {
          console.warn("Failed to add executable to recent list:", error);
        });
        startAnalysisPolling(opened.moduleId, opened.entryVa, generation);
      } catch (error: unknown) {
        setErrorText(
          error instanceof Error ? error.message : "Failed to open executable",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [clearModuleState, startAnalysisPolling],
  );

  const openExecutableFromPicker = useCallback(async () => {
    setErrorText("");
    const chosenPath = await desktopApi.pickExecutable();
    if (!chosenPath) {
      return;
    }
    await openModuleFromPath(chosenPath);
  }, [openModuleFromPath]);

  const handleMenuOpenExecutable = useCallback(() => {
    void openExecutableFromPicker();
  }, [openExecutableFromPicker]);

  const handleMenuOpenRecentExecutable = useCallback(
    (path: string) => {
      void openModuleFromPath(path);
    },
    [openModuleFromPath],
  );

  const handleMenuUnloadModule = useCallback(() => {
    void unloadCurrentModule();
  }, [unloadCurrentModule]);

  const {
    handleInvokeTitleBarMenuAction,
    handleWindowControl,
    titleBarMenuModel,
    windowChromeState,
  } = useShellChrome({
    onOpenExecutable: handleMenuOpenExecutable,
    onOpenRecentExecutable: handleMenuOpenRecentExecutable,
    onUnloadModule: handleMenuUnloadModule,
    setErrorText,
  });

  const navigateToVa = useCallback(
    async (
      va: string,
      options: { recordHistory?: boolean } = { recordHistory: true },
    ) => {
      if (!moduleId) {
        return false;
      }

      setErrorText("");
      preferredNavigationVaRef.current = va;

      if (!linearInfo) {
        setGoToAddress(va);
        showTransientStatusMessage("Disassembly is still being prepared.");
        return false;
      }

      try {
        const found = await desktopApi.findLinearRowByVa({
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
    [linearInfo, moduleId, pushSelectionHistory, showTransientStatusMessage],
  );

  const handleMemoryOverviewNavigate = useCallback(
    (va: string) => {
      void navigateToVa(va);
    },
    [navigateToVa],
  );

  const handleDisassemblyOperandNavigate = useCallback(
    async (sourceVa: string, targetVa: string) =>
      navigateFromDisassemblyOperand(
        sourceVa,
        targetVa,
        pushSelectionHistory,
        navigateToVa,
      ),
    [navigateToVa, pushSelectionHistory],
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

  const openXrefsForSelection = useCallback(async () => {
    if (
      !moduleId ||
      activePanel !== "disassembly" ||
      centerView !== "disassembly"
    ) {
      return;
    }

    if (selectedRowIndex === null) {
      showTransientStatusMessage(
        "Select a row in Disassembly before listing xrefs.",
      );
      return;
    }

    let selectedRow = readRow(selectedRowIndex);
    if (!selectedRow) {
      await fetchLinearPage(moduleId, makePageKey(selectedRowIndex, PAGE_SIZE));
      selectedRow = readRow(selectedRowIndex);
    }
    if (!selectedRow) {
      showTransientStatusMessage("The highlighted VA is not available yet.");
      return;
    }

    try {
      setIsLoadingXrefs(true);
      const result = await desktopApi.getXrefsToVa({
        moduleId,
        va: selectedRow.address,
      });
      if (result.xrefs.length === 0) {
        showTransientStatusMessage(
          "No xrefs are available for the highlighted VA.",
        );
        return;
      }
      setErrorText("");
      setXrefsTargetVa(result.targetVa);
      setXrefs(result.xrefs);
      setIsXrefsModalOpen(true);
    } catch (error: unknown) {
      setErrorText(
        error instanceof Error ? error.message : "Failed to load xrefs",
      );
    } finally {
      setIsLoadingXrefs(false);
    }
  }, [
    activePanel,
    centerView,
    fetchLinearPage,
    moduleId,
    readRow,
    selectedRowIndex,
    showTransientStatusMessage,
  ]);

  const navigateToXref = useCallback(
    (xref: XrefRecord) => {
      void navigateToVa(xref.sourceVa).then((navigated) => {
        if (navigated) {
          setIsXrefsModalOpen(false);
        }
      });
    },
    [navigateToVa],
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
      if (event.key === "Escape" && isXrefsModalOpen) {
        event.preventDefault();
        setIsXrefsModalOpen(false);
        return;
      }

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

      if (event.key.toLowerCase() === "x" && !event.repeat) {
        if (event.ctrlKey || event.metaKey || event.altKey) {
          return;
        }
        if (
          isEditableTarget(event.target) ||
          isGoToModalOpen ||
          isXrefsModalOpen ||
          !moduleId
        ) {
          return;
        }
        if (activePanel !== "disassembly" || centerView !== "disassembly") {
          return;
        }

        event.preventDefault();
        void openXrefsForSelection();
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
    isXrefsModalOpen,
    moduleId,
    isGoToModalOpen,
    openXrefsForSelection,
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

  const hasLoadedModule = moduleId.length > 0;
  const hasCompletedAnalysis =
    hasLoadedModule && analysisStatus?.state === "ready";

  return (
    <div
      className={cn(
        "flex h-screen min-h-0 flex-col gap-0 overflow-hidden p-2",
        (isResizing || isColumnResizing) && "cursor-col-resize select-none",
      )}
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
      {errorText ? (
        <div className="rounded-md border border-destructive bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive-foreground">
          {errorText}
        </div>
      ) : null}
      {hasCompletedAnalysis ? (
        <MemoryOverviewBar
          overview={memoryOverview}
          markerVa={visibleViewportMarkerVa}
          onNavigate={handleMemoryOverviewNavigate}
        />
      ) : null}
      {isDraggingFile ? (
        <div className="pointer-events-none fixed inset-4 z-50 flex items-center justify-center rounded-lg border border-dashed border-primary/70 bg-background/85">
          <span className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
            Drop an executable to open it
          </span>
        </div>
      ) : null}

      <main
        className="-mx-2 grid flex-1 min-h-0 overflow-hidden"
        ref={layoutRef}
        style={{
          ...layoutStyle,
          gridTemplateColumns:
            "var(--left-panel-width, 268px) var(--splitter-width) minmax(420px, 1fr)",
        }}
      >
        {hasCompletedAnalysis ? (
          <>
            <BrowserPanel
              isActive={activePanel === "browser"}
              moduleId={moduleId}
              showFunctionCount={
                analysisStatus?.state === "ready" && functions.length > 0
              }
              appliedFunctionSearchQuery={appliedFunctionSearchQuery}
              functionCount={functionCount}
              totalFunctionCount={discoveredFunctionCount}
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
              className="col-[2] z-[2] mx-[-4px] min-h-0 min-w-2 w-2 justify-self-center border-0 bg-transparent cursor-col-resize"
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
                isReady={Boolean(linearInfo)}
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
                onNavigateToOperandTarget={handleDisassemblyOperandNavigate}
              />
            ) : (
              <GraphPanel
                isActive={activePanel === "disassembly"}
                moduleId={moduleId}
                graph={graphData}
                onActivate={() => setActivePanel("disassembly")}
              />
            )}
          </>
        ) : hasLoadedModule || isLoading ? (
          <div className="col-[1/4] flex items-center justify-center">
            <div
              aria-label="Loading workspace"
              className="size-8 rounded-full border-2 border-border border-t-primary animate-[loading-spin_700ms_linear_infinite]"
              data-testid="workspace-loading-spinner"
              role="status"
            />
          </div>
        ) : (
          <div className="col-[1/4] flex items-center justify-center px-6 text-center">
            <p
              className="max-w-md text-sm text-muted-foreground"
              data-testid="workspace-idle-message"
            >
              Load a file to begin exploring.
            </p>
          </div>
        )}
      </main>

      <AppStatusBar
        isSearchingFunctions={isSearchingFunctions}
        isBuildingGraph={isBuildingGraph}
        analysisMessage={moduleAnalysisMessage}
        transientMessage={transientStatusMessage}
      />

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

      <XrefsDialog
        isOpen={isXrefsModalOpen}
        isLoading={isLoadingXrefs}
        targetVa={xrefsTargetVa}
        xrefs={xrefs}
        onOpenChange={setIsXrefsModalOpen}
        onNavigateToXref={navigateToXref}
      />
    </div>
  );
}
