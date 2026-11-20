// GMA-774: lock screen and Dynamic Island for one followed SDLC item: the issue, its
// repository, where it is (Queued → Agent → CI → Review → Deploy → Shipped) and whether it
// needs you. Mirrors LIVE_ACTIVITY_STAGES in @bob/sdlc-view.
import ActivityKit
import SwiftUI
import WidgetKit

private let stages = ["Queued", "Agent", "CI", "Review", "Deploy", "Shipped"]
private let amber = Color(red: 0xD4 / 255, green: 0x85 / 255, blue: 0x0A / 255)
private let green = Color(red: 0.20, green: 0.70, blue: 0.40)
private let red = Color(red: 0.86, green: 0.27, blue: 0.24)

private extension BobItemAttributes.ContentState {
  var title: String { issue ?? repository ?? "Bob item" }
  var tint: Color { failed ? red : needsYou ? amber : (stage >= stages.count - 1 ? green : .white) }
  var stageName: String { stages[max(0, min(stage, stages.count - 1))] }
}

struct BobItemLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: BobItemAttributes.self) { context in
      LockScreenView(state: context.state)
        .activityBackgroundTint(Color.black.opacity(0.85))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      let state = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text(state.title).font(.headline).foregroundStyle(.white).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(state.label).font(.caption.weight(.semibold)).foregroundStyle(state.tint).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          StageTrack(state: state).padding(.top, 4)
        }
      } compactLeading: {
        Text(state.issue ?? "Bob").font(.caption2.weight(.bold)).foregroundStyle(.white).lineLimit(1)
      } compactTrailing: {
        if state.needsYou {
          Image(systemName: "exclamationmark.circle.fill").foregroundStyle(amber)
        } else if state.failed {
          Image(systemName: "xmark.octagon.fill").foregroundStyle(red)
        } else {
          Text(state.stageName).font(.caption2.weight(.semibold)).foregroundStyle(state.tint)
        }
      } minimal: {
        Image(systemName: state.needsYou ? "exclamationmark.circle.fill" : state.failed ? "xmark.octagon.fill" : "circle.dotted")
          .foregroundStyle(state.tint)
      }
      .keylineTint(state.tint)
    }
  }
}

private struct LockScreenView: View {
  let state: BobItemAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text(state.title).font(.headline).foregroundStyle(.white).lineLimit(1)
          if let repository = state.repository, state.issue != nil {
            Text(repository).font(.caption).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
          }
        }
        Spacer()
        Text(state.needsYou ? "Needs you" : state.label)
          .font(.caption.weight(.semibold))
          .padding(.horizontal, 8).padding(.vertical, 3)
          .background(Capsule().fill(state.tint.opacity(0.18)))
          .foregroundStyle(state.tint)
      }
      StageTrack(state: state)
    }
    .padding(16)
  }
}

private struct StageTrack: View {
  let state: BobItemAttributes.ContentState

  var body: some View {
    HStack(spacing: 4) {
      ForEach(stages.indices, id: \.self) { index in
        VStack(spacing: 4) {
          Capsule()
            .fill(color(index))
            .frame(height: 5)
          Text(stages[index])
            .font(.system(size: 9, weight: index == state.stage ? .bold : .regular))
            .foregroundStyle(index <= state.stage ? .white : .white.opacity(0.4))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
      }
    }
  }

  private func color(_ index: Int) -> Color {
    if state.failed { return index == 0 ? red : red.opacity(0.25) }
    if index < state.stage { return green }
    if index == state.stage { return state.tint }
    return .white.opacity(0.18)
  }
}
