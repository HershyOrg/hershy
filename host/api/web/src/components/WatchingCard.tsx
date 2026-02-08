import type { WatchingResponse } from '../api/types'

interface WatchingCardProps {
  watching: WatchingResponse
}

export function WatchingCard({ watching }: WatchingCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Watched Variables</h2>
        <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm font-medium">
          {watching.count} variables
        </span>
      </div>

      {watching.watchedVars.length > 0 ? (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {watching.watchedVars.map((varName, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-3 bg-muted/50 rounded hover:bg-muted transition-colors"
            >
              <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span className="font-mono text-sm text-foreground">{varName}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <svg className="mx-auto h-10 w-10 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
          <p className="text-sm">No variables are currently being watched</p>
        </div>
      )}

      <div className="pt-4 mt-4 border-t border-border">
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Last Updated</span>
          <span className="text-xs">{new Date(watching.timestamp).toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
