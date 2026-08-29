"use client"

import type { Control } from "react-hook-form"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCommunityConnections } from "@/lib/api/hooks"
import type { FormInput } from "../schema-builder"
import { InlineMarkdown } from "./inline-markdown"

interface CommunityConnectionFieldProps {
  input: FormInput
  control: Control<any>
}

/**
 * Definition-driven picker for a community connection. Offers only active
 * connections of the widget's platform — the API rejects anything else — and
 * keeps a stored id visible as unavailable when it no longer qualifies, so an
 * old preset shows what it points at instead of a blank control.
 */
export function CommunityConnectionField({
  input,
  control,
}: CommunityConnectionFieldProps) {
  const { data: connections, isLoading } = useCommunityConnections()

  const selectable = (connections ?? []).filter(
    (connection) =>
      (input.platform === undefined ||
        connection.platform === input.platform) &&
      connection.status === "active"
  )

  return (
    <FormField
      control={control}
      name={input.key}
      render={({ field }) => {
        const storedUnavailable =
          typeof field.value === "string" &&
          field.value !== "" &&
          !selectable.some((connection) => connection.id === field.value)

        return (
          <FormItem>
            <FormLabel>
              {input.label}
              {input.required !== false && (
                <span className="text-destructive ml-1">*</span>
              )}
            </FormLabel>
            <Select onValueChange={field.onChange} value={field.value ?? ""}>
              <FormControl>
                <SelectTrigger className="w-full" disabled={isLoading}>
                  <SelectValue
                    placeholder={
                      isLoading
                        ? "Loading connections…"
                        : `Select ${input.label.toLowerCase()}`
                    }
                  />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {storedUnavailable && (
                  <SelectItem value={field.value as string}>
                    <span className="text-muted-foreground">
                      Unavailable connection ({field.value})
                    </span>
                  </SelectItem>
                )}
                {selectable.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {connection.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isLoading && selectable.length === 0 && (
              <FormDescription>
                No active {input.platform ?? "community"} connection yet.
                Connect one on the Communities page first.
              </FormDescription>
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
