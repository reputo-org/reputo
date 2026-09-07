import { ArrowLeft, Database, SlidersHorizontal } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { AlgorithmTabs } from "@/components/app/algorithm-tabs"
import { InputTypeBadge } from "@/components/app/input-type-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { algorithms, getAlgorithmById } from "@/core/algorithms"

type PageProps = { params: Promise<{ id: string }> }

export default async function AlgorithmPage({ params }: PageProps) {
  const { id } = await params
  const algo = getAlgorithmById(id)
  if (!algo) {
    notFound()
  }
  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 size-4" /> Back to algorithms
          </Link>
        </Button>
        <Badge variant="outline">{algo.category}</Badge>
      </div>

      <section className="grid gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{algo.title}</h1>
          <p className="text-muted-foreground max-w-2xl">{algo.summary}</p>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <SlidersHorizontal className="size-4" /> {algo.inputSummary}
            </span>
          </div>
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Inputs</span>
              <div className="flex flex-wrap gap-1.5">
                {algo.inputs.map((input) => (
                  <InputTypeBadge
                    key={input.key}
                    type={input.type}
                    label={input.label}
                  />
                ))}
              </div>
            </div>
            {algo.dependencyLabels.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Data sources</span>
                <div className="flex flex-wrap gap-1.5">
                  {algo.dependencyLabels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      title="Source of data used by this algorithm"
                    >
                      <Database className="size-3" />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <Suspense fallback={<div></div>}>
        <AlgorithmTabs algo={algo} />
      </Suspense>
    </>
  )
}

export async function generateStaticParams() {
  return algorithms.map((a) => ({ id: a.id }))
}
