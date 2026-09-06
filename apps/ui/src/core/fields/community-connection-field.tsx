"use client"

import Link from "next/link"
import type { Control } from "react-hook-form"
import { Button } from "@/components/ui/button"
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
import { useCommunityLiveUpdates } from "@/lib/api/use-community-events"
import { describeStatus } from "@/lib/community/platforms"
import type { FormInput } from "../schema-builder"
import { InlineMarkdown } from "./inline-markdown"

interface CommunityConnectionFieldProps {
  input: FormInput
  control: Control<any>
}

// New tab so a half-filled composer draft survives the detour; the
// connections query refetches on window focus when the user returns.
const communitiesLink = (
  <Link href="/community" target="_blank" className="text-foreground underline">
    Communities page
  </Link>
)

/**
 * Definition-driven picker for a community connection. Offers only active
 * connections of the widget's platform — the API rejects anything else — and
 * keeps a stored id visible as unavailable when it no longer qualifies, so an
 * old preset shows what it points at instead of a blank control. The list is
 * live: a connection that breaks or recovers moves in and out of the picker
 * as the API's probes see it.
 */
export function CommunityConnectionField({
  input,
  control,
}: CommunityConnectionFieldProps) {
  useCommunityLiveUpdates()
  const {
    data: connections,
    isLoading,
    isError,
    refetch,
  } = useCommunityConnections()

  const forPlatform = (connections ?? []).filter(
    (connection) =>
      input.platform === undefined || connection.platform === input.platform
  )
  const selectable = forPlatform.filter(
    (connection) => connection.status === "active"
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
        const storedConnection = storedUnavailable
          ? forPlatform.find((connection) => connection.id === field.value)
          : undefined

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
                <SelectTrigger
                  className="w-full"
                  disabled={
                    isLoading || (selectable.length === 0 && !storedUnavailable)
                  }
                >
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
                      Unavailable connection (
                      {storedConnection?.name ?? field.value})
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
            {isError && (
              <FormDescription className="flex items-center gap-2">
                Could not load connections.
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => refetch()}
                >
                  Retry
                </Button>
              </FormDescription>
            )}
            {!isLoading &&
              !isError &&
              selectable.length === 0 &&
              !storedUnavailable && (
                <FormDescription>
                  {forPlatform.length > 0 ? (
                    <>
                      Your {input.platform ?? "community"} connection is{" "}
                      {describeStatus(
                        forPlatform[0].status
                      ).label.toLowerCase()}
                      . Fix it on the {communitiesLink} first.
                    </>
                  ) : (
                    <>
                      No active {input.platform ?? "community"} connection yet.
                      Connect one on the {communitiesLink} first.
                    </>
                  )}
                </FormDescription>
              )}
            {!isLoading && !isError && storedUnavailable && (
              <FormDescription className="text-destructive">
                {storedConnection ? (
                  <>
                    This preset points at {storedConnection.name}, which is{" "}
                    {describeStatus(
                      storedConnection.status
                    ).label.toLowerCase()}
                    . Fix it on the {communitiesLink} before running a snapshot.
                  </>
                ) : (
                  <>
                    This preset points at a connection that no longer exists.
                    Pick another one, or connect it again on the{" "}
                    {communitiesLink}.
                  </>
                )}
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
