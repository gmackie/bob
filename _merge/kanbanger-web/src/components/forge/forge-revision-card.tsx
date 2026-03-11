import { Badge, Card, CardContent, CardHeader, CardTitle } from "@linear-clone/ui";

interface ForgeRevisionCardProps {
  revId: string;
  description?: string | null;
  status?: string | null;
  indexedAt?: Date | string | null;
}

export function ForgeRevisionCard({
  revId,
  description,
  status,
  indexedAt,
}: ForgeRevisionCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-mono">{revId}</CardTitle>
          {status ? <Badge variant="secondary">{status}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {description?.trim() || "No description"}
        </p>
        {indexedAt ? (
          <p className="text-xs text-muted-foreground">
            Indexed {new Date(indexedAt).toLocaleString()}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
