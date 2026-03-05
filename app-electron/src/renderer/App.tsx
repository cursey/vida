import { type FormEvent, useEffect, useMemo, useState } from "react";
import type {
  FunctionSeed,
  LinearInstruction,
  SectionInfo,
  StopReason,
} from "../shared/protocol";

export function App() {
  const [engineStatus, setEngineStatus] = useState<string>("checking");
  const [modulePath, setModulePath] = useState<string>("");
  const [moduleId, setModuleId] = useState<string>("");
  const [entryRva, setEntryRva] = useState<string>("");
  const [goToAddress, setGoToAddress] = useState<string>("");
  const [functions, setFunctions] = useState<FunctionSeed[]>([]);
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [instructions, setInstructions] = useState<LinearInstruction[]>([]);
  const [stopReason, setStopReason] = useState<StopReason | "">("");
  const [errorText, setErrorText] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

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
      const initialStart = listed.functions[0]?.start ?? opened.entryRva;
      const linear = await window.electronAPI.disassembleLinear({
        moduleId: opened.moduleId,
        start: initialStart,
        maxInstructions: 250,
      });

      setModulePath(chosenPath);
      setModuleId(opened.moduleId);
      setEntryRva(opened.entryRva);
      setSections(info.sections);
      setFunctions(listed.functions);
      setInstructions(linear.instructions);
      setStopReason(linear.stopReason);
      setGoToAddress(initialStart);
    } catch (error: unknown) {
      setErrorText(
        error instanceof Error ? error.message : "Failed to open executable",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function disassembleAt(start: string) {
    if (!moduleId) {
      return;
    }

    setIsLoading(true);
    setErrorText("");

    try {
      const linear = await window.electronAPI.disassembleLinear({
        moduleId,
        start,
        maxInstructions: 250,
      });
      setInstructions(linear.instructions);
      setStopReason(linear.stopReason);
      setGoToAddress(start);
    } catch (error: unknown) {
      setErrorText(
        error instanceof Error ? error.message : "Disassembly failed",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleGoToSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void disassembleAt(goToAddress);
  }

  return (
    <div className="shell">
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

      <main className="layout">
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
                    onClick={() => void disassembleAt(func.start)}
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

        <section className="panel panel-disassembly">
          <header className="panel-header">
            <h2>Disassembly</h2>
            <span className="panel-stop">
              {stopReason ? `Stop ${stopReason}` : "Ready"}
            </span>
          </header>
          <div className="panel-body table-body">
            <table className="disassembly-table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Bytes</th>
                  <th>Instruction</th>
                  <th>Operands</th>
                </tr>
              </thead>
              <tbody>
                {instructions.map((instruction) => (
                  <tr key={`${instruction.address}-${instruction.bytes}`}>
                    <td>
                      <code>{instruction.address}</code>
                    </td>
                    <td>
                      <code>{instruction.bytes}</code>
                    </td>
                    <td>{instruction.mnemonic}</td>
                    <td>
                      <span>{instruction.operands || "-"}</span>
                      {instruction.branchTarget ? (
                        <button
                          className="address-chip"
                          type="button"
                          onClick={() => {
                            if (instruction.branchTarget) {
                              void disassembleAt(instruction.branchTarget);
                            }
                          }}
                        >
                          {instruction.branchTarget}
                        </button>
                      ) : null}
                      {instruction.callTarget ? (
                        <button
                          className="address-chip"
                          type="button"
                          onClick={() => {
                            if (instruction.callTarget) {
                              void disassembleAt(instruction.callTarget);
                            }
                          }}
                        >
                          {instruction.callTarget}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

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
                  <div>
                    <code>{section.name}</code>
                  </div>
                  <div>
                    {section.startRva} - {section.endRva}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
