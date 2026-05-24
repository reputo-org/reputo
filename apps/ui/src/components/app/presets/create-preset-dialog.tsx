"use client"

import { Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { Algorithm } from "@/core/algorithms"
import { ReputoForm } from "@/core/reputo-form"
import { buildSchemaFromAlgorithm } from "@/core/schema-builder"
import type { CreateAlgorithmPresetDto } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { validateAlgorithmPresetClient } from "./algorithm-client-validation"
import { extractApiErrorMessages } from "./error-utils"
import { buildPresetInputsFromForm } from "./preset-payload"

interface CreatePresetDialogProps {
  algo?: Algorithm
  onCreatePreset: (data: CreateAlgorithmPresetDto) => Promise<void>
  isLoading: boolean
}

export function CreatePresetDialog({
  algo,
  onCreatePreset,
  isLoading,
}: CreatePresetDialogProps) {
  const [isOpen, setIsOpen] = useState(false)

  const schema = useMemo(() => {
    if (!algo) return null
    return buildSchemaFromAlgorithm(algo, "1.0.0")
  }, [algo])

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

  const handleSubmit = async (data: Record<string, unknown>) => {
    if (!algo) return

    try {
      const createData: CreateAlgorithmPresetDto = {
        key: (data.key as string) || algo.id,
        version: (data.version as string) || "1.0.0",
        name: data.name as string | undefined,
        description: data.description as string | undefined,
        inputs: buildPresetInputsFromForm({
          algorithmInputs: algo.inputs,
          data,
        }),
      }

      const clientErrors = await validateAlgorithmPresetClient({
        key: createData.key,
        version: createData.version,
        inputs: createData.inputs,
        name: createData.name,
        description: createData.description,
      })

      if (clientErrors.length > 0) {
        clientErrors.forEach((error) => {
          toast.error(error.message)
        })
        return
      }

      await onCreatePreset(createData)

      setIsOpen(false)
      toast.success("Preset created successfully")
    } catch (err) {
      const errorMessages = extractApiErrorMessages(err)
      if (errorMessages.length > 0) {
        errorMessages.forEach((msg) => {
          toast.error(msg)
        })
      } else {
        toast.error("Failed to create preset. Please try again.")
      }
    }
  }

  if (!algo || !schema) {
    return null
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 size-4" /> Create New Preset
        </Button>
      </DialogTrigger>
      <DialogContent
        className={cn(
          "max-h-[90vh] flex flex-col p-0",
          needsWideDialog ? "sm:max-w-5xl" : "sm:max-w-lg"
        )}
      >
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b">
          <DialogTitle>Create New Preset</DialogTitle>
          <DialogDescription>
            Configure the inputs for {algo.title}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ReputoForm
            schema={schema}
            onSubmit={handleSubmit}
            submitLabel="Create Preset"
            defaultValues={{
              key: algo.id,
              version: "1.0.0",
            }}
            hiddenFields={["key", "version"]}
            compact
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
