import { vi } from "vitest";
import type { DesktopApi } from "../../shared";

export function createMockDesktopApi(
  overrides: Partial<DesktopApi> = {},
): DesktopApi {
  return {
    pickExecutable: vi.fn().mockResolvedValue(null),
    onMenuOpenExecutable: vi.fn(() => () => {}),
    onMenuOpenRecentExecutable: vi.fn(() => () => {}),
    onMenuUnloadModule: vi.fn(() => () => {}),
    onDragEnter: vi.fn(() => () => {}),
    onDragLeave: vi.fn(() => () => {}),
    onDragDrop: vi.fn(() => () => {}),
    addRecentExecutable: vi.fn().mockResolvedValue(undefined),
    getWindowChromeState: vi.fn().mockResolvedValue({
      useCustomChrome: true,
      platform: "win32",
      isMaximized: false,
      isFocused: true,
    }),
    onWindowChromeStateChanged: vi.fn(() => () => {}),
    windowControl: vi.fn().mockResolvedValue(undefined),
    getTitleBarMenuModel: vi.fn().mockResolvedValue({ menus: [] }),
    onTitleBarMenuModelChanged: vi.fn(() => () => {}),
    invokeTitleBarMenuAction: vi.fn().mockResolvedValue(undefined),
    openModule: vi.fn().mockResolvedValue({
      moduleId: "m1",
      arch: "x64",
      imageBase: "0x140000000",
      entryVa: "0x140001000",
    }),
    unloadModule: vi.fn().mockResolvedValue({}),
    getModuleAnalysisStatus: vi.fn().mockResolvedValue({
      state: "ready",
      message: "Analysis ready.",
      discoveredFunctionCount: 0,
      totalFunctionCount: 0,
      analyzedFunctionCount: 0,
    }),
    getModuleInfo: vi.fn().mockResolvedValue({
      sections: [],
      imports: [],
      exports: [],
    }),
    getModuleMemoryOverview: vi.fn().mockResolvedValue({
      startVa: "0x0",
      endVa: "0x0",
      slices: [],
    }),
    listFunctions: vi.fn().mockResolvedValue({ functions: [] }),
    getFunctionGraphByVa: vi.fn().mockResolvedValue({
      functionStartVa: "0x140001000",
      functionName: "sub_140001000",
      focusBlockId: "b_1000",
      blocks: [
        {
          id: "b_1000",
          startVa: "0x140001000",
          endVa: "0x140001003",
          isEntry: true,
          isExit: true,
          instructions: [
            {
              address: "0x140001000",
              mnemonic: "ret",
              operands: "",
              instructionCategory: "return",
            },
          ],
        },
      ],
      edges: [],
    }),
    getXrefsToVa: vi.fn().mockResolvedValue({
      targetVa: "0x140001000",
      xrefs: [],
    }),
    disassembleLinear: vi.fn().mockResolvedValue({
      instructions: [],
      stopReason: "end_of_data",
    }),
    getLinearViewInfo: vi.fn().mockResolvedValue({
      rowCount: 0,
      minVa: "0x0",
      maxVa: "0x0",
      rowHeight: 24,
      dataGroupSize: 16,
    }),
    getLinearRows: vi.fn().mockResolvedValue({ rows: [] }),
    findLinearRowByVa: vi.fn().mockResolvedValue({ rowIndex: 0 }),
    ...overrides,
  };
}
