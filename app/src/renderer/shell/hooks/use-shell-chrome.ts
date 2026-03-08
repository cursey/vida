import { desktopApi } from "@/platform/desktop-api";
import { useCallback, useEffect, useState } from "react";
import type {
  TitleBarMenuModel,
  WindowChromeState,
  WindowControlAction,
} from "../../../shared";

type UseShellChromeOptions = {
  onOpenExecutable: () => void;
  onOpenRecentExecutable: (path: string) => void;
  onUnloadModule: () => void;
  setErrorText: (message: string) => void;
};

export function useShellChrome({
  onOpenExecutable,
  onOpenRecentExecutable,
  onUnloadModule,
  setErrorText,
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
        setErrorText(
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
  }, [setErrorText]);

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
        setErrorText("");
        onOpenRecentExecutable(selectedPath);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [onOpenRecentExecutable, setErrorText]);

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
        setErrorText(
          error instanceof Error ? error.message : "Window control failed",
        );
      });
    },
    [setErrorText],
  );

  const handleInvokeTitleBarMenuAction = useCallback(
    (commandId: string) => {
      void desktopApi
        .invokeTitleBarMenuAction(commandId)
        .catch((error: unknown) => {
          setErrorText(
            error instanceof Error ? error.message : "Menu action failed",
          );
        });
    },
    [setErrorText],
  );

  return {
    handleInvokeTitleBarMenuAction,
    handleWindowControl,
    titleBarMenuModel,
    windowChromeState,
  };
}
