import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type {
  EngineMethod,
  MethodParams,
  MethodResult,
} from "../shared/protocol";

type RequestId = number;

type RpcSuccess = {
  jsonrpc: "2.0";
  id: RequestId;
  result: unknown;
};

type RpcFailure = {
  jsonrpc: "2.0";
  id: RequestId;
  error: {
    code: number;
    message: string;
    data?: {
      code: string;
      details?: unknown;
    };
  };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout | null;
};

export class EngineClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lineReader: readline.Interface | null = null;
  private nextId = 1;
  private readonly pending = new Map<RequestId, PendingRequest>();

  start(): void {
    if (this.child) {
      return;
    }

    const { command, args, cwd } = this.resolveLaunchCommand();
    this.child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.lineReader = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    this.lineReader.on("line", (line) => {
      this.handleResponseLine(line);
    });

    this.child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text.length > 0) {
        console.error(`[engine] ${text}`);
      }
    });

    this.child.on("exit", (code, signal) => {
      this.rejectAllPending(
        new Error(
          `Engine process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`,
        ),
      );
      this.cleanup();
    });

    this.child.on("error", (error) => {
      this.rejectAllPending(
        new Error(`Engine process error: ${error.message}`),
      );
      this.cleanup();
    });
  }

  stop(): void {
    if (!this.child) {
      return;
    }

    this.child.kill();
    this.cleanup();
  }

  async request<M extends EngineMethod>(
    method: M,
    params: MethodParams[M],
  ): Promise<MethodResult[M]> {
    this.start();

    if (!this.child) {
      throw new Error("Engine process is unavailable");
    }

    const timeoutMs = this.getTimeoutMs(method);
    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const promise = new Promise<MethodResult[M]>((resolve, reject) => {
      const timeout =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              reject(
                new Error(`Engine request timed out for method '${method}'`),
              );
            }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as MethodResult[M]),
        reject,
        timeout,
      });
    });

    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  }

  private resolveLaunchCommand(): {
    command: string;
    args: string[];
    cwd: string;
  } {
    const repoRoot = path.resolve(__dirname, "../../..");
    const engineBinaryPath = path.join(
      repoRoot,
      "engine",
      "target",
      "debug",
      "engine.exe",
    );

    if (fs.existsSync(engineBinaryPath)) {
      return {
        command: engineBinaryPath,
        args: [],
        cwd: repoRoot,
      };
    }

    return {
      command: "cargo",
      args: [
        "run",
        "--manifest-path",
        path.join(repoRoot, "engine", "Cargo.toml"),
        "--quiet",
      ],
      cwd: repoRoot,
    };
  }

  private getTimeoutMs(method: EngineMethod): number | null {
    switch (method) {
      case "module.open":
      case "module.unload":
        return null;
      case "module.getAnalysisStatus":
        return 5_000;
      default:
        return 10_000;
    }
  }

  private handleResponseLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    let parsed: RpcSuccess | RpcFailure;
    try {
      parsed = JSON.parse(line) as RpcSuccess | RpcFailure;
    } catch (error) {
      console.error("Failed to parse engine JSON-RPC response", error);
      return;
    }

    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }

    this.pending.delete(parsed.id);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }

    if ("error" in parsed) {
      const message = parsed.error.data?.code
        ? `${parsed.error.message} (${parsed.error.data.code})`
        : parsed.error.message;
      pending.reject(new Error(message));
      return;
    }

    pending.resolve(parsed.result);
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }

  private cleanup(): void {
    if (this.lineReader) {
      this.lineReader.close();
      this.lineReader = null;
    }

    if (this.child) {
      this.child.removeAllListeners();
      this.child = null;
    }
  }
}
