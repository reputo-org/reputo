"use client"

import { validateCSVContent } from "@reputo/algorithm-validator"
import { AlertCircle, CheckCircle2, Download } from "lucide-react"
import { useEffect, useState } from "react"
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
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form"
import { Spinner } from "@/components/ui/spinner"
import { storageApi } from "@/lib/api/services"
import { useFormUploadOptional } from "../form-context"
import type { FormInput } from "../schema-builder"

interface CSVFieldProps {
  input: FormInput
  control: Control<FieldValues>
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

  useEffect(() => {
    if (formUpload) {
      formUpload.setFieldUploading(input.key, isBusy)
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
          onChange(key)
        } catch (uploadError) {
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
                      (Upload new file to replace)
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
                    <span>Uploading file...</span>
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
                              CSV structure is valid
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <div className="font-semibold">
                                Validation Errors:
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
              <FormDescription>{input.description}</FormDescription>
            )}

            {input.csv?.columns && input.csv.columns.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Download className="size-3.5" />
                  <button
                    type="button"
                    onClick={() => {
                      const columns = input.csv?.columns || []
                      const headers = columns
                        .map((col: { key: string }) => col.key)
                        .join(",")
                      const blob = new Blob([`${headers}\n`], {
                        type: "text/csv",
                      })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement("a")
                      a.href = url
                      a.download = `${input.key}_sample.csv`
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                      URL.revokeObjectURL(url)
                    }}
                    className="hover:text-foreground hover:underline transition-colors"
                  >
                    Download sample template
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {input.csv.columns.map((column: any) => (
                    <Badge
                      key={column.key}
                      variant="outline"
                      className="text-xs font-mono"
                    >
                      {column.key}
                      {column.required !== false && (
                        <span className="text-destructive ml-0.5">*</span>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </FormItem>
        )
      }}
    />
  )
}
