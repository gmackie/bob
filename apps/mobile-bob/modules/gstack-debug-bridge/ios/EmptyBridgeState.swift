#if DEBUG

import Foundation

struct EmptyBridgeState {}

/// No product fields. Screenshot, elements, and tap do not need them.
/// A later pass can register JavaScript state here.
@MainActor
enum EmptyBridgeStateAccessor {
  static func register(_ state: EmptyBridgeState) {
    _ = state
    StateServer.shared.register(
      buildId: "development",
      accessorHash: "empty",
      atomicRestore: { _, _ in .ok }
    )
  }
}

#endif
