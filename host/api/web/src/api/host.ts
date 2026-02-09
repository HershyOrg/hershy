import { hostClient } from './client'
import type {
  CreateProgramRequest,
  CreateProgramResponse,
  GetProgramResponse,
  ListProgramsResponse,
  LifecycleResponse,
  SourceCodeResponse,
} from './types'

/**
 * Host API 클라이언트
 *
 * 사용 페이지:
 * - Dashboard: listPrograms, createProgram, startProgram, stopProgram, restartProgram, deleteProgram
 * - Program Detail: getProgram, startProgram, stopProgram, restartProgram, deleteProgram
 * - Watcher Page: getProgram (헤더 정보)
 */
export const hostAPI = {
  /**
   * GET /programs
   * 프로그램 목록 조회
   * 사용: Dashboard
   */
  listPrograms: () =>
    hostClient.get<ListProgramsResponse>('/programs').then((r) => r.data),

  /**
   * POST /programs
   * 프로그램 생성
   * 사용: Dashboard (CreateProgramModal)
   */
  createProgram: (data: CreateProgramRequest) =>
    hostClient
      .post<CreateProgramResponse>('/programs', data)
      .then((r) => r.data),

  /**
   * GET /programs/:id
   * 프로그램 상세 조회
   * 사용: Program Detail, Watcher Page
   */
  getProgram: (programId: string) =>
    hostClient
      .get<GetProgramResponse>(`/programs/${programId}`)
      .then((r) => r.data),

  /**
   * POST /programs/:id/start
   * 프로그램 시작
   * 사용: Dashboard, Program Detail
   */
  startProgram: (programId: string) =>
    hostClient
      .post<LifecycleResponse>(`/programs/${programId}/start`)
      .then((r) => r.data),

  /**
   * POST /programs/:id/stop
   * 프로그램 중지
   * 사용: Dashboard, Program Detail
   */
  stopProgram: (programId: string) =>
    hostClient
      .post<LifecycleResponse>(`/programs/${programId}/stop`)
      .then((r) => r.data),

  /**
   * POST /programs/:id/restart
   * 프로그램 재시작
   * 사용: Dashboard, Program Detail
   */
  restartProgram: (programId: string) =>
    hostClient
      .post<LifecycleResponse>(`/programs/${programId}/restart`)
      .then((r) => r.data),

  /**
   * DELETE /programs/:id
   * 프로그램 삭제
   * 사용: Dashboard, Program Detail
   */
  deleteProgram: (programId: string) =>
    hostClient.delete(`/programs/${programId}`).then((r) => r.data),

  /**
   * GET /programs/:id/logs
   * Docker 컨테이너 로그 조회
   * 사용: Watcher Page (DockerLogViewer)
   */
  getContainerLogs: (programId: string) =>
    hostClient
      .get<{ program_id: string; container_id: string; logs: string; timestamp: string }>(`/programs/${programId}/logs`)
      .then((r) => r.data),

  /**
   * GET /programs/:id/source
   * 프로그램 소스코드 조회
   * 사용: Program Detail (SourceCodeViewer)
   */
  getSourceCode: (programId: string) =>
    hostClient
      .get<SourceCodeResponse>(`/programs/${programId}/source`)
      .then((r) => r.data),
}
