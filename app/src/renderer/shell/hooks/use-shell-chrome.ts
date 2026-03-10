import { desktopApi } from "@/platform/desktop-api";
import { useCallback, useEffect, useState } from "react";
import type {
  TitleBarMenuModel,
  WindowChromeState,
  WindowControlAction,
} from "../../../shared";

type UseShellChromeOptions = {
  clearErrorDialog: () => void;
  onOpenExecutable: () => void;
  onOpenRecentExecutable: (path: string) => void;
  onUnloadModule: () => void;
  showErrorDialog: (title: string, message: string) => void;
};

export function useShellChrome({
  clearErrorDialog,
  onOpenExecutable,
  onOpenRecentExecutable,
  onUnloadModule,
  showErrorDialog,
}: UseShellChromeOptions) {
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

  useEffect(() => {
    let isMounted = true;

    void Promise.all([
      desktopApi.getWindowChromeState(),
      desktopApi.getTitleBarMenuModel(),
    ])
      .then(([chromeState, menuModel]) => {
        if (!isMounted) {
          return;
        }

        setWindowChromeState(chromeState);
        setTitleBarMenuModel(menuModel);
      })
      .catch((error: unknown) => {
        showErrorDialog(
          "Load Window Chrome Failed",
          error instanceof Error
            ? error.message
            : "Failed to load window chrome state",
        );
      });

    const unsubscribeChrome = desktopApi.onWindowChromeStateChanged((state) => {
      setWindowChromeState(state);
    });
    const unsubscribeMenu = desktopApi.onTitleBarMenuModelChanged((model) => {
      setTitleBarMenuModel(model);
    });

    return () => {
      isMounted = false;
      unsubscribeChrome();
      unsubscribeMenu();
    };
  }, [showErrorDialog]);

  useEffect(() => {
    const unsubscribe = desktopApi.onMenuOpenExecutable(() => {
      onOpenExecutable();
    });

    return () => {
      unsubscribe();
    };
  }, [onOpenExecutable]);

  useEffect(() => {
    const unsubscribe = desktopApi.onMenuOpenRecentExecutable(
      (selectedPath) => {
        clearErrorDialog();
        onOpenRecentExecutable(selectedPath);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [clearErrorDialog, onOpenRecentExecutable]);

  useEffect(() => {
    const unsubscribe = desktopApi.onMenuUnloadModule(() => {
      onUnloadModule();
    });

    return () => {
      unsubscribe();
    };
  }, [onUnloadModule]);

  const handleWindowControl = useCallback(
    (action: WindowControlAction) => {
      void desktopApi.windowControl(action).catch((error: unknown) => {
        showErrorDialog(
          "Window Control Failed",
          error instanceof Error ? error.message : "Window control failed",
        );
      });
    },
    [showErrorDialog],
  );

  const handleInvokeTitleBarMenuAction = useCallback(
    (commandId: string) => {
      void desktopApi
        .invokeTitleBarMenuAction(commandId)
        .catch((error: unknown) => {
          showErrorDialog(
            "Menu Action Failed",
            error instanceof Error ? error.message : "Menu action failed",
          );
        });
    },
    [showErrorDialog],
  );

  return {
    handleInvokeTitleBarMenuAction,
    handleWindowControl,
    titleBarMenuModel,
    windowChromeState,
  };
}
