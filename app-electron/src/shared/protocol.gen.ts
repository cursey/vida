/* This file is auto-generated from shared/schemas/protocol.schema.json. */

/**
 * JSON-RPC protocol definitions for Electron <-> Rust engine
 */
export type ElectronDisassemblerProtocol = Request | Response;
export type Request =
  | EnginePingRequest
  | ModuleOpenRequest
  | ModuleUnloadRequest
  | ModuleAnalysisStatusRequest
  | ModuleInfoRequest
  | FunctionListRequest
  | FunctionGraphByVaRequest
  | LinearDisassemblyRequest;
export type JsonRpcVersion = "2.0";
export type RequestId = number | string;
export type ModuleId = string;
export type HexAddress = string;
export type Response = SuccessResponse | ErrorResponse;

export interface EnginePingRequest {
  jsonrpc: JsonRpcVersion;
  id: RequestId;
  method: "engine.ping";
  params: EnginePingParams;
}
export interface EnginePingParams {}
export interface ModuleOpenRequest {
  jsonrpc: JsonRpcVersion;
  id: RequestId;
  method: "module.open";
  params: ModuleOpenParams;
}
export interface ModuleOpenParams {
  path: string;
}
export interface ModuleUnloadRequest {
  jsonrpc: JsonRpcVersion;
  id: RequestId;
  method: "module.unload";
  params: ModuleUnloadParams;
}
export interface ModuleUnloadParams {
  moduleId: ModuleId;
}
export interface ModuleAnalysisStatusRequest {
  jsonrpc: JsonRpcVersion;
  id: RequestId;
  method: "module.getAnalysisStatus";
  params: ModuleAnalysisStatusParams;
}
export interface ModuleAnalysisStatusParams {
  moduleId: ModuleId;
}
export interface ModuleInfoRequest {
  jsonrpc: JsonRpcVersion;
  id: RequestId;
  method: "module.info";
  params: ModuleInfoParams;
}
export interface ModuleInfoParams {
  moduleId: ModuleId;
}
export interface FunctionListRequest {
  jsonrpc: JsonRpcVersion;
  id: RequestId;
  method: "function.list";
  params: FunctionListParams;
}
export interface FunctionListParams {
  moduleId: ModuleId;
}
export interface FunctionGraphByVaRequest {
  jsonrpc: JsonRpcVersion;
  id: RequestId;
  method: "function.getGraphByVa";
  params: FunctionGraphByVaParams;
}
export interface FunctionGraphByVaParams {
  moduleId: ModuleId;
  va: HexAddress;
}
export interface LinearDisassemblyRequest {
  jsonrpc: JsonRpcVersion;
  id: RequestId;
  method: "function.disassembleLinear";
  params: LinearDisassemblyParams;
}
export interface LinearDisassemblyParams {
  moduleId: ModuleId;
  start: HexAddress;
  maxInstructions?: number;
}
export interface SuccessResponse {
  jsonrpc: JsonRpcVersion;
  id: RequestId;
  result: unknown;
}
export interface ErrorResponse {
  jsonrpc: JsonRpcVersion;
  id: RequestId;
  error: EngineError;
}
export interface EngineError {
  code: number;
  message: string;
  data?: {
    code: string;
    details?: unknown;
    [k: string]: unknown;
  };
}
