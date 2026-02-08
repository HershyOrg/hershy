import type { VarStateResponse } from '../api/types'

interface VarStateCardProps {
  varState: VarStateResponse
}

export function VarStateCard({ varState }: VarStateCardProps) {
  const variables = Object.entries(varState.variables)

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Variable State Snapshot</h2>
        <span className="px-3 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-full text-sm font-medium">
          {varState.count} variables
        </span>
      </div>

      {variables.length > 0 ? (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {variables.map(([key, value], index) => (
            <div
              key={index}
              className="p-3 bg-muted/50 rounded hover:bg-muted transition-colors border border-border/50"
            >
              <div className="flex items-start gap-2 mb-2">
                <svg className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground font-medium mb-1">Variable</div>
                  <div className="font-mono text-sm text-foreground break-all font-semibold">{key}</div>
                </div>
              </div>
              <div className="pl-6">
                <div className="text-xs text-muted-foreground font-medium mb-1">Current Value</div>
                <div className="font-mono text-xs bg-background p-2 rounded border border-border overflow-x-auto">
                  <pre className="whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <svg className="mx-auto h-10 w-10 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm">No variable state available</p>
        </div>
      )}

      <div className="pt-4 mt-4 border-t border-border">
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Snapshot Time</span>
          <span className="text-xs">{new Date(varState.timestamp).toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
