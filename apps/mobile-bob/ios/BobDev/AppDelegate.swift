internal import Expo
import React
import ReactAppDependencyProvider
#if DEBUG
import DebugBridgeCore
import DebugBridgeUI
#endif

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // BOB-122: iOS 27 SDK apps must adopt the UIScene lifecycle, or UIKit traps
    // at launch (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
    // The window and React Native now start in SceneDelegate, once the scene
    // exists; the factory is created here so Expo's subscribers (expo-updates,
    // dev client) see it during didFinishLaunching as before.

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

/// Owns Bob's window under the UIScene lifecycle (BOB-122). Info.plist's
/// UIApplicationSceneManifest names this class.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    // Some libraries still read the app delegate's window.
    appDelegate.window = window

    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: SceneDelegate.launchOptions(from: connectionOptions))
#if DEBUG
    // Loopback gstack harness for Preflight device QA. React Native owns the
    // UI, so there is no snapshotable Swift model to register.
    DebugBridgeUIWiring.installAll()
    DebugBridgeManager.shared.start(appState: (), register: { (_: ()) in })
    DebugOverlayWindow.shared.install(
      recording: ProcessInfo.processInfo.arguments.contains("--gstack-recording")
    )
#endif
  }

  // Deep links. Under scenes UIKit calls these instead of the app delegate's
  // open-URL and continue-activity methods, so hand them to those, which run
  // Expo's subscribers and RCTLinkingManager.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
      if let source = context.options.sourceApplication {
        options[.sourceApplication] = source
      }
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = appDelegate.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }

  /// The launch options RCTLinkingManager reads for the initial URL, rebuilt
  /// from the scene's connection options (a cold start from a link no longer
  /// passes them to didFinishLaunching).
  static func launchOptions(
    from connectionOptions: UIScene.ConnectionOptions
  ) -> [UIApplication.LaunchOptionsKey: Any]? {
    if let url = connectionOptions.urlContexts.first?.url {
      return [.url: url]
    }
    if let activity = connectionOptions.userActivities.first {
      return [
        .userActivityDictionary: [
          UIApplication.LaunchOptionsKey.userActivityType: activity.activityType,
          "UIApplicationLaunchOptionsUserActivityKey": activity,
        ]
      ]
    }
    return nil
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
