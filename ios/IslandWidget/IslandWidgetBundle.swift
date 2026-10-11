import ActivityKit
import SwiftUI
import WidgetKit

@main
struct IslandWidgetBundle: WidgetBundle {
  var body: some Widget {
    IslandLiveActivity()
    RestartIslandControl()
  }
}

struct RestartIslandControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    // A kind only has to be unique inside this app, so any build can keep it. Renaming it would
    // drop the button from every Control Center it has already been added to.
    StaticControlConfiguration(kind: "com.gggodlin.collieisland.restart") {
      ControlWidgetButton(action: RestartIslandIntent()) {
        Label("Restart island", systemImage: "pawprint.fill")
      }
    }
    .displayName("Restart Gaddi island")
  }
}

struct IslandLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: IslandAttributes.self) { context in
      LockScreenView(state: context.state, stale: context.isStale)
        .padding()
        .widgetURL(tapURL(context.state))
    } dynamicIsland: { context in
      let s = context.state
      let stale = context.isStale
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          StatusMark(state: s, stale: stale, size: 30).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(countsLine(s, stale: stale)).font(.caption).foregroundStyle(.secondary)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 2) {
            Text(s.headline).font(.headline).lineLimit(1)
            if !s.detail.isEmpty {
              Text(s.detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      } compactLeading: {
        StatusMark(state: s, stale: stale, size: 18)
      } compactTrailing: {
        Text(compactLabel(s, stale: stale)).font(.caption2).monospacedDigit()
      } minimal: {
        StatusMark(state: s, stale: stale, size: 18)
      }
      .widgetURL(tapURL(s))
    }
  }
}

// A pairing problem sends the tap to the pair form: a pane cannot be read until it is fixed.
private func tapURL(_ s: IslandAttributes.ContentState) -> URL {
  s.pairing == nil ? Deeplink.url(paneId: s.paneId) : Deeplink.pairURL
}

struct LockScreenView: View {
  let state: IslandAttributes.ContentState
  let stale: Bool

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      StatusMark(state: state, stale: stale, size: 30)
      VStack(alignment: .leading, spacing: 2) {
        Text(state.headline).font(.headline).lineLimit(1)
        if !state.detail.isEmpty {
          Text(state.detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
        }
        Text(countsLine(state, stale: stale)).font(.caption).foregroundStyle(.secondary)
      }
      Spacer(minLength: 0)
    }
  }
}

// Collie's own mark, tinted by the most urgent bucket, so the island reads as Collie at a glance
// and still carries the colour the old status dot did.
struct StatusMark: View {
  let state: IslandAttributes.ContentState
  let stale: Bool
  let size: CGFloat

  var body: some View {
    Image("CollieMark")
      .resizable()
      .renderingMode(.template)
      .scaledToFit()
      .foregroundStyle(markColor(state, stale: stale))
      .frame(width: size, height: size)
  }
}

private func markColor(_ s: IslandAttributes.ContentState, stale: Bool) -> Color {
  if stale { return .gray }
  if s.pairing != nil { return .orange }
  if s.offline { return .gray }
  switch s.bucket {
  case .needs: return .red
  case .ready: return .green
  case .working: return .blue
  case .recent: return .gray
  }
}

private func compactLabel(_ s: IslandAttributes.ContentState, stale: Bool) -> String {
  if stale { return String(localized: "Stopped") }
  switch s.pairing {
  case .unpaired: return String(localized: "Unpaired")
  case .revoked: return String(localized: "Revoked")
  case .expired: return String(localized: "Expired")
  case nil: break
  }
  if s.offline { return String(localized: "Offline") }
  if s.needs > 0 { return String(localized: "\(s.needs) waiting") }
  if s.ready > 0 { return String(localized: "\(s.ready) done") }
  if s.working > 0 { return String(localized: "\(s.working) working") }
  return "—"
}

private func countsLine(_ s: IslandAttributes.ContentState, stale: Bool) -> String {
  if stale { return String(localized: "Gaddi app stopped updating") }
  // Nothing: the expanded island's rounded trailing corner clipped even a four-character label, and
  // the detail line under the headline already says to tap.
  if s.pairing != nil { return "" }
  if s.offline { return String(localized: "Can't reach Gaddi") }
  return String(localized: "Waiting \(s.needs) · Done \(s.ready) · Working \(s.working)")
}
