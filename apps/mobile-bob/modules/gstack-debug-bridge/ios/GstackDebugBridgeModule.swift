import ExpoModulesCore
import UIKit

public class GstackDebugBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GstackDebugBridge")
  }
}

public class GstackDebugBridgeAppDelegate: ExpoAppDelegateSubscriber {
  @MainActor
  public func subscriberDidRegister() {
    GstackDebugBridgeBootstrap.start()
  }

  @MainActor
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    GstackDebugBridgeBootstrap.start()
    return true
  }
}
