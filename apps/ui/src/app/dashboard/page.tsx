"use client"

import {
  Clock,
  Combine,
  Database,
  FolderOpen,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  Target,
  Users,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { InputTypeBadge } from "@/components/app/input-type-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { type Algorithm, searchAlgorithms } from "@/core/algorithms"
import { cn } from "@/lib/utils"

const categories: {
  key: Algorithm["category"]
  title: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    key: "Engagement",
    title: "Engagement",
    description:
      "Algorithms measuring user participation and interaction quality",
    icon: <Target className="size-4 text-primary" />,
  },
  {
    key: "Activity",
    title: "Activity",
    description: "Algorithms tracking user contribution patterns and behavior",
    icon: <Users className="size-4 text-primary" />,
  },
  {
    key: "Custom",
    title: "Custom",
    description:
      "Composite algorithms combining multiple sub-algorithms into one score",
    icon: <Combine className="size-4 text-primary" />,
  },
]

type ViewMode = "grid" | "list"

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [searchQuery, setSearchQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")

  const filteredAlgorithms = useMemo(() => {
    const searchResults = searchAlgorithms(searchQuery)
    if (categoryFilter === "all") {
      return searchResults
    }
    return searchResults.filter((algo) => algo.category === categoryFilter)
  }, [searchQuery, categoryFilter])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 w-full">
          <div className="relative w-full">
            <Input
              placeholder="Search algorithms by name, description, or tags..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.key} value={cat.key}>
                  {cat.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="hidden sm:flex items-center border rounded-md">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              aria-label="Grid view"
              className="rounded-r-none border-0"
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              aria-label="List view"
              className="rounded-l-none border-0"
              onClick={() => setViewMode("list")}
            >
              <List className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        {filteredAlgorithms.length} algorithm
        {filteredAlgorithms.length !== 1 ? "s" : ""} found
      </div>

      {filteredAlgorithms.length === 0 ? (
        <Empty className="h-[400px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen className="size-6" />
            </EmptyMedia>
            <EmptyTitle>No Algorithms Found</EmptyTitle>
            <EmptyDescription>
              {searchQuery
                ? `No algorithms match "${searchQuery}". Try a different search term.`
                : "No algorithms are available at the moment."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-8">
          {categories.map((cat) => {
            const items = filteredAlgorithms.filter(
              (a) => a.category === cat.key
            )
            if (items.length === 0) return null
            return (
              <section key={cat.key} className="flex flex-col gap-4">
                <div className="flex items-start gap-2">
                  <div className="mt-1">{cat.icon}</div>
                  <div>
                    <h2 className="text-lg font-semibold">{cat.title}</h2>
                    <p className="text-sm text-muted-foreground">
                      {cat.description}
                    </p>
                  </div>
                </div>

                <div
                  className={
                    viewMode === "grid"
                      ? "grid gap-4 sm:grid-cols-2 [&>*]:h-full"
                      : "flex flex-col gap-4"
                  }
                >
                  {items.map((algo) => (
                    <Link
                      key={algo.id}
                      href={`/dashboard/algorithms/${algo.id}`}
                    >
                      <Card
                        key={algo.id}
                        className={cn(
                          "flex flex-col h-full transition-colors hover:border-foreground/20",
                          viewMode === "list" && "max-w-none"
                        )}
                      >
                        <CardHeader>
                          <div className="flex flex-col gap-2 min-w-0">
                            <Badge variant="outline" className="w-fit">
                              {algo.category}
                            </Badge>
                            <CardTitle
                              className={
                                viewMode === "list"
                                  ? "text-lg font-semibold"
                                  : "text-base font-semibold"
                              }
                            >
                              {algo.title}
                            </CardTitle>
                          </div>
                        </CardHeader>

                        <CardContent className="-mt-3">
                          <CardDescription>{algo.summary}</CardDescription>
                          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
                            <span className="inline-flex items-center gap-2 text-muted-foreground">
                              <Clock className="size-4" /> {algo.duration}
                            </span>
                            <span className="inline-flex items-center gap-2 text-muted-foreground">
                              <SlidersHorizontal className="size-4" />{" "}
                              {algo.inputSummary}
                            </span>
                            <Badge className="bg-emerald-500 text-white border-transparent">
                              {algo.level}
                            </Badge>
                          </div>
                        </CardContent>

                        <CardFooter className="flex-col items-start gap-3">
                          <div className="flex flex-col items-start gap-2">
                            <span className="text-sm font-medium">
                              Configurable Inputs
                            </span>
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
                            <div className="flex flex-col items-start gap-2">
                              <span className="text-sm font-medium">
                                Dependencies
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {algo.dependencyLabels.map((label) => (
                                  <span
                                    key={label}
                                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                    title="Data is fetched from this dependency"
                                  >
                                    <Database className="size-3" />
                                    {label}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardFooter>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
