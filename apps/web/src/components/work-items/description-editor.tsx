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
          className="cursor-pointer whitespace-pre-wrap text-sm leading-7 text-white/68 transition-colors hover:text-white/80"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") onClick();
          }}
        >
          {v || (
            <span className="text-white/35">Add a description...</span>
          )}
        </div>
      )}
    </InlineEditable>
  );
}
