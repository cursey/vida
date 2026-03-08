import { clamp } from "@/lib/number-utils";
import {
  type CSSProperties,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type DragState = {
  startX: number;
  startLeft: number;
};

export type DisassemblyColumn = "section" | "address" | "bytes" | "instruction";

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
  section: 72,
  address: 90,
  bytes: 120,
  instruction: 120,
};

export function usePanelLayout() {
  const [isResizing, setIsResizing] = useState(false);
  const [isColumnResizing, setIsColumnResizing] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(268);
  const [disassemblyColumnWidths, setDisassemblyColumnWidths] = useState({
    section: 88,
    address: 110,
    bytes: 180,
    instruction: 420,
  });

  const layoutRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const columnDragStateRef = useRef<ColumnDragState | null>(null);

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

  return {
    disassemblyColumnStyle,
    isColumnResizing,
    isResizing,
    layoutRef,
    layoutStyle,
    startColumnResizing,
    startResizing,
  };
}
