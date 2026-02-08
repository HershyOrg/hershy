import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { watcherAPI } from '../api/watcher'

interface CommandPanelProps {
  programId: string
}

export function CommandPanel({ programId }: CommandPanelProps) {
  const [command, setCommand] = useState('')

  const sendMessageMutation = useMutation({
    mutationFn: (content: string) => watcherAPI.sendMessage(programId, content),
    onSuccess: () => {
      setCommand('')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (command.trim()) {
      sendMessageMutation.mutate(command.trim())
    }
  }

  const quickCommands = [
    { label: 'Status', value: 'status' },
    { label: 'Portfolio', value: 'portfolio' },
    { label: 'Trades', value: 'trades' },
    { label: 'Prices', value: 'prices' },
  ]

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Command Panel</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Send Command to Watcher
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Enter command..."
              className="flex-1 px-4 py-2 border border-input bg-background rounded focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={!command.trim() || sendMessageMutation.isPending}
              className="px-6 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 font-medium transition-colors"
            >
              {sendMessageMutation.isPending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Quick Commands
          </label>
          <div className="flex gap-2 flex-wrap">
            {quickCommands.map((cmd) => (
              <button
                key={cmd.value}
                type="button"
                onClick={() => sendMessageMutation.mutate(cmd.value)}
                disabled={sendMessageMutation.isPending}
                className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 disabled:opacity-50 text-sm font-medium transition-colors"
              >
                {cmd.label}
              </button>
            ))}
          </div>
        </div>

        {sendMessageMutation.isSuccess && (
          <div className="p-3 bg-green-100 dark:bg-green-900 border border-green-200 dark:border-green-800 rounded text-sm text-green-800 dark:text-green-200">
            ✓ Message sent successfully
          </div>
        )}

        {sendMessageMutation.isError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
            Error: {(sendMessageMutation.error as Error).message}
          </div>
        )}
      </form>
    </div>
  )
}
