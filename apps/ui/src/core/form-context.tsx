"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react"

interface FormUploadState {
  setFieldUploading: (fieldKey: string, isUploading: boolean) => void
  isUploading: boolean
}

const FormUploadContext = createContext<FormUploadState | null>(null)

export function FormUploadProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const uploadingFieldsRef = useRef<Set<string>>(new Set())
  const [uploadCount, setUploadCount] = useState(0)

  const setFieldUploading = useCallback(
    (fieldKey: string, isUploading: boolean) => {
      const hadField = uploadingFieldsRef.current.has(fieldKey)

      if (isUploading && !hadField) {
        uploadingFieldsRef.current.add(fieldKey)
        setUploadCount((prev) => prev + 1)
      } else if (!isUploading && hadField) {
        uploadingFieldsRef.current.delete(fieldKey)
        setUploadCount((prev) => Math.max(0, prev - 1))
      }
    },
    []
  )

  const isUploading = uploadCount > 0

  const contextValue = useMemo(
    () => ({
      setFieldUploading,
      isUploading,
    }),
    [setFieldUploading, isUploading]
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
