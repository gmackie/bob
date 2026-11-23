// GMA-774: starts, updates and ends the Live Activity for an SDLC item, and reports the
// ActivityKit push token the edge needs to move it (BOB-96). Tokens are hex and kept per
// item so JS can read them after a reload; nothing here is logged.
import ExpoModulesCore
#if canImport(ActivityKit)
import ActivityKit
#endif

public class BobLiveActivityModule: Module {
  /** itemId → latest push token (hex). */
  private var tokens: [String: String] = [:]
  /** Activity ids already being observed. */
  private var observed: Set<String> = []
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("BobLiveActivity")

    Events("onPushToken", "onEnded")

    Function("appId") { () -> String in
      Bundle.main.bundleIdentifier ?? ""
    }

    Function("isSupported") { () -> Bool in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      #endif
      return false
    }

    /** Items with a running activity. Starts observing any not yet observed (after a relaunch). */
    Function("activeItemIds") { () -> [String] in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        let running = Activity<BobItemAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
        running.forEach { self.observe($0) }
        return running.map { $0.attributes.itemId }
      }
      #endif
      return []
    }

    /** Latest push token per item, for listeners that attached after the event fired. */
    Function("tokens") { () -> [String: String] in
      self.lock.lock(); defer { self.lock.unlock() }
      return self.tokens
    }

    /** Starts (or, if one is running for the item, updates) the activity. Returns its id. */
    AsyncFunction("start") { (itemId: String, state: [String: Any]) async throws -> String in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        let content = try Self.content(state)
        if let existing = Activity<BobItemAttributes>.activities.first(where: { $0.attributes.itemId == itemId && $0.activityState == .active }) {
          await existing.update(ActivityContent(state: content, staleDate: nil))
          self.observe(existing)
          return existing.id
        }
        let activity = try Activity.request(
          attributes: BobItemAttributes(itemId: itemId),
          content: ActivityContent(state: content, staleDate: nil),
          pushType: .token
        )
        self.observe(activity)
        return activity.id
      }
      #endif
      throw LiveActivityUnsupported()
    }

    /** Updates the item's activity from data the app already has (pushes do this in the background). */
    AsyncFunction("update") { (itemId: String, state: [String: Any]) async throws in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        let content = try Self.content(state)
        for activity in Activity<BobItemAttributes>.activities where activity.attributes.itemId == itemId {
          await activity.update(ActivityContent(state: content, staleDate: nil))
        }
      }
      #endif
    }

    /** Ends the item's activity now. */
    AsyncFunction("end") { (itemId: String) async in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        for activity in Activity<BobItemAttributes>.activities where activity.attributes.itemId == itemId {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
      #endif
      self.lock.lock(); self.tokens.removeValue(forKey: itemId); self.lock.unlock()
    }
  }

  #if canImport(ActivityKit)
  @available(iOS 16.2, *)
  private static func content(_ state: [String: Any]) throws -> BobItemAttributes.ContentState {
    let data = try JSONSerialization.data(withJSONObject: state)
    return try JSONDecoder().decode(BobItemAttributes.ContentState.self, from: data)
  }

  @available(iOS 16.2, *)
  private func observe(_ activity: Activity<BobItemAttributes>) {
    lock.lock()
    let isNew = observed.insert(activity.id).inserted
    lock.unlock()
    guard isNew else { return }
    let itemId = activity.attributes.itemId
    Task { [weak self] in
      for await data in activity.pushTokenUpdates {
        let token = data.map { String(format: "%02x", $0) }.joined()
        guard let self else { return }
        self.lock.lock(); self.tokens[itemId] = token; self.lock.unlock()
        self.sendEvent("onPushToken", ["itemId": itemId, "token": token])
      }
    }
    Task { [weak self] in
      for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
        guard let self else { return }
        self.lock.lock()
        self.tokens.removeValue(forKey: itemId)
        self.observed.remove(activity.id)
        self.lock.unlock()
        self.sendEvent("onEnded", ["itemId": itemId])
        return
      }
    }
  }
  #endif
}

struct LiveActivityUnsupported: Error, CustomStringConvertible {
  var description: String { "Live Activities need iOS 16.2 or later, with Live Activities allowed for Bob." }
}
