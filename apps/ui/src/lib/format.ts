export function formatDateTime(value: string | undefined | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function formatRelativeFromNow(
  value: string | undefined | null,
  now = new Date()
): string {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const diffMs = date.getTime() - now.getTime()
  const diffSeconds = Math.round(diffMs / 1000)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ]

  for (const [unit, secondsInUnit] of units) {
    if (Math.abs(diffSeconds) >= secondsInUnit || unit === "second") {
      return formatter.format(Math.round(diffSeconds / secondsInUnit), unit)
    }
  }

  return formatter.format(diffSeconds, "second")
}
