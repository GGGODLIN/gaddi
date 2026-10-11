import Foundation

// Collie 1.18.0 made pairing always on, reads included (its ADR 0086), so the island's poll needs
// the token the page inside this app was paired with. The page's own refusal handling wipes that
// token on a "not paired" or "expired" answer, and the Keychain backup follows it, so the reason is
// remembered here: without it a revoked or expired pairing would read as never paired once the
// page had run.
enum Pairing {
  private static let rememberedKey = "pairingRefusal"

  /// The pairing token the page inside this app holds for this Collie, from its Keychain backup.
  static func token() -> String? {
    guard let token = WebStateBackup.load()["collie:device-token"], !token.isEmpty else { return nil }
    return token
  }

  /// What a 403 from Collie means, or nil when it is not Collie's pairing refusal (a proxy's own
  /// 403 stays a plain failed poll). Collie answers with one of exactly two bodies.
  static func issue(refusal data: Data, hadToken: Bool) -> PairingIssue? {
    let body = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let issue: PairingIssue
    switch body {
    case "device expired": issue = .expired
    case "device not paired": issue = hadToken ? .revoked : (remembered ?? .unpaired)
    default: return nil
    }
    UserDefaults.standard.set(issue.rawValue, forKey: rememberedKey)
    return issue
  }

  /// A read went through, so whatever was wrong with the pairing is fixed.
  static func forget() {
    UserDefaults.standard.removeObject(forKey: rememberedKey)
  }

  private static var remembered: PairingIssue? {
    UserDefaults.standard.string(forKey: rememberedKey).flatMap(PairingIssue.init(rawValue:))
  }

  /// What the island shows while reads are refused. The counts are zero because they are unknown,
  /// and the island draws the pairing words instead of them. Each detail fits one line: a second line
  /// in the expanded island starts under its rounded corner, which clipped the first letters.
  static func state(_ issue: PairingIssue) -> IslandAttributes.ContentState {
    let (headline, detail): (String, String) =
      switch issue {
      case .unpaired: (String(localized: "Gaddi isn't paired"), String(localized: "Tap to pair (collie pair)"))
      case .revoked: (String(localized: "Gaddi's pairing was revoked"), String(localized: "Tap to pair again"))
      case .expired: (String(localized: "Gaddi's pairing expired"), String(localized: "Tap to pair again (collie pair)"))
      }
    return IslandAttributes.ContentState(
      needs: 0, ready: 0, working: 0, headline: headline, detail: detail, paneId: nil, bucket: .recent,
      offline: false, pairing: issue)
  }
}
