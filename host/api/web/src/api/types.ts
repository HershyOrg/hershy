// Host API Types
export interface CreateProgramRequest {
  user_id: string
  dockerfile: string
  src_files: Record<string, string>
}

export interface CreateProgramResponse {
  program_id: string
  build_id: string
  state: string
  proxy_url: string
  created_at: string
}

export interface GetProgramResponse {
  program_id: string
  build_id: string
  user_id: string
  state: string
  image_id?: string
  container_id?: string
  proxy_url: string
  error_msg?: string
  created_at: string
  updated_at: string
}

export interface ListProgramsResponse {
  programs: GetProgramResponse[]
  count: number
}

export interface LifecycleResponse {
  program_id: string
  state: string
  message: string
}

export interface SourceCodeResponse {
  program_id: string
  files: Record<string, string>
  retrieved_at: string
}

export interface ErrorResponse {
  error: string
  code: number
  message?: string
}

// WatcherAPI Types
export interface StatusResponse {
  state: string
  isRunning: boolean
  watcherID: string
  uptime: string
  lastUpdate: string
}

export interface LogsResponse {
  effectLogs?: unknown[]
  reduceLogs?: unknown[]
  watchErrorLogs?: unknown[]
  contextLogs?: unknown[]
  stateFaultLogs?: unknown[]
}

export interface SignalEntry {
  type: string // "var", "user", "watcher"
  content: string
  createdAt: string
}

export interface SignalsResponse {
  varSigCount: number
  userSigCount: number
  watcherSigCount: number
  totalPending: number
  recentSignals: SignalEntry[]
  timestamp: string
}

export interface MessageRequest {
  content: string
}

export interface MessageResponse {
  status: string
}

export interface WatchingResponse {
  watchedVars: string[]
  count: number
  timestamp: string
}

export interface MemoCacheResponse {
  entries: Record<string, unknown>
  count: number
  timestamp: string
}

export interface VarStateResponse {
  variables: Record<string, unknown>
  count: number
  timestamp: string
}

export interface WatcherConfigData {
  serverPort: number
  signalChanCapacity: number
  maxLogEntries: number
  maxMemoEntries: number
}

export interface ConfigResponse {
  config: WatcherConfigData
  timestamp: string
}
