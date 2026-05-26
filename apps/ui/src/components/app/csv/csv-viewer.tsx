"use client"

import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type SortDirection = "asc" | "desc" | null

export interface CSVViewerProps {
  href: string
  className?: string
  hasHeader?: boolean
  delimiter?: string
  fillHeight?: boolean
  /**
   * Safety limits to avoid blowing up browser RAM for huge CSVs.
   * We'll only download up to `maxPreviewBytes` and parse up to `maxPreviewRows`.
   */
  maxPreviewRows?: number
  maxPreviewBytes?: number
  pageSize?: number
}

interface ParsedCSV {
  headers: string[]
  rows: string[][]
  truncated: boolean
}

function parseCSV(text: string, delimiter = ",", maxRows?: number): ParsedCSV {
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const rows: string[][] = []
  let current: string[] = []
  let field = ""
  let inQuotes = false
  let truncated = false
  const maxTotalRows = maxRows != null ? Math.max(0, maxRows) + 1 : null

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    const next = src[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === delimiter) {
        current.push(field)
        field = ""
      } else if (ch === "\n") {
        current.push(field)
        rows.push(current)
        current = []
        field = ""
        if (maxTotalRows != null && rows.length >= maxTotalRows) {
          truncated = true
          break
        }
      } else {
        field += ch
      }
    }
  }
  if (!truncated) {
    current.push(field)
    if (current.length > 1 || (current.length === 1 && current[0] !== "")) {
      rows.push(current)
    }
  }

  if (rows.length === 0) {
    return { headers: [], rows: [], truncated: false }
  }

  const headers = rows[0].map((h) =>
    h
      .replace(/^\uFEFF/, "")
      .replace(/\u00a0/g, " ")
      .trim()
      .replace(/^["']+|["']+$/g, "")
  )
  const dataRows = rows.slice(1)
  const normalizedRows = dataRows.map((r) => {
    if (r.length === headers.length) return r
    if (r.length < headers.length)
      return [...r, ...Array(headers.length - r.length).fill("")]
    return r.slice(0, headers.length)
  })
  return { headers, rows: normalizedRows, truncated }
}

function isNumeric(value: string): boolean {
  if (value == null) return false
  const v = value.trim()
  if (v === "") return false
  const n = Number(v)
  return Number.isFinite(n)
}

async function readTextUpToBytes(
  res: Response,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader()
  if (!reader) {
    const text = await res.text()
    if (text.length <= maxBytes) return { text, truncated: false }
    return { text: text.slice(0, maxBytes), truncated: true }
  }

  const decoder = new TextDecoder("utf-8")
  let received = 0
  let out = ""
  let truncated = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    const remaining = maxBytes - received
    if (remaining <= 0) {
      truncated = true
      break
    }

    if (value.byteLength <= remaining) {
      out += decoder.decode(value, { stream: true })
      received += value.byteLength
    } else {
      out += decoder.decode(value.slice(0, remaining), { stream: true })
      received += remaining
      truncated = true
      break
    }
  }

  out += decoder.decode()
  try {
    await reader.cancel()
  } catch {}
  return { text: out, truncated }
}

