import type { LogsResponse } from '../api/types'

interface LogViewerProps {
  logs: LogsResponse
}

export function LogViewer({ logs }: LogViewerProps) {
  const logCategories = [
    { name: 'Effect Logs', data: logs.effectLogs, color: 'blue' },
    { name: 'Reduce Logs', data: logs.reduceLogs, color: 'green' },
    { name: 'Watch Error Logs', data: logs.watchErrorLogs, color: 'red' },
    { name: 'Context Logs', data: logs.contextLogs, color: 'purple' },
    { name: 'State Fault Logs', data: logs.stateFaultLogs, color: 'orange' },
  ]

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Watcher Logs</h2>

      <div className="space-y-4 max-h-[600px] overflow-y-auto">
        {logCategories.map((category) => (
          <div key={category.name}>
            <h3
              className={`text-sm font-semibold mb-2 text-${category.color}-600 dark:text-${category.color}-400`}
            >
              {category.name} ({category.data?.length || 0})
            </h3>

            {category.data && category.data.length > 0 ? (
              <div className="space-y-1">
                {category.data.map((log, idx) => (
                  <div
                    key={idx}
                    className="p-2 bg-muted rounded text-xs font-mono border border-border"
                  >
                    <pre className="whitespace-pre-wrap break-words">
                      {JSON.stringify(log, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No logs available</p>
            )}
          </div>
        ))}

        {!logCategories.some((cat) => cat.data && cat.data.length > 0) && (
          <div className="text-center py-8 text-muted-foreground">
            <p>No logs available yet</p>
          </div>
        )}
      </div>
    </div>
  )
}
