// GMA-774: the widget extension that draws Bob's SDLC Live Activity.
import SwiftUI
import WidgetKit

@main
struct BobLiveActivityBundle: WidgetBundle {
  var body: some Widget {
    BobItemLiveActivity()
  }
}
