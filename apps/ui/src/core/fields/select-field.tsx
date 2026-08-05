"use client"

import Image from "next/image"
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
import type { FormInput, SelectOption } from "../schema-builder"
import { InlineMarkdown } from "./inline-markdown"

interface SelectFieldProps {
  input: FormInput
  control: Control<any>
  /** Optional icon resolver keyed by option value. */
  getIconUrl?: (value: string) => string | undefined
}

function OptionIcon({ url, label }: { url: string; label: string }) {
  return (
    <Image
      src={url}
      alt={label}
      width={20}
      height={20}
      className="rounded-full shrink-0"
      unoptimized
    />
  )
}

export function SelectField({ input, control, getIconUrl }: SelectFieldProps) {
  const options: SelectOption[] = input.options ?? []

  return (
    <FormField
      control={control}
      name={input.key}
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {input.label}
            {input.required !== false && (
              <span className="text-destructive ml-1">*</span>
            )}
          </FormLabel>
          <Select onValueChange={field.onChange} value={field.value ?? ""}>
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={`Select ${input.label.toLowerCase()}`}
                >
                  {field.value &&
                    (() => {
                      const selected = options.find(
                        (o) => o.value === field.value
                      )
                      const icon = getIconUrl?.(field.value)
                      if (!selected) return field.value
                      return (
                        <span className="flex items-center gap-2">
                          {icon && (
                            <OptionIcon url={icon} label={selected.label} />
                          )}
                          {selected.label}
                        </span>
                      )
                    })()}
                </SelectValue>
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((option) => {
                const icon = getIconUrl?.(option.value)
                return (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center gap-2">
                      {icon && <OptionIcon url={icon} label={option.label} />}
                      {option.label}
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          {input.description && (
            <FormDescription>
              <InlineMarkdown>{input.description}</InlineMarkdown>
            </FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