export function CSVViewer({
  href,
  className,
  hasHeader = true,
  delimiter = ",",
  fillHeight = false,
  maxPreviewRows = 250_000,
  maxPreviewBytes = 100_000_000,
  pageSize: pageSizeProp = 50,
}: CSVViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [csv, setCsv] = useState<ParsedCSV>({
    headers: [],
    rows: [],
    truncated: false,
  })
  const [query, setQuery] = useState("")
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDir, setSortDir] = useState<SortDirection>(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(0)
  const [page, setPage] = useState(1)
  const pageSize = Math.max(10, pageSizeProp)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(href, {
        cache: "no-store",
        headers: {
          Range: `bytes=0-${Math.max(0, maxPreviewBytes - 1)}`,
        },
      })
      if (!res.ok) {
        throw new Error(`Failed to fetch CSV (${res.status})`)
      }
      const { text, truncated: bytesTruncated } = await readTextUpToBytes(
        res,
        maxPreviewBytes
      )
      const parsed = parseCSV(text, delimiter, maxPreviewRows)
      let finalParsed = parsed
      if (!hasHeader && parsed.rows.length > 0) {
        const colCount = Math.max(...parsed.rows.map((r) => r.length))
        finalParsed = {
          headers: Array.from(
            { length: colCount },
            (_, idx) => `Column ${idx + 1}`
          ),
          rows: parsed.rows,
          truncated: parsed.truncated,
        }
      }
      setCsv({
        ...finalParsed,
        truncated: finalParsed.truncated || bytesTruncated,
      })
      setLastRefreshedAt(Date.now())
      setPage(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [href, delimiter, hasHeader, maxPreviewBytes, maxPreviewRows])

  useEffect(() => {
    void load()
  }, [load])

  const filteredRows = useMemo(() => {
    if (!query) return csv.rows
    const q = query.toLowerCase()
    return csv.rows.filter((row) =>
      row.some((cell) => cell?.toLowerCase?.().includes(q))
    )
  }, [csv.rows, query])

  const sortedRows = useMemo(() => {
    if (sortCol == null || sortDir == null) return filteredRows
    const colIndex = sortCol
    const accessor = (row: string[]) => row[colIndex] ?? ""

    const numericSample = filteredRows
      .slice(0, 25)
      .every((r) => isNumeric(accessor(r)))
    const sign = sortDir === "asc" ? 1 : -1
    const withIndex = filteredRows.map((r, i) => ({ r, i }))

    withIndex.sort((a, b) => {
      const va = accessor(a.r)
      const vb = accessor(b.r)
      if (numericSample) {
        const na = Number(va)
        const nb = Number(vb)
        if (na < nb) return -1 * sign
        if (na > nb) return 1 * sign
      } else {
        const sa = (va || "").toString().toLowerCase()
        const sb = (vb || "").toString().toLowerCase()
        if (sa < sb) return -1 * sign
        if (sa > sb) return 1 * sign
      }
      return a.i - b.i
    })
    return withIndex.map((x) => x.r)
  }, [filteredRows, sortCol, sortDir])

  const pageCount = useMemo(() => {
    return Math.max(1, Math.ceil(sortedRows.length / pageSize))
  }, [sortedRows.length, pageSize])

  const pageRows = useMemo(() => {
    const safePage = Math.min(Math.max(1, page), pageCount)
    const start = (safePage - 1) * pageSize
    return {
      start,
      rows: sortedRows.slice(start, start + pageSize),
      page: safePage,
    }
  }, [sortedRows, page, pageCount, pageSize])

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), pageCount))
  }, [pageCount])

  const handleHeaderClick = (index: number) => {
    if (sortCol !== index) {
      setSortCol(index)
      setSortDir("asc")
    } else {
      if (sortDir === "asc") setSortDir("desc")
      else if (sortDir === "desc") {
        setSortDir(null)
        setSortCol(null)
      } else setSortDir("asc")
    }
  }

  return (
    <div
      className={`${className ?? ""} ${
        fillHeight ? "h-full flex flex-col min-w-0" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Input
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-60"
        />
        <div className="text-xs text-muted-foreground">
          Showing {sortedRows.length} of {csv.rows.length} rows
          {lastRefreshedAt
            ? ` • Updated ${new Date(lastRefreshedAt).toLocaleTimeString(
                "en-US",
                {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }
              )}`
            : ""}
          {csv.truncated
            ? ` • Preview limited to ${maxPreviewRows} rows / ${Math.round(
                maxPreviewBytes / 1_000_000
              )}MB`
            : ""}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(1)}
            disabled={loading || pageRows.page <= 1}
          >
            First
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={loading || pageRows.page <= 1}
          >
            Prev
          </Button>
          <div className="text-xs text-muted-foreground whitespace-nowrap">
            Page {pageRows.page} / {pageCount}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={loading || pageRows.page >= pageCount}
          >
            Next
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(pageCount)}
            disabled={loading || pageRows.page >= pageCount}
          >
            Last
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 mb-2">
          Failed to load CSV: {error}
        </div>
      )}

      <div
        className={`border rounded-md overflow-hidden min-w-0 ${
          fillHeight ? "flex-1" : ""
        }`}
      >
        <div
          className={`${
            fillHeight ? "h-full" : "max-h-[60vh]"
          } overflow-auto min-w-0`}
        >
          <Table>
            <TableHeader>
              <TableRow>
                {csv.headers.map((h, idx) => {
                  const isActive = sortCol === idx && sortDir !== null
                  const headerKey =
                    h || `Column-${String.fromCharCode(65 + idx)}`
                  return (
                    <TableHead
                      key={headerKey}
                      className="cursor-pointer select-none"
                      onClick={() => handleHeaderClick(idx)}
                      title="Click to sort"
                    >
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="whitespace-pre-wrap wrap-break-word">
                          {h || `Column ${idx + 1}`}
                        </span>
                        {isActive ? (
                          sortDir === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                    </TableHead>
                  )
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={csv.headers.length}>
                    <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground">
                      <Spinner />
                      <span>Loading CSV…</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={csv.headers.length}>
                    <div className="text-center py-10 text-muted-foreground">
                      No rows found
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.rows.map((row, rowIdx) => {
                  const rowKey = `row-${pageRows.start + rowIdx}`
                  return (
                    <TableRow key={rowKey}>
                      {csv.headers.map((headerName, colIndex) => {
                        const value = row[colIndex] ?? ""
                        const cellKey = `${colIndex}-${headerName}-${value}`
                        return (
                          <TableCell key={cellKey}>
                            <div className="min-w-0 whitespace-pre-wrap wrap-break-word">
                              {value}
                            </div>
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

export default CSVViewer
