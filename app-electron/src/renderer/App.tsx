import { useEffect, useState } from "react";
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

  return (
    <div className="shell">
      <header className="toolbar">
        <button onClick={openExecutable} type="button" disabled={isLoading}>
          Open EXE
        </button>
        <div className="status">Engine: {engineStatus}</div>
        <div className="path" title={modulePath}>
          {modulePath || "No module loaded"}
        </div>
      </header>

      {errorText ? <div className="error">{errorText}</div> : null}

      <main className="layout">
        <section className="panel nav">
          <h2>Functions</h2>
          <ul>
            {functions.map((func) => (
              <li key={`${func.kind}-${func.start}`}>
                <button
                  type="button"
                  onClick={() => void disassembleAt(func.start)}
                >
                  <span>{func.name}</span>
                  <code>{func.start}</code>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel disassembly">
          <div className="disassembly-header">
            <h2>Disassembly</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void disassembleAt(goToAddress);
              }}
            >
              <input
                value={goToAddress}
                onChange={(event) => setGoToAddress(event.target.value)}
                placeholder="0x140001000"
              />
              <button type="submit" disabled={!moduleId || isLoading}>
                Go
              </button>
            </form>
          </div>
          <table>
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
                <tr key={instruction.address}>
                  <td>
                    <code>{instruction.address}</code>
                  </td>
                  <td>
                    <code>{instruction.bytes}</code>
                  </td>
                  <td>{instruction.mnemonic}</td>
                  <td>
                    <span>{instruction.operands}</span>
                    {instruction.branchTarget ? (
                      <button
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
          {stopReason ? (
            <div className="stop-reason">Stop reason: {stopReason}</div>
          ) : null}
        </section>

        <section className="panel inspector">
          <h2>Inspector</h2>
          <div>
            <strong>Module ID:</strong> {moduleId || "-"}
          </div>
          <div>
            <strong>Entry RVA:</strong> {entryRva || "-"}
          </div>
          <h3>Sections</h3>
          <ul>
            {sections.map((section) => (
              <li key={section.name + section.startRva}>
                <code>{section.name}</code> {section.startRva} -{" "}
                {section.endRva}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
