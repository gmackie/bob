"use client";

import { InlineEditable } from "@bob/ui/inline-editable";

interface DescriptionEditorProps {
  value: string;
  onSave: (value: string) => unknown | Promise<unknown>;
  disabled?: boolean;
}

export function DescriptionEditor({
  value,
  onSave,
  disabled,
}: DescriptionEditorProps) {
  return (
    <InlineEditable
      value={value}
      onSave={onSave}
      disabled={disabled}
      multiline
      placeholder="Add a description..."
      inputClassName="min-h-[80px]"
    >
      {({ value: v, onClick }) => (
        <div
          onClick={onClick}
          className="cursor-pointer whitespace-pre-wrap text-sm leading-7 text-muted-foreground transition-colors hover:text-foreground"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") onClick();
          }}
        >
          {v || (
            <span className="text-muted-foreground">Add a description...</span>
          )}
        </div>
      )}
    </InlineEditable>
  );
}
