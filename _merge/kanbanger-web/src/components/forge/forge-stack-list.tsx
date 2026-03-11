import { Badge, Card, CardContent, CardHeader, CardTitle } from "@linear-clone/ui";

interface ForgeStack {
  id: string;
  baseRevId: string;
  tipRevId: string;
  revIds: string[];
}

interface ForgeStackListProps {
  stacks: ForgeStack[];
}

export function ForgeStackList({ stacks }: ForgeStackListProps) {
  if (stacks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stacks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No stacks indexed yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stacks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {stacks.map((stack) => (
          <div key={stack.id} className="rounded-md border p-3">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="outline">base: {stack.baseRevId}</Badge>
              <Badge variant="secondary">tip: {stack.tipRevId}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {stack.revIds.length} revision{stack.revIds.length === 1 ? "" : "s"}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
