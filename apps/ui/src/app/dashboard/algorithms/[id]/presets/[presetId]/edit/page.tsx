import { notFound } from "next/navigation"
import { PresetComposerEdit } from "@/components/app/presets/composer/preset-composer-edit"
import { getAlgorithmById } from "@/core/algorithms"

type PageProps = { params: Promise<{ id: string; presetId: string }> }

export default async function EditPresetPage({ params }: PageProps) {
  const { id, presetId } = await params
  const algo = getAlgorithmById(id)
  if (!algo) {
    notFound()
  }

  return <PresetComposerEdit algo={algo} presetId={presetId} />
}
