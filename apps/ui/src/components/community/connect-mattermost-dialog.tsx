"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  useConnectMattermostConnection,
  useValidateMattermostConnection,
} from "@/lib/api/hooks"
import type { MattermostTeamDto } from "@/lib/api/types"
import { describeMattermostConnectError } from "@/lib/community/mattermost"

const formSchema = z.object({
  serverUrl: z
    .string()
    .trim()
    .min(1, "Enter the server URL.")
    .refine(
      (value) => /^https?:\/\//i.test(value),
      "Enter the full URL, like https://chat.example.com"
    ),
  token: z.string().trim().min(1, "Enter the bot token."),
  teamId: z.string(),
})

type FormValues = z.infer<typeof formSchema>

interface ConnectMattermostDialogProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** Prefilled when reconnecting an existing connection. */
  initialServerUrl?: string
}

/**
 * Token-mode connect in one dialog with progressive disclosure: URL + token
 * first, then a team picker from the validate response. The token is sent to
 * the API for validation only — never echoed back, never kept client-side.
 */
export function ConnectMattermostDialog({
  open,
  onOpenChange,
  initialServerUrl,
}: ConnectMattermostDialogProps) {
  const [teams, setTeams] = useState<MattermostTeamDto[] | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const validate = useValidateMattermostConnection()
  const connect = useConnectMattermostConnection()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { serverUrl: initialServerUrl ?? "", token: "", teamId: "" },
  })

  // The dialog stays mounted between opens, so each open starts it clean —
  // applying the reconnect prefill of that open.
  useEffect(() => {
    if (open) {
      form.reset({ serverUrl: initialServerUrl ?? "", token: "", teamId: "" })
      setTeams(null)
      setServerError(null)
    }
  }, [open, initialServerUrl, form])

  // Changing the server or token invalidates the teams they produced.
  useEffect(() => {
    const subscription = form.watch((_, { name }) => {
      if (name === "serverUrl" || name === "token") {
        setTeams(null)
        form.setValue("teamId", "")
      }
    })
    return () => subscription.unsubscribe()
  }, [form])

  const isPending = validate.isPending || connect.isPending

  const onSubmit = async (values: FormValues) => {
    setServerError(null)

    try {
      if (teams === null) {
        const result = await validate.mutateAsync({
          serverUrl: values.serverUrl,
          token: values.token,
        })
        if (result.teams.length === 0) {
          setServerError(
            "The token works, but its bot is not a member of any team. Add the bot to a team first."
          )
          return
        }
        setTeams(result.teams)
        form.setValue(
          "teamId",
          result.teams.length === 1 ? result.teams[0].id : ""
        )
        return
      }

      if (!values.teamId) {
        form.setError("teamId", { message: "Pick a team." })
        return
      }
      await connect.mutateAsync({
        serverUrl: values.serverUrl,
        token: values.token,
        teamId: values.teamId,
      })
      toast.success("Mattermost connected")
      onOpenChange(false)
    } catch (error) {
      setServerError(describeMattermostConnectError(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect Mattermost</DialogTitle>
          <DialogDescription>
            Reputo reads the server with a bot account you create. Works with
            Mattermost current ESR and newer.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            noValidate
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="serverUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Server URL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://chat.example.com"
                      autoComplete="off"
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Public HTTPS address of the server; anything after the host
                    is ignored.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="token"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bot token</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="off"
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Access token of the bot account. It is stored encrypted and
                    never shown again.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {teams !== null && (
              <FormField
                control={form.control}
                name="teamId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Team</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Pick a team" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {teams.map((team) => (
                          <SelectItem key={team.id} value={team.id}>
                            {team.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      The bot reads public channels it is in, and private
                      channels only where it was invited.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {serverError && (
              <p className="text-destructive text-sm" role="alert">
                {serverError}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2
                    className="mr-2 size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {teams === null
                  ? isPending
                    ? "Checking…"
                    : "Continue"
                  : isPending
                    ? "Connecting…"
                    : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
