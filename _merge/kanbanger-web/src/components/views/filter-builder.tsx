"use client";

import { useState } from "react";
import { Button } from "@linear-clone/ui/components/button";
import { cn } from "@linear-clone/ui/lib/utils";
import { Plus, X, ChevronDown } from "lucide-react";

type FilterOperator = "is" | "is_not" | "contains" | "not_contains" | "is_empty" | "is_not_empty";

interface FilterCondition {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string | string[];
}

interface FilterGroup {
  id: string;
  type: "and" | "or";
  conditions: FilterCondition[];
}

interface FilterBuilderProps {
  value: FilterGroup;
  onChange: (filters: FilterGroup) => void;
  availableFields: Array<{
    key: string;
    label: string;
    type: "select" | "text" | "date" | "user";
    options?: Array<{ value: string; label: string }>;
  }>;
  className?: string;
}

const OPERATORS: Record<string, { label: string; needsValue: boolean }> = {
  is: { label: "is", needsValue: true },
  is_not: { label: "is not", needsValue: true },
  contains: { label: "contains", needsValue: true },
  not_contains: { label: "does not contain", needsValue: true },
  is_empty: { label: "is empty", needsValue: false },
  is_not_empty: { label: "is not empty", needsValue: false },
};

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export function FilterBuilder({
  value,
  onChange,
  availableFields,
  className,
}: FilterBuilderProps) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const addCondition = () => {
    const firstField = availableFields[0];
    if (!firstField) return;

    const newCondition: FilterCondition = {
      id: generateId(),
      field: firstField.key,
      operator: "is",
      value: "",
    };

    onChange({
      ...value,
      conditions: [...value.conditions, newCondition],
    });
  };

  const updateCondition = (conditionId: string, updates: Partial<FilterCondition>) => {
    onChange({
      ...value,
      conditions: value.conditions.map((c) =>
        c.id === conditionId ? { ...c, ...updates } : c
      ),
    });
  };

  const removeCondition = (conditionId: string) => {
    onChange({
      ...value,
      conditions: value.conditions.filter((c) => c.id !== conditionId),
    });
  };

  const toggleGroupType = () => {
    onChange({
      ...value,
      type: value.type === "and" ? "or" : "and",
    });
  };

  return (
    <div className={cn("space-y-2", className)}>
      {value.conditions.length > 0 && (
        <div className="space-y-2">
          {value.conditions.map((condition, index) => {
            const field = availableFields.find((f) => f.key === condition.field);
            const operator = OPERATORS[condition.operator];

            return (
              <div key={condition.id} className="flex items-center gap-2">
                {index > 0 && (
                  <button
                    type="button"
                    onClick={toggleGroupType}
                    className="w-12 shrink-0 rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    {value.type.toUpperCase()}
                  </button>
                )}
                {index === 0 && <div className="w-12 shrink-0 text-xs text-muted-foreground">Where</div>}

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenDropdown(openDropdown === `field-${condition.id}` ? null : `field-${condition.id}`)}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-sm hover:bg-muted"
                  >
                    <span>{field?.label ?? condition.field}</span>
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {openDropdown === `field-${condition.id}` && (
                    <div className="absolute left-0 top-full z-50 mt-1 w-40 rounded-md border border-border bg-popover p-1 shadow-lg">
                      {availableFields.map((f) => (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => {
                            updateCondition(condition.id, { field: f.key, value: "" });
                            setOpenDropdown(null);
                          }}
                          className={cn(
                            "w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                            condition.field === f.key && "bg-muted"
                          )}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenDropdown(openDropdown === `op-${condition.id}` ? null : `op-${condition.id}`)}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-sm hover:bg-muted"
                  >
                    <span>{operator?.label ?? condition.operator}</span>
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {openDropdown === `op-${condition.id}` && (
                    <div className="absolute left-0 top-full z-50 mt-1 w-40 rounded-md border border-border bg-popover p-1 shadow-lg">
                      {Object.entries(OPERATORS).map(([key, op]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            updateCondition(condition.id, { operator: key as FilterOperator });
                            setOpenDropdown(null);
                          }}
                          className={cn(
                            "w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                            condition.operator === key && "bg-muted"
                          )}
                        >
                          {op.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {operator?.needsValue && (
                  <>
                    {field?.type === "select" && field.options ? (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setOpenDropdown(openDropdown === `value-${condition.id}` ? null : `value-${condition.id}`)}
                          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-sm hover:bg-muted"
                        >
                          <span>
                            {field.options.find((o) => o.value === condition.value)?.label ?? "Select..."}
                          </span>
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        {openDropdown === `value-${condition.id}` && (
                          <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-40 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
                            {field.options.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => {
                                  updateCondition(condition.id, { value: opt.value });
                                  setOpenDropdown(null);
                                }}
                                className={cn(
                                  "w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                                  condition.value === opt.value && "bg-muted"
                                )}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={typeof condition.value === "string" ? condition.value : ""}
                        onChange={(e) => updateCondition(condition.id, { value: e.target.value })}
                        placeholder="Value..."
                        className="w-32 rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
                      />
                    )}
                  </>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => removeCondition(condition.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Button variant="ghost" size="sm" onClick={addCondition} className="text-muted-foreground">
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add filter
      </Button>
    </div>
  );
}

export function createEmptyFilterGroup(): FilterGroup {
  return {
    id: generateId(),
    type: "and",
    conditions: [],
  };
}

export type { FilterCondition, FilterGroup };
