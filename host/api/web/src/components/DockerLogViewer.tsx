import { useQuery } from '@tanstack/react-query'
import { hostAPI } from '../api/host'
import { useEffect, useRef, useState } from 'react'

interface DockerLogViewerProps {
  programId: string
  autoScroll?: boolean
}

export function DockerLogViewer({ programId, autoScroll: initialAutoScroll = false }: DockerLogViewerProps) {
  const [autoScroll, setAutoScroll] = useState(initialAutoScroll)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['container-logs', programId],
    queryFn: () => hostAPI.getContainerLogs(programId),
    refetchInterval: 2000,
    retry: 1,
  })

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [data, autoScroll])

  // Parse ANSI color codes and format logs
  const formatLogs = (rawLogs: string) => {
    if (!rawLogs) return []

    // Split by newlines and filter empty lines
    const lines = rawLogs.split('\n').filter(line => line.trim())

    return lines.map((line, idx) => {
      // Remove Docker log prefixes (timestamps with stream markers)
      const cleanLine = line.replace(/^\S+\s+/, '')

      // Detect log level
      let level = 'info'
      if (/ERROR|ERRO|ERR|FATAL|CRIT/i.test(cleanLine)) level = 'error'
      else if (/WARN|WARNING/i.test(cleanLine)) level = 'warn'
      else if (/DEBUG|TRACE/i.test(cleanLine)) level = 'debug'
      else if (/SUCCESS|OK|✓|✅/i.test(cleanLine)) level = 'success'

      return { idx, line: cleanLine, level }
    })
  }

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error': return 'text-red-600 dark:text-red-400'
      case 'warn': return 'text-yellow-600 dark:text-yellow-400'
      case 'debug': return 'text-gray-500 dark:text-gray-400'
      case 'success': return 'text-green-600 dark:text-green-400'
      default: return 'text-foreground'
    }
  }

  const formattedLogs = data ? formatLogs(data.logs) : []

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Container Logs</h2>
          {data && (
            <p className="text-xs text-muted-foreground mt-1">
              Container: <span className="font-mono">{data.container_id.slice(0, 12)}</span>
              {' • '}
              {formattedLogs.length} lines
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              autoScroll
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            {autoScroll ? '📜 Auto-scroll ON' : '📜 Auto-scroll OFF'}
          </button>
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            {isLoading ? '🔄 Loading...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-200 mb-4">
          Failed to load logs: {(error as Error).message}
        </div>
      )}

      <div className="bg-black rounded-lg p-4 max-h-[600px] overflow-y-auto font-mono text-sm">
        {isLoading && formattedLogs.length === 0 ? (
          <div className="text-gray-400 text-center py-8">Loading logs...</div>
        ) : formattedLogs.length === 0 ? (
          <div className="text-gray-400 text-center py-8">No logs available</div>
        ) : (
          <div className="space-y-0.5">
            {formattedLogs.map(({ idx, line, level }) => (
              <div key={idx} className={`${getLevelColor(level)} whitespace-pre-wrap break-words`}>
                {line}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  )
}
