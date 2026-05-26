"use client"

import { AlertCircle, CheckCircle2 } from "lucide-react"
import { useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface JsonEditorProps {
  value: string
  onChange: (value: string) => void
  onValidChange?: (parsedValue: unknown) => void
  title?: string
  height?: string
}

export function JsonEditor({
  value,
  onChange,
  onValidChange,
  title = "JSON Editor",
  height = "600px",
}: JsonEditorProps) {
  const [error, setError] = useState<string | null>(null)
  const [isValid, setIsValid] = useState(true)

  const handleChange = (newValue: string) => {
    onChange(newValue)

    try {
      const parsed = JSON.parse(newValue)
      setError(null)
      setIsValid(true)
      onValidChange?.(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON")
      setIsValid(false)
    }
  }

  const formatJson = () => {
    try {
      const parsed = JSON.parse(value)
      const formatted = JSON.stringify(parsed, null, 2)
      onChange(formatted)
      setError(null)
      setIsValid(true)
      onValidChange?.(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON")
      setIsValid(false)
    }
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex items-center gap-2">
            {isValid ? (
              <div className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>Valid</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>Invalid</span>
              </div>
            )}
            <button
              type="button"
              onClick={formatJson}
              className="text-xs px-2 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80"
            >
              Format
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <textarea
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full p-4 font-mono text-sm bg-muted/30 border-t resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          style={{ height }}
          spellCheck={false}
        />
        {error && (
          <div className="px-4 pb-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
