import type { MutableRefObject } from "react";
import { clamp } from "./number-utils";

type RebaseDirection = -1 | 0 | 1;

export type DeferredEdgeRebaseStateRefs = {
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

export function clearDeferredEdgeRebaseIdleTimer(
  idleTimerRef: MutableRefObject<number | null>,
): void {
  if (idleTimerRef.current !== null) {
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  }
}

export function resetDeferredEdgeRebaseState(
  stateRefs: DeferredEdgeRebaseStateRefs,
): void {
  stateRefs.inProgressRef.current = false;
  stateRefs.pendingDirectionRef.current = 0;
  clearDeferredEdgeRebaseIdleTimer(stateRefs.idleTimerRef);
}

export function setupDeferredEdgeRebase({
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
