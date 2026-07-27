"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { AlertCircle, ArrowLeft } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Form } from "@/components/ui/form"
import type { Algorithm } from "@/core/algorithms"
import { FormUploadProvider } from "@/core/form-context"
import { getInputGroups } from "@/core/preset-groups"
import { buildSchemaFromAlgorithm, buildZodSchema } from "@/core/schema-builder"
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard"
import {
  useCreateAlgorithmPreset,
  useUpdateAlgorithmPreset,
} from "@/lib/api/hooks"
import type {
  AlgorithmPresetResponseDto,
  CreateAlgorithmPresetDto,
  UpdateAlgorithmPresetDto,
} from "@/lib/api/types"
import { validateAlgorithmPresetClient } from "../algorithm-client-validation"
import { buildPresetInputsFromForm } from "../preset-payload"
import { buildComposerDefaults } from "./build-composer-defaults"
import { ComposerActionBar } from "./composer-action-bar"
import { applyApiErrorsToForm, applyFieldErrors } from "./composer-errors"
import { ComposerFields } from "./composer-fields"
import { ComposerReviewPanel } from "./composer-review-panel"
import { DiscardChangesDialog } from "./discard-changes-dialog"

interface PresetComposerProps {
  algo: Algorithm
  mode: "create" | "edit"
  /** Edit target, or the duplicate source in create mode. */
  basePreset?: AlgorithmPresetResponseDto | null
  /** Initial preset name (suggestion or "<source> (copy)"). */
  initialName?: string
  /** Initial description, used when the base preset has none. */
  initialDescription?: string
}

export function PresetComposer(props: PresetComposerProps) {
  return (
    <FormUploadProvider>
      <PresetComposerInner {...props} />
    </FormUploadProvider>
  )
}

function PresetComposerInner({
  algo,
  mode,
  basePreset,
  initialName,
  initialDescription,
}: PresetComposerProps) {
  const router = useRouter()
  const createMutation = useCreateAlgorithmPreset()
  const updateMutation = useUpdateAlgorithmPreset()
  const [generalErrors, setGeneralErrors] = useState<string[]>([])
  const didSubmitRef = useRef(false)

  const version = basePreset?.version || "1.0.0"

  const schema = useMemo(
    () => buildSchemaFromAlgorithm(algo, version),
    [algo, version]
  )

  const groups = useMemo(
    () => getInputGroups(algo.id, schema.inputs),
    [algo.id, schema.inputs]
  )

  const defaultValues = useMemo(
    () =>
      buildComposerDefaults({
        schema,
        algorithm: algo,
        preset: basePreset,
        name: initialName,
        description: initialDescription,
      }),
    [schema, algo, basePreset, initialName, initialDescription]
  )

  const zodSchema = useMemo(() => buildZodSchema(schema as any), [schema])

  const form = useForm({
    resolver: zodResolver(zodSchema as any),
    defaultValues,
    mode: "onChange",
    reValidateMode: "onChange",
  })

  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false)
  // `dirtyFields` tracks user edits only. Global `isDirty` deep-compares
  // against defaults, so definition-driven normalization of a stored preset
  // would make it stick true for a user who changed nothing.
  const isDirty = Object.keys(form.formState.dirtyFields).length > 0
  useUnsavedChangesGuard(isDirty && !didSubmitRef.current)

  const presetsUrl = `/dashboard/algorithms/${algo.id}?tab=presets`

  const handleCancel = () => {
    if (isDirty && !didSubmitRef.current) {
      setIsDiscardDialogOpen(true)
      return
    }
    router.push(presetsUrl)
  }

  const formKeys = useMemo(
    () => new Set(schema.inputs.map((input) => input.key)),
    [schema.inputs]
  )

  const handleSubmit = async (data: Record<string, unknown>) => {
    setGeneralErrors([])

    try {
      const inputs = buildPresetInputsFromForm({
        algorithmInputs: algo.inputs,
        data,
        existingInputs: basePreset?.inputs,
      })

      const name = data.name as string | undefined
      const description = data.description as string | undefined

      const clientErrors = await validateAlgorithmPresetClient({
        key: algo.id,
        version,
        inputs,
        name: name || basePreset?.name,
        description: description || basePreset?.description,
      })

      if (clientErrors.length > 0) {
        setGeneralErrors(
          applyFieldErrors(clientErrors, {
            formKeys,
            setError: form.setError,
            values: data,
          })
        )
        return
      }

      if (mode === "edit" && basePreset) {
        const updateData: UpdateAlgorithmPresetDto = { inputs }
        if (name) {
          updateData.name = name
        }
        if (description) {
          updateData.description = description
        }

        await updateMutation.mutateAsync({
          id: basePreset._id,
          data: updateData,
        })
        didSubmitRef.current = true
        toast.success("Preset updated")
        router.push(`${presetsUrl}&updated=${basePreset._id}`)
      } else {
        const createData: CreateAlgorithmPresetDto = {
          key: algo.id,
          version,
          name,
          description,
          inputs,
        }

        const created = await createMutation.mutateAsync(createData)
        didSubmitRef.current = true
        toast.success("Preset created")
        router.push(`${presetsUrl}&created=${created._id}`)
      }
    } catch (error) {
      const remaining = applyApiErrorsToForm(error, {
        formKeys,
        setError: form.setError,
        values: data,
      })
      setGeneralErrors(
        remaining.length > 0
          ? remaining
          : ["Failed to save the preset. Please try again."]
      )
    }
  }

  const submitLabel = mode === "edit" ? "Save changes" : "Create preset"

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        noValidate
        className="pb-24 lg:pb-0"
      >
        <div className="mb-6 flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCancel}
          >
            <ArrowLeft className="mr-2 size-4" /> Presets
          </Button>
          <Badge variant="outline">{algo.category}</Badge>
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold">
            {mode === "edit" ? "Edit preset" : "New preset"}
          </h1>
          <p className="text-muted-foreground">
            {mode === "edit"
              ? `Update the inputs for this ${algo.title} preset.`
              : `Configure the inputs for ${algo.title}.`}
          </p>
        </div>

        {generalErrors.length > 0 && (
          <Alert variant="destructive" className="mb-4 lg:hidden">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {generalErrors.map((message) => (
                <div key={message}>{message}</div>
              ))}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <ComposerFields schema={schema} groups={groups} />
          <ComposerReviewPanel
            algo={algo}
            schema={schema}
            generalErrors={generalErrors}
            submitLabel={submitLabel}
            onCancel={handleCancel}
          />
        </div>

        <ComposerActionBar
          schema={schema}
          submitLabel={submitLabel}
          onCancel={handleCancel}
        />

        <DiscardChangesDialog
          isOpen={isDiscardDialogOpen}
          onOpenChange={setIsDiscardDialogOpen}
          onConfirm={() => router.push(presetsUrl)}
        />
      </form>
    </Form>
  )
}
