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
import { Input } from "@/components/ui/input"
import type { FormInput } from "../schema-builder"
import { InlineMarkdown } from "./inline-markdown"

interface DateFieldProps {
  input: FormInput
  control: Control<any>
}

export function DateField({ input, control }: DateFieldProps) {
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
          <FormControl>
            <Input
              type="date"
              min={input.minDate}
              max={input.maxDate}
              {...field}
            />
          </FormControl>
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
