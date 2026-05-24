"use client"

import { AlertCircle } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getAlgorithmById } from "@/core/algorithms"
import { ReputoForm } from "@/core/reputo-form"
import { buildSchemaFromAlgorithm } from "@/core/schema-builder"
import type {
  AlgorithmPresetResponseDto,
  UpdateAlgorithmPresetDto,
} from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { validateAlgorithmPresetClient } from "./algorithm-client-validation"
import { extractApiFieldErrors } from "./error-utils"
import {
  buildPresetInputsFromForm,
  normalizeNumericPresetValue,
} from "./preset-payload"

interface EditPresetDialogProps {
  isOpen: boolean
  onClose: () => void
  preset: AlgorithmPresetResponseDto | null
  onUpdatePreset: (data: UpdateAlgorithmPresetDto) => Promise<void>
  isLoading: boolean
  error?: unknown
}

export function EditPresetDialog({
  isOpen,
  onClose,
  preset,
  onUpdatePreset,
  isLoading,
  error: backendError,
}: EditPresetDialogProps) {
  const [formErrors, setFormErrors] = useState<
    { field: string; message: string }[]
  >([])
  const isSubmittingRef = useRef(false)

  const algorithm = useMemo(() => {
    if (!preset) return null
    return getAlgorithmById(preset.key)
  }, [preset])

  const schema = useMemo(() => {
    if (!algorithm) return null
    return buildSchemaFromAlgorithm(algorithm, preset?.version || "1.0.0")
  }, [algorithm, preset])

  const hasResourceSelector = useMemo(
    () =>
      schema?.inputs.some(
        (input) =>
          input.type === "array" && input.widget === "resource_selector"
      ) ?? false,
    [schema]
  )

  const hasSubAlgorithm = useMemo(
    () =>
      schema?.inputs.some((input) => input.type === "sub_algorithm") ?? false,
    [schema]
  )

  const needsWideDialog = hasResourceSelector || hasSubAlgorithm

  const defaultValues = useMemo(() => {
    if (!preset || !algorithm) return {}

    const defaults: Record<string, unknown> = {
      key: preset.key,
      version: preset.version,
      name: preset.name || "",
      description: preset.description || "",
    }

    preset.inputs.forEach((presetInput) => {
      const raw = presetInput.value
      const algoInput = algorithm.inputs.find((i) => i.key === presetInput.key)
      if (algoInput?.type === "array" && Array.isArray(raw)) {
        defaults[presetInput.key] = raw
      } else if (algoInput?.type === "sub_algorithm" && Array.isArray(raw)) {
        defaults[presetInput.key] = raw
      } else {
        const isNumeric =
          algoInput && ["number", "integer", "slider"].includes(algoInput.type)
        defaults[presetInput.key] = isNumeric
          ? normalizeNumericPresetValue(raw)
          : raw
      }
    })

    return defaults
  }, [preset, algorithm])

  const backendErrors = useMemo(() => {
    if (!backendError) return []
    return extractApiFieldErrors(backendError)
  }, [backendError])

  const allErrors = [...formErrors, ...backendErrors]

  const handleSubmit = async (data: Record<string, unknown>) => {
    if (!preset || !algorithm) return
    if (isSubmittingRef.current) return
    isSubmittingRef.current = true
    setFormErrors([])

    try {
      const updateData: UpdateAlgorithmPresetDto = {}

      if (data.name !== undefined && data.name !== "") {
        updateData.name = data.name as string
      }
      if (data.description !== undefined && data.description !== "") {
        updateData.description = data.description as string
      }

      const inputs = buildPresetInputsFromForm({
        algorithmInputs: algorithm.inputs,
        data,
        existingInputs: preset.inputs,
      })
      updateData.inputs = inputs

      const clientErrors = await validateAlgorithmPresetClient({
        key: preset.key,
        version: preset.version,
        inputs,
        name: updateData.name !== undefined ? updateData.name : preset.name,
        description:
          updateData.description !== undefined
            ? updateData.description
            : preset.description,
      })

      if (clientErrors.length > 0) {
        setFormErrors(clientErrors)
        return
      }

      await onUpdatePreset(updateData)
      onClose()
    } catch (err) {
      const parsedErrors = extractApiFieldErrors(err)
      setFormErrors(parsedErrors)
    } finally {
      isSubmittingRef.current = false
    }
  }

  const handleClose = () => {
    setFormErrors([])
    onClose()
  }

  if (!preset || !algorithm || !schema) {
    return null
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose()
      }}
    >
      <DialogContent
        className={cn(
          "max-h-[90vh] overflow-y-auto",
          needsWideDialog ? "sm:max-w-5xl" : "sm:max-w-2xl"
        )}
      >
        <DialogHeader>
          <DialogTitle>Edit Preset</DialogTitle>
          <DialogDescription>
            Update your preset name, description, and input files for{" "}
            {algorithm.title}.
          </DialogDescription>
        </DialogHeader>

        {allErrors.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {allErrors.map((e) => (
                <div key={`${e.field}:${e.message}`}>
                  {e.field !== "_general"
                    ? `${e.field}: ${e.message}`
                    : e.message}
                </div>
              ))}
            </AlertDescription>
          </Alert>
        )}

        <ReputoForm
          key={preset._id}
          schema={schema}
          onSubmit={handleSubmit}
          submitLabel="Update Preset"
          defaultValues={defaultValues}
          hiddenFields={["key", "version"]}
          className="mt-4"
        />
      </DialogContent>
    </Dialog>
  )
}
