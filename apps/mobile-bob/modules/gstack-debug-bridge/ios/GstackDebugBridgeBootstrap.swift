import Foundation
import UIKit

/// Starts the vendored gstack StateServer. The class exists in Release so the
/// Expo app-delegate subscriber can link, and the body compiles away.
enum GstackDebugBridgeBootstrap {
  #if DEBUG
  private static var started = false
  #endif

  static func start() {
    #if DEBUG
    DispatchQueue.main.async {
      Task { @MainActor in
        startOnMain()
      }
    }
    #endif
  }

  #if DEBUG
  @MainActor
  private static func startOnMain() {
    guard !started else { return }
    started = true
    DebugBridgeUIWiring.installAll()
    DebugBridgeManager.shared.start(
      appState: EmptyBridgeState(),
      register: EmptyBridgeStateAccessor.register
    )
    DebugOverlayWindow.shared.install(recording: false)
  }
  #endif
}
