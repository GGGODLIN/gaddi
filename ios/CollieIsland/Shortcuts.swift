import AppIntents

struct CollieShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: RestartIslandIntent(),
      phrases: ["Restart \(.applicationName) island"],
      shortTitle: "Restart island",
      systemImageName: "pawprint.fill")
  }
}
