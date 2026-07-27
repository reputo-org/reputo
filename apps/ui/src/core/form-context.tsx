"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"

interface FormUploadState {
  setFieldUploading: (fieldKey: string, isUploading: boolean) => void
  isUploading: boolean
  /** Keys of fields with an upload or validation still in flight. */
  uploadingFields: string[]
}

const FormUploadContext = createContext<FormUploadState | null>(null)

export function FormUploadProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [uploadingFields, setUploadingFields] = useState<string[]>([])

  const setFieldUploading = useCallback(
    (fieldKey: string, isUploading: boolean) => {
      setUploadingFields((prev) => {
        const hasField = prev.includes(fieldKey)
        if (isUploading && !hasField) {
          return [...prev, fieldKey]
        }
        if (!isUploading && hasField) {
          return prev.filter((key) => key !== fieldKey)
        }
        return prev
      })
    },
    []
  )

  const isUploading = uploadingFields.length > 0

  const contextValue = useMemo(
    () => ({
      setFieldUploading,
      isUploading,
      uploadingFields,
    }),
    [setFieldUploading, isUploading, uploadingFields]
  )

  return (
    <FormUploadContext.Provider value={contextValue}>
      {children}
    </FormUploadContext.Provider>
  )
}

export function useFormUpload() {
  const context = useContext(FormUploadContext)
  if (!context) {
    throw new Error("useFormUpload must be used within a FormUploadProvider")
  }
  return context
}

/**
 * Hook that safely uses the upload context if available
 * Returns null if not within a provider (for backwards compatibility)
 */
export function useFormUploadOptional() {
  return useContext(FormUploadContext)
}
