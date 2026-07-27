"use client"

import { validateJSONContent } from "@reputo/algorithm-validator"
import { AlertCircle, CheckCircle2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { Control, FieldValues } from "react-hook-form"
import { useFormContext } from "react-hook-form"
import {
  Dropzone,
  DropzoneContent,
  DropzoneEmptyState,
} from "@/components/app/dropzone"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form"
import { Spinner } from "@/components/ui/spinner"
import { storageApi } from "@/lib/api/services"
import { useFormUploadOptional } from "../form-context"
import type { FormInput } from "../schema-builder"

interface JSONFieldProps {
  input: FormInput
  control: Control<FieldValues>
}

export function JSONField({ input, control }: JSONFieldProps) {
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
  }, [formUpload, input.key, isBusy])

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
      const result = await validateJSONContent(file, input.json)
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
          const contentType = file.type || "application/json"
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
                  <div className="flex items-center gap-2 rounded-md border bg-muted p-2 text-sm text-muted-foreground">
                    <div className="flex-1">{filenameValue}</div>
                    <span className="text-xs text-muted-foreground">
                      Upload a new file to replace it
                    </span>
                  </div>
                )}

                <Dropzone
                  accept={{ "application/json": [".json"] }}
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
                              JSON file is valid
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
          </FormItem>
        )
      }}
    />
  )
}
