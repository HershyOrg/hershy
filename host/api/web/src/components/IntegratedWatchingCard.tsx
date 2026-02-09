import type { WatchingResponse, VarStateResponse } from '../api/types'

interface IntegratedWatchingCardProps {
  watching: WatchingResponse
  varState: VarStateResponse
}

export function IntegratedWatchingCard({ watching, varState }: IntegratedWatchingCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Watched Variables & State</h2>
        <span className="text-sm text-muted-foreground">
          {watching.count} variable{watching.count !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-3 text-sm font-medium text-muted-foreground">
                Variable Name
              </th>
              <th className="text-left py-2 px-3 text-sm font-medium text-muted-foreground">
                Current Value
              </th>
              <th className="text-left py-2 px-3 text-sm font-medium text-muted-foreground">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {watching.watchedVars.map((varName) => {
              const value = varState.variables[varName]
              const isInitialized = value !== undefined

              return (
                <tr key={varName} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="py-3 px-3">
                    <code className="text-sm font-mono text-foreground font-medium">
                      {varName}
                    </code>
                  </td>
                  <td className="py-3 px-3">
                    {isInitialized ? (
                      <code className="text-sm font-mono text-foreground bg-muted/50 px-2 py-1 rounded">
                        {JSON.stringify(value)}
                      </code>
                    ) : (
                      <span className="text-sm text-muted-foreground italic">-</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    {isInitialized ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Initialized
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        Not Initialized
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {watching.watchedVars.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <p>No watched variables</p>
        </div>
      )}

      <div className="mt-4 text-xs text-muted-foreground">
        Last updated: {new Date(varState.timestamp).toLocaleString()}
      </div>
    </div>
  )
}
