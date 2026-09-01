"use client"

import { Check, ChevronsUpDown, X } from "lucide-react"
import { useState } from "react"
import type { Control } from "react-hook-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useCommunityResources } from "@/lib/api/hooks"
import { cn } from "@/lib/utils"
import type { FormInput } from "../schema-builder"
import { InlineMarkdown } from "./inline-markdown"
import { useDependentInputValue } from "./use-dependent-input-value"

interface CommunityResourcesFieldProps {
  input: FormInput
  control: Control<any>
}

/**
 * Definition-driven multi-select of a connection's resources (Discord
 * channels, GitHub repositories), with search. The resource list follows the
 * `dependsOn` connection input; until a connection is chosen the control stays
 * disabled. Stored ids the connection no longer lists stay visible as
 * removable raw-id badges.
 */
export function CommunityResourcesField({
  input,
  control,
}: CommunityResourcesFieldProps) {
  const [open, setOpen] = useState(false)
  const dependencyValue = useDependentInputValue(
    input.key,
    input.dependsOn,
    control
  )
  const connectionId =
    typeof dependencyValue === "string" ? dependencyValue : ""
  const { data: resources, isLoading } = useCommunityResources(
    connectionId,
    connectionId !== ""
  )

  const options = resources ?? []
  // Channel-style resources keep Discord's `#` convention; repositories don't.
  const displayName = (resource: { name: string; kind: string }) =>
    resource.kind === "repository" ? resource.name : `#${resource.name}`
  const labelFor = (id: string) => {
    const resource = options.find((candidate) => candidate.id === id)
    return resource ? displayName(resource) : id
  }

  return (
    <FormField
      control={control}
      name={input.key}
      render={({ field }) => {
        const selected: string[] = Array.isArray(field.value) ? field.value : []
        const toggle = (id: string) => {
          field.onChange(
            selected.includes(id)
              ? selected.filter((value) => value !== id)
              : [...selected, id]
          )
        }

        return (
          <FormItem>
            <FormLabel>
              {input.label}
              {input.required !== false && (
                <span className="text-destructive ml-1">*</span>
              )}
            </FormLabel>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <FormControl>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={connectionId === ""}
                    className="w-full justify-between font-normal"
                  >
                    {connectionId === ""
                      ? "Select a connection first"
                      : selected.length === 0
                        ? `Select ${input.label.toLowerCase()}`
                        : `${selected.length} selected`}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </FormControl>
              </PopoverTrigger>
              <PopoverContent
                className="w-(--radix-popover-trigger-width) p-0"
                align="start"
              >
                <Command>
                  <CommandInput
                    placeholder={`Search ${input.label.toLowerCase()}…`}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {isLoading ? "Loading…" : "No results."}
                    </CommandEmpty>
                    <CommandGroup>
                      {options.map((resource) => (
                        <CommandItem
                          key={resource.id}
                          value={`${resource.name} ${resource.id}`}
                          onSelect={() => toggle(resource.id)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selected.includes(resource.id)
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                          <span className="truncate">
                            {displayName(resource)}
                          </span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {resource.kind}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selected.map((id) => (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {labelFor(id)}
                    <button
                      type="button"
                      aria-label={`Remove ${labelFor(id)}`}
                      onClick={() => toggle(id)}
                      className="rounded-sm hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            {input.description && (
              <FormDescription>
                <InlineMarkdown>{input.description}</InlineMarkdown>
              </FormDescription>
            )}
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}
