"use client"

import { validateCSVContent } from "@reputo/algorithm-validator"
import { AlertCircle, CheckCircle2, ChevronDown, Download } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { Control, FieldValues } from "react-hook-form"
import { useFormContext } from "react-hook-form"
import {
  Dropzone,
  DropzoneContent,
  DropzoneEmptyState,
} from "@/components/app/dropzone"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form"
import { Spinner } from "@/components/ui/spinner"
import { storageApi } from "@/lib/api/services"
import { cn } from "@/lib/utils"
import { useFormUploadOptional } from "../form-context"
import type { FormInput } from "../schema-builder"
import { InlineMarkdown } from "./inline-markdown"

interface CSVFieldProps {
  input: FormInput
  control: Control<FieldValues>
}

interface ExpectedColumn {
  key: string
  required?: boolean
  description?: string
}

function ExpectedColumns({
  inputKey,
  columns,
}: {
  inputKey: string
  columns: ExpectedColumn[]
}) {
  const [open, setOpen] = useState(false)

  const downloadTemplate = () => {
    const headers = columns.map((col) => col.key).join(",")
    const blob = new Blob([`${headers}\n`], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${inputKey}_sample.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border bg-muted/30"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium"
          >
            Expected columns ({columns.length})
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                open && "rotate-180"
              )}
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>
        <button
          type="button"
          onClick={downloadTemplate}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs hover:underline"
        >
          <Download className="size-3" />
          Sample template
        </button>
      </div>
      <CollapsibleContent>
        <div className="border-t px-3 py-2">
          <ul className="space-y-1">
            {columns.map((column) => (
              <li
                key={column.key}
                className="flex items-baseline gap-2 text-xs"
              >
                <Badge variant="outline" className="shrink-0 font-mono text-xs">
                  {column.key}
                  {column.required !== false && (
                    <span className="text-destructive ml-0.5">*</span>
                  )}
                </Badge>
                {column.description && (
                  <span className="text-muted-foreground min-w-0">
                    <InlineMarkdown>{column.description}</InlineMarkdown>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function CSVField({ input, control }: CSVFieldProps) {
  const { setError, clearErrors } = useFormContext<FieldValues>()
  const formUpload = useFormUploadOptional()
  const [validationResult, setValidationResult] = useState<{
    valid: boolean
    errors: string[]
  } | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  const isBusy = isUploading || isValidating
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // The cleanup matters: a composer row can be removed mid-upload, and a
  // field left registered as uploading would disable submit forever.
  useEffect(() => {
    if (!formUpload) {
      return
    }
    formUpload.setFieldUploading(input.key, isBusy)
    return () => {
      formUpload.setFieldUploading(input.key, false)
    }
  }, [isBusy, input.key, formUpload])

  const handleFileChange = async (
    file: File | null,
    onChange: (value: File | string | null) => void
  ) => {
    setValidationResult(null)
    setIsUploading(false)
    clearErrors(input.key)

    if (!file) {
      onChange(null)
      return
    }

    onChange(file)

    setIsValidating(true)
    try {
      const result = await validateCSVContent(file, input.csv)
      // Field names are positional inside a composer row, so a late write
      // from an unmounted field would land on whichever row took its place.
      if (!isMountedRef.current) {
        return
      }
      setValidationResult(result)

      if (result.valid) {
        clearErrors(input.key)
        setIsUploading(true)
        try {
          const contentType = file.type || "text/csv"
          const { key, url } = await storageApi.createUpload({
            filename: file.name,
            contentType,
          })
          const putResponse = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": contentType },
            body: file,
          })
          if (putResponse.status < 200 || putResponse.status >= 300) {
            throw new Error(`Upload failed with status ${putResponse.status}`)
          }
          if (!isMountedRef.current) {
            return
          }
          onChange(key)
        } catch (uploadError) {
          if (!isMountedRef.current) {
            return
          }
          const errorMessage = `Upload failed: ${
            uploadError instanceof Error ? uploadError.message : "Unknown error"
          }`
          setValidationResult({
            valid: false,
            errors: [errorMessage],
          })
          setError(input.key, {
            type: "manual",
            message: errorMessage,
          })
          onChange(null)
        } finally {
          setIsUploading(false)
        }
      } else {
        const errorMessage = result.errors.join("; ")
        setError(input.key, {
          type: "manual",
          message: errorMessage,
        })
        onChange(null)
      }
    } catch (error) {
      if (!isMountedRef.current) {
        return
      }
      const errorMessage = `Validation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
      setValidationResult({
        valid: false,
        errors: [errorMessage],
      })
      setError(input.key, {
        type: "manual",
        message: errorMessage,
      })
      onChange(null)
    } finally {
      setIsValidating(false)
    }
  }

  return (
    <FormField
      control={control}
      name={input.key}
      render={({ field: { value, onChange } }) => {
        const fileValue = value instanceof File ? value : null
        const filenameValue = typeof value === "string" && value ? value : null

        return (
          <FormItem>
            <FormLabel>
              {input.label}
              {input.required !== false && (
                <span className="text-destructive ml-1">*</span>
              )}
            </FormLabel>
            <FormControl>
              <div className="space-y-2">
                {filenameValue && (
                  <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground bg-muted rounded-md border">
                    <div className="flex-1">{filenameValue}</div>
                    <span className="text-xs text-muted-foreground">
                      Upload a new file to replace it
                    </span>
                  </div>
                )}

                <Dropzone
                  accept={{ "text/csv": [".csv"] }}
                  maxFiles={1}
                  src={fileValue ? [fileValue] : undefined}
                  onDrop={(acceptedFiles) => {
                    const file = acceptedFiles?.[0] || null
                    handleFileChange(file, onChange)
                  }}
                >
                  <DropzoneEmptyState />
                  <DropzoneContent />
                </Dropzone>

                {isUploading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner />
                    <span>Uploading file…</span>
                  </div>
                )}

                {validationResult && !isValidating && !isUploading && (
                  <Alert
                    variant={validationResult.valid ? "default" : "destructive"}
                  >
                    <div className="flex items-start gap-2">
                      {validationResult.valid ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4" />
                      )}
                      <div className="space-y-1 flex-1">
                        <AlertDescription>
                          {validationResult.valid ? (
                            <span className="text-green-600 dark:text-green-400 whitespace-nowrap">
                              CSV file is valid
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <div className="font-semibold">
                                Fix these issues:
                              </div>
                              <ul className="list-disc list-inside space-y-1">
                                {validationResult.errors.map((error) => (
                                  <li
                                    key={error}
                                    className="text-sm whitespace-nowrap"
                                  >
                                    {error}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </AlertDescription>
                      </div>
                    </div>
                  </Alert>
                )}
              </div>
            </FormControl>

            {input.description && (
              <FormDescription>
                <InlineMarkdown>{input.description}</InlineMarkdown>
              </FormDescription>
            )}

            {input.csv?.columns && input.csv.columns.length > 0 && (
              <ExpectedColumns
                inputKey={input.key}
                columns={input.csv.columns}
              />
            )}
          </FormItem>
        )
      }}
    />
  )
}
