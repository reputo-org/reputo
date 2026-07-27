import { notFound } from "next/navigation"
import { Suspense } from "react"
import { PresetComposerCreate } from "@/components/app/presets/composer/preset-composer-create"
import { algorithms, getAlgorithmById } from "@/core/algorithms"

type PageProps = { params: Promise<{ id: string }> }

export default async function NewPresetPage({ params }: PageProps) {
  const { id } = await params
  const algo = getAlgorithmById(id)
  if (!algo) {
    notFound()
  }

  return (
    <Suspense fallback={<div></div>}>
      <PresetComposerCreate algo={algo} />
    </Suspense>
  )
}

export async function generateStaticParams() {
  return algorithms.map((a) => ({ id: a.id }))
}
