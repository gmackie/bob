export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
}
export interface OAuthGrant {
  id: string;
  clientId: string;
  userId: string;
  workspaceId: string;
  scopes: string[];
  resource: string;
  expiresAt: Date;
  revokedAt: Date | null;
}
export interface Credential {
  hash: string;
  kind: string;
  grantId: string | null;
  data: Record<string, unknown>;
  expiresAt: Date;
  usedAt: Date | null;
}
export interface OAuthTransaction {
  client(id: string): Promise<OAuthClient | undefined>;
  addClient(client: OAuthClient): Promise<void>;
  grant(id: string): Promise<OAuthGrant | undefined>;
  addGrant(grant: OAuthGrant): Promise<void>;
  revoke(id: string): Promise<void>;
  credential(hash: string): Promise<Credential | undefined>;
  addCredential(credential: Credential): Promise<void>;
  consume(hash: string): Promise<Credential | undefined>;
}
export interface OAuthStore extends OAuthTransaction {
  transaction<A>(work: (tx: OAuthTransaction) => Promise<A>): Promise<A>;
}
export interface WorkspaceChoice {
  id: string;
  name: string;
  canWrite: boolean;
}
export interface OAuthIdentity {
  session(request: Request): Promise<{ userId: string } | null>;
  workspaces(userId: string): Promise<WorkspaceChoice[]>;
  access(userId: string, workspaceId: string, write: boolean): Promise<boolean>;
}
