import Foundation

struct Snapshot: Decodable {
  let agents: [Agent]
}

struct Agent: Decodable {
  let paneId: String
  let kind: String?
  let status: String
  let workspaceLabel: String?
  let terminalTitle: String?
  let lastActiveAt: Double?
  let lastSeenAt: Double?
  let description: Description?

  struct Description: Decodable {
    let now: String?
    let source: String?
    let parts: Parts?

    /// What a blocked or prompt `now` was built from (bridge/description/resolve.ts). `now` itself
    /// is Chinese, kept for the push body and for an app that predates `parts`.
    struct Parts: Decodable {
      let tool: String?
      let target: String?
      let prompt: String?
    }

    /// `now` in this app's language. A recap, or a bridge that sends no parts, reads as sent;
    /// web/src/lib/description-now.ts is the same rule for the phone's page.
    var line: String? {
      guard let parts else { return now }
      if source == "prompt", let prompt = parts.prompt { return String(localized: "You: \(prompt)") }
      guard source == "blocked" else { return now }
      guard let tool = parts.tool else { return String(localized: "Waiting for your approval") }
      let named = parts.target.map { "\(tool) · \($0)" } ?? tool
      return String(localized: "Waiting for your approval: \(named)")
    }
  }
}

// Raw values order urgency; the names match Collie's TriageKey so the two can be compared by eye.
enum Bucket: Int, Codable, Hashable, Comparable {
  case needs = 0, ready, working, recent

  static func < (a: Bucket, b: Bucket) -> Bool { a.rawValue < b.rawValue }
}

// Mirrors bucketOf / isUnseen in collie web/src/lib/triage.ts. If the island and the app's
// "Needs you" list ever disagree, this is the copy that drifted.
func bucket(of a: Agent) -> Bucket {
  if a.status == "blocked" { return .needs }
  let settled = a.status == "done" || a.status == "idle"
  if a.kind != "shell" && settled && (a.lastActiveAt ?? 0) > (a.lastSeenAt ?? 0) { return .ready }
  if a.status == "working" { return .working }
  return .recent
}

/// `showDetail` puts the top pane's description (possibly its newest prompt, verbatim) on the island
/// and the lock screen; off, only the counts and the pane's name are shown.
func summarize(_ agents: [Agent], showDetail: Bool) -> IslandAttributes.ContentState {
  let tagged = agents.map { (agent: $0, bucket: bucket(of: $0)) }
  let count = { (b: Bucket) in tagged.filter { $0.bucket == b }.count }
  let top = tagged
    .filter { $0.bucket != .recent }
    .min { l, r in
      l.bucket != r.bucket ? l.bucket < r.bucket : (l.agent.lastActiveAt ?? 0) > (r.agent.lastActiveAt ?? 0)
    }
  let title = top.map { $0.agent.terminalTitle ?? $0.agent.workspaceLabel ?? $0.agent.paneId }
  return IslandAttributes.ContentState(
    needs: count(.needs),
    ready: count(.ready),
    working: count(.working),
    headline: title ?? "Gaddi",
    detail: showDetail ? (top?.agent.description?.line ?? "") : "",
    paneId: top?.agent.paneId,
    bucket: top?.bucket ?? .recent,
    offline: false)
}
