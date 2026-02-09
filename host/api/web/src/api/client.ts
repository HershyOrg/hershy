import axios from 'axios'

// Host 서버 클라이언트 (모든 API 요청의 기본)
// baseURL을 빈 문자열로 설정하여 상대 경로 사용 (같은 origin)
export const hostClient = axios.create({
  baseURL: '',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// WatcherAPI 프록시 클라이언트 생성 헬퍼
// 사용처: Watcher Page에서 WatcherAPI 호출
export function createWatcherClient(programId: string) {
  return axios.create({
    baseURL: `/programs/${programId}/proxy`,
    timeout: 5000,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
