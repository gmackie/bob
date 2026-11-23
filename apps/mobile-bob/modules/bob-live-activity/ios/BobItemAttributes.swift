// GMA-774: the Live Activity for one SDLC item. This struct is defined twice, here and in
// ios/BobLiveActivityWidget/BobItemAttributes.swift (the widget extension), and the two must stay
// identical: ActivityKit matches an activity to its widget by type name and Codable shape.
// ContentState mirrors LiveActivityContent in @bob/sdlc-view, which the edge's APNs pushes
// send as content-state. It carries no agent text: no question, answer or tail.
#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
public struct BobItemAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var issue: String?
    public var repository: String?
    public var state: String
    public var label: String
    public var stage: Int
    public var needsYou: Bool
    public var failed: Bool
    public var ended: Bool
  }

  /** The SDLC item this activity follows. */
  public var itemId: String
}
#endif
