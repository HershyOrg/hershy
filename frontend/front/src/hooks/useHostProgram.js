import { useEffect, useState } from 'react';
import { buildStrategyRunnerPayload } from '../lib/hostRunnerTemplates';

const FRONT_HOST_PROXY_PREFIX = '/api/host';
const DEFAULT_HOST_TARGET = 'http://localhost:9000';

export default function useHostProgram({
  activeTabId,
  activeTabLabel,
  activeActionAuth,
  compileActiveStrategy,
  setNotice
}) {
  const [hostTarget, setHostTarget] = useState(DEFAULT_HOST_TARGET);
  const [hostProgram, setHostProgram] = useState(null);
  const [hostBusy, setHostBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch('/api/config')
      .then((response) => response.json())
      .then((payload) => {
        if (!mounted) {
          return;
        }
        if (typeof payload?.host_api_base === 'string' && payload.host_api_base.trim()) {
          setHostTarget(payload.host_api_base.trim());
        }
      })
      .catch(() => {
        // Keep default when front server config endpoint is unavailable.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const callHost = async (path, options = {}) => {
    const url = `${FRONT_HOST_PROXY_PREFIX}${path}`;
    let response;

    try {
      response = await fetch(url, options);
    } catch {
      throw new Error(
        `Host API 연결 실패 (${url}). front 서버 프록시와 host(:9000) 상태를 확인하세요.`
      );
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error || payload?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload;
  };

  const handleOpenHostUI = () => {
    if (typeof window === 'undefined') {
      return;
    }
    const base = hostTarget.trim().replace(/\/+$/, '') || DEFAULT_HOST_TARGET;
    window.open(`${base}/ui/programs`, '_blank', 'noopener,noreferrer');
  };

  const handleDeployHostProgram = async () => {
    const compiled = compileActiveStrategy();
    if (!compiled) {
      setNotice('error', '활성 전략 탭이 없습니다.');
      return;
    }
    if (!compiled.report.valid) {
      setNotice('error', '전략 검증을 먼저 통과시켜야 배포할 수 있습니다.');
      return;
    }

    setHostBusy(true);
    try {
      const payload = buildStrategyRunnerPayload(compiled.json, {
        userHint: activeTabLabel || activeTabId || 'strategy',
        actionAuth: activeActionAuth
      });
      const created = await callHost('/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setHostProgram({
        programId: created.program_id,
        buildId: created.build_id,
        state: created.state,
        proxyUrl: created.proxy_url
      });
      setNotice('success', `Host 프로그램 생성 완료: ${created.program_id}`);
    } catch (error) {
      setNotice('error', `배포 실패: ${error.message}`);
    } finally {
      setHostBusy(false);
    }
  };

  const handleStartHostProgram = async () => {
    if (!hostProgram?.programId) {
      setNotice('error', '먼저 Host 배포를 실행하세요.');
      return;
    }
    setHostBusy(true);
    try {
      const started = await callHost(`/programs/${hostProgram.programId}/start`, {
        method: 'POST'
      });
      setHostProgram((prev) => ({
        ...prev,
        state: started.state
      }));
      setNotice('success', `실행 요청 완료: ${hostProgram.programId}`);
    } catch (error) {
      setNotice('error', `시작 실패: ${error.message}`);
    } finally {
      setHostBusy(false);
    }
  };

  const handleRefreshHostProgram = async () => {
    if (!hostProgram?.programId) {
      return;
    }
    setHostBusy(true);
    try {
      const item = await callHost(`/programs/${hostProgram.programId}`);
      setHostProgram({
        programId: item.program_id,
        buildId: item.build_id,
        state: item.state,
        proxyUrl: item.proxy_url,
        errorMsg: item.error_msg
      });
      if (item.state === 'Ready') {
        setNotice('success', `프로그램 Ready: ${item.program_id}`);
      } else {
        setNotice('warn', `프로그램 상태: ${item.state}`);
      }
    } catch (error) {
      setNotice('error', `상태 조회 실패: ${error.message}`);
    } finally {
      setHostBusy(false);
    }
  };

  const handleStopHostProgram = async () => {
    if (!hostProgram?.programId) {
      return;
    }
    setHostBusy(true);
    try {
      const stopped = await callHost(`/programs/${hostProgram.programId}/stop`, {
        method: 'POST'
      });
      setHostProgram((prev) => ({
        ...prev,
        state: stopped.state
      }));
      setNotice('warn', `중지 요청 완료: ${hostProgram.programId}`);
    } catch (error) {
      setNotice('error', `중지 실패: ${error.message}`);
    } finally {
      setHostBusy(false);
    }
  };

  const handleOpenWatcherStatus = () => {
    if (typeof window === 'undefined' || !hostProgram?.programId) {
      return;
    }
    const base = hostTarget.trim().replace(/\/+$/, '') || DEFAULT_HOST_TARGET;
    window.open(
      `${base}/programs/${hostProgram.programId}/proxy/watcher/status`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  return {
    hostTarget,
    hostProgram,
    hostBusy,
    handleOpenHostUI,
    handleDeployHostProgram,
    handleStartHostProgram,
    handleRefreshHostProgram,
    handleStopHostProgram,
    handleOpenWatcherStatus
  };
}
