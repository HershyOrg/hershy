import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { hostAPI } from '../api/host'
import type { CreateProgramRequest } from '../api/types'

interface CreateProgramModalProps {
  isOpen: boolean
  onClose: () => void
}

export function CreateProgramModal({ isOpen, onClose }: CreateProgramModalProps) {
  const queryClient = useQueryClient()
  const [userId, setUserId] = useState('')
  const [dockerfile, setDockerfile] = useState('')
  const [srcFiles, setSrcFiles] = useState('{}')

  const createMutation = useMutation({
    mutationFn: (data: CreateProgramRequest) => hostAPI.createProgram(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs'] })
      onClose()
      setUserId('')
      setDockerfile('')
      setSrcFiles('{}')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const parsedSrcFiles = JSON.parse(srcFiles)
      createMutation.mutate({
        user_id: userId,
        dockerfile,
        src_files: parsedSrcFiles,
      })
    } catch (error) {
      alert('Invalid JSON in source files')
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 shadow-2xl rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-foreground">Create New Program</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 hover:bg-muted rounded cursor-pointer"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              User ID <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              required
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full px-4 py-2.5 border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-text"
              placeholder="e.g., user-123"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Dockerfile <span className="text-destructive">*</span>
            </label>
            <textarea
              required
              value={dockerfile}
              onChange={(e) => setDockerfile(e.target.value)}
              rows={10}
              className="w-full px-4 py-2.5 border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm transition-all cursor-text"
              placeholder="FROM golang:1.24&#10;WORKDIR /app&#10;..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Source Files (JSON) <span className="text-destructive">*</span>
            </label>
            <textarea
              required
              value={srcFiles}
              onChange={(e) => setSrcFiles(e.target.value)}
              rows={8}
              className="w-full px-4 py-2.5 border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm transition-all cursor-text"
              placeholder='{"main.go": "package main...", "go.mod": "module example..."}'
            />
            <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
              <svg className="w-3 h-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>JSON object with filename as key and content as value</span>
            </p>
          </div>

          {createMutation.isError && (
            <div className="p-4 bg-destructive/10 border-2 border-destructive/20 rounded-lg text-sm text-destructive flex items-start gap-2">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span><strong>Error:</strong> {(createMutation.error as Error).message}</span>
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t border-border">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-all shadow-md hover:shadow-lg cursor-pointer"
            >
              {createMutation.isPending ? '⏳ Creating...' : '✨ Create Program'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 active:bg-secondary/70 font-semibold transition-all shadow-sm hover:shadow-md cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
