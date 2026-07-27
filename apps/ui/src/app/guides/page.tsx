import { Guides } from "@/components/app/guides/guides"

export const metadata = {
  title: "Guides",
}

export default function GuidesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Guides</h1>
        <p className="text-sm text-muted-foreground">
          Step-by-step help for common tasks.
        </p>
      </div>
      <Guides />
    </div>
  )
}
