import { createWatcherClient } from './client'
import type {
  StatusResponse,
  LogsResponse,
  SignalsResponse,
  MessageResponse,
  WatchingResponse,
  MemoCacheResponse,
  VarStateResponse,
  ConfigResponse,
} from './types'

/**
 * WatcherAPI 클라이언트
 *
 * 사용 페이지:
 * - Watcher Page 전용
 *
 * 모든 요청은 Host의 proxy 경로를 통해 Container WatcherAPI로 전달됨
 * 경로: /programs/:id/proxy/watcher/*
 */
export const watcherAPI = {
  /**
   * GET /programs/:id/proxy/watcher/status
   * Watcher 상태 조회
   * 사용: Watcher Page (StatusCard)
   * 폴링: 2초
   */
  getStatus: (programId: string) =>
    createWatcherClient(programId)
      .get<StatusResponse>('/watcher/status')
      .then((r) => r.data),

  /**
   * GET /programs/:id/proxy/watcher/logs?type=all&limit=100
   * Watcher 로그 조회
   * 사용: Watcher Page (LogViewer)
   * 폴링: 2초
   */
  getLogs: (programId: string, type = 'all', limit = 100) =>
    createWatcherClient(programId)
      .get<LogsResponse>(`/watcher/logs?type=${type}&limit=${limit}`)
      .then((r) => r.data),

  /**
   * GET /programs/:id/proxy/watcher/signals
   * Watcher 시그널 조회
   * 사용: Watcher Page (SignalCard)
   * 폴링: 2초
   */
  getSignals: (programId: string) =>
    createWatcherClient(programId)
      .get<SignalsResponse>('/watcher/signals')
      .then((r) => r.data),

  /**
   * POST /programs/:id/proxy/watcher/message
   * Watcher에 명령어 전송
   * 사용: Watcher Page (CommandPanel)
   */
  sendMessage: (programId: string, content: string) =>
    createWatcherClient(programId)
      .post<MessageResponse>('/watcher/message', { content })
      .then((r) => r.data),

  /**
   * GET /programs/:id/proxy/watcher/watching
   * 감시 중인 변수 목록 조회
   * 사용: Watcher Page (WatchingCard)
   * 폴링: 5초
   */
  getWatching: (programId: string) =>
    createWatcherClient(programId)
      .get<WatchingResponse>('/watcher/watching')
      .then((r) => r.data),

  /**
   * GET /programs/:id/proxy/watcher/memoCache
   * Memo 캐시 내용 조회
   * 사용: Watcher Page (MemoCacheCard)
   * 폴링: 5초
   */
  getMemoCache: (programId: string) =>
    createWatcherClient(programId)
      .get<MemoCacheResponse>('/watcher/memoCache')
      .then((r) => r.data),

  /**
   * GET /programs/:id/proxy/watcher/varState
   * 변수 상태 스냅샷 조회
   * 사용: Watcher Page (VarStateCard)
   * 폴링: 5초
   */
  getVarState: (programId: string) =>
    createWatcherClient(programId)
      .get<VarStateResponse>('/watcher/varState')
      .then((r) => r.data),

  /**
   * GET /programs/:id/proxy/watcher/config
   * Watcher 설정 조회
   * 사용: Watcher Page (ConfigCard)
   * 폴링: 없음 (한 번만 조회)
   */
  getConfig: (programId: string) =>
    createWatcherClient(programId)
      .get<ConfigResponse>('/watcher/config')
      .then((r) => r.data),
}
