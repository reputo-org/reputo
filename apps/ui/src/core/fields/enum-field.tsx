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
import type { FormInput } from "../schema-builder"
import { InlineMarkdown } from "./inline-markdown"

interface EnumFieldProps {
  input: FormInput
  control: Control<any>
}

export function EnumField({ input, control }: EnumFieldProps) {
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
          <Select onValueChange={field.onChange} value={field.value}>
            <FormControl>
              <SelectTrigger>
                <SelectValue
                  placeholder={`Select ${input.label.toLowerCase()}`}
                />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {input.enum?.map((option: string) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              )) || null}
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
