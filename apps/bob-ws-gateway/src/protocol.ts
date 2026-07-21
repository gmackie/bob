// Re-export all protocol types from the shared package.
// This is the single source of truth — packages/ws owns the types,
// the gateway just re-exports them.
export {
  // Shared types
  type SessionStatus,
  type DeviceType,
  type EventDirection,
  type SessionEventType,
  type HostSnapshotWire,
  type ProviderHealthWire,
  type ProviderCapabilityWire,

  // Client → Server
  type ClientMessage,
  type ClientHello,
  type ClientSubscribe,
  type ClientUnsubscribe,
  type ClientInput,
  type ClientAck,
  type ClientApprove,
  type ClientPing,
  type ClientStopSession,
  type ClientSessionClaimed,
  type ClientSessionEvent,
  type ClientSessionStatus,
  type ClientSubscribeWorkspace,
  type ClientUnsubscribeWorkspace,

  // Server → Client
  type ServerMessage,
  type ServerHelloOk,
  type ServerSubscribed,
  type ServerUnsubscribed,
  type ServerInputAck,
  type ServerEvent,
  type ServerPong,
  type ServerError,
  type ServerSessionAvailable,
  type ServerSessionStop,
  type ServerSessionStatusChanged,
  type ServerReplayTruncated,
  type ServerEventAck,
  type ServerHostSnapshot,
  type ServerWorkspaceSnapshot,
  type ServerWorkspaceInvalidationType,
  type WorkspaceSessionInfo,

  // Codec
  parseClientMessage,
  encodeServerMessage,
  createError,
} from "@bob/ws";
