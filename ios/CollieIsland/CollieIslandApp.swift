import SwiftUI

@main
struct CollieIslandApp: App {
  private let monitor = Monitor.shared
  @State private var navigation = Navigation(url: Config.collieURL, seq: 0)
  @State private var address = Config.configuredURL
  @State private var editingAddress = false
  @State private var loadFailure: String?
  @Environment(\.scenePhase) private var phase
  // "Always" location lets iOS relaunch us in the background right after a reboot, before the
  // first unlock. A WKWebView created then cannot read its encrypted website data and came up
  // empty, which wiped Collie's pairing and settings (2026-09-27). So the web view is only built
  // once protected data is available and the app has been in the foreground.
  @State private var webReady = false
  // Any app can open collieisland://debug-wipe, and iOS's own prompt only asks whether to open Collie,
  // so the wipe waits for a confirmation that says what it destroys.
  @State private var confirmWipe = false

  var body: some Scene {
    WindowGroup {
      Group {
        if let address {
          if webReady {
            ZStack {
              WebView(
                navigation: navigation,
                onOpenAddress: { editingAddress = true },
                onLoadFailed: { loadFailure = $0 },
                onLoaded: { loadFailure = nil })
                // A new address gets a new web view: its user scripts and backup are bound to
                // one origin when the view is built.
                .id(address)
              if let loadFailure {
                LoadFailedView(
                  address: address, reason: loadFailure,
                  onRetry: {
                    self.loadFailure = nil
                    navigation = Navigation(url: navigation.url, seq: navigation.seq + 1)
                  },
                  onChange: { editingAddress = true })
              }
            }
          } else {
            Color(.systemBackground)
          }
        } else {
          AddressSetupView(current: nil, onSaved: adopt, onCancel: nil)
        }
      }
        .sheet(isPresented: $editingAddress) {
          AddressSetupView(
            current: address,
            onSaved: { adopt($0); editingAddress = false },
            onCancel: { editingAddress = false })
        }
        // Full-bleed put Collie's header under the status bar and the island: inside a
        // WKWebView its env(safe-area-inset-top) came through as 0. The keyboard stays ignored
        // because WKWebView already resizes for it; SwiftUI shrinking the view too doubles it.
        .ignoresSafeArea(.keyboard)
        .onAppear { monitor.start() }
        .onOpenURL { open($0) }
        .onChange(of: phase) { _, now in
          guard now == .active else { return }
          monitor.foregrounded()
          if UIApplication.shared.isProtectedDataAvailable { webReady = true }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.protectedDataDidBecomeAvailableNotification)) { _ in
          if phase == .active { webReady = true }
        }
        .alert("Clear the app's web data?", isPresented: $confirmWipe) {
          Button("Clear", role: .destructive) {
            DiagLog.write("debug-wipe confirmed")
            NotificationCenter.default.post(name: WebStateBackup.wipeNotification, object: nil)
          }
          Button("Cancel", role: .cancel) { DiagLog.write("debug-wipe cancelled") }
        } message: {
          Text("This link is for testing the backup. Unsent drafts are deleted; settings and pairing come back from the Keychain.")
        }
    }
  }

  private func adopt(_ url: URL) {
    IslandAddress.save(url)
    address = url
    loadFailure = nil
    navigation = Navigation(url: url, seq: navigation.seq + 1)
  }

  private func open(_ link: URL) {
    if link.scheme == Deeplink.scheme && link.host == "debug-wipe" {
      DiagLog.write("debug-wipe requested; asking first")
      confirmWipe = true
      return
    }
    var target = Config.collieURL
    if Deeplink.isPair(link) {
      // The pair form lives in Settings → System, where `collie pair`'s QR also lands.
      target = URL(string: Config.collieURL.absoluteString + "/settings/system") ?? target
    } else if let pane = Deeplink.paneId(from: link) {
      // Same encoding as Collie's paneHref (web/src/lib/nav.ts): encodeURIComponent on the id.
      let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_.!~*'()"))
      let encoded = pane.addingPercentEncoding(withAllowedCharacters: allowed) ?? pane
      target = URL(string: Config.collieURL.absoluteString + "/pane/" + encoded) ?? target
    }
    navigation = Navigation(url: target, seq: navigation.seq + 1)
  }
}
