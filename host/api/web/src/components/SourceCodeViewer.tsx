import { useState } from 'react'
import type { SourceCodeResponse } from '../api/types'

interface SourceCodeViewerProps {
  sourceCode: SourceCodeResponse
}

export function SourceCodeViewer({ sourceCode }: SourceCodeViewerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [copiedFile, setCopiedFile] = useState<string | null>(null)

  const fileNames = Object.keys(sourceCode.files).sort()
  const selectedContent = selectedFile ? sourceCode.files[selectedFile] : null

  const handleCopy = (filename: string, content: string) => {
    navigator.clipboard.writeText(content)
    setCopiedFile(filename)
    setTimeout(() => setCopiedFile(null), 2000)
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex h-[600px]">
        {/* File List Sidebar */}
        <div className="w-64 border-r border-border bg-muted/30 overflow-y-auto">
          <div className="p-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">
              Files ({fileNames.length})
            </h3>
          </div>
          <div className="p-2">
            {fileNames.map((filename) => (
              <button
                key={filename}
                onClick={() => setSelectedFile(filename)}
                className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-muted transition-colors ${
                  selectedFile === filename
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground'
                }`}
              >
                <span className="font-mono">{filename}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Code Content */}
        <div className="flex-1 flex flex-col bg-background">
          {selectedContent ? (
            <>
              {/* Header with filename and copy button */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                <h4 className="text-sm font-mono font-semibold text-foreground">
                  {selectedFile}
                </h4>
                <button
                  onClick={() => handleCopy(selectedFile!, selectedContent)}
                  className="px-3 py-1 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors flex items-center gap-2"
                >
                  {copiedFile === selectedFile ? (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              </div>

              {/* Code display */}
              <div className="flex-1 overflow-auto p-4">
                <pre className="text-sm font-mono text-foreground">
                  <code>{selectedContent}</code>
                </pre>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p>Select a file to view its contents</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
