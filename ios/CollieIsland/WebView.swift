import SwiftUI
import WebKit

struct Navigation: Equatable {
  var url: URL
  // Bumped on every request so tapping the island for the same pane twice still navigates,
  // even after the user has wandered off inside Collie.
  var seq: Int
}

struct WebView: UIViewRepresentable {
  let navigation: Navigation
  var onOpenAddress: () -> Void = {}
  var onLoadFailed: (String) -> Void = { _ in }
  var onLoaded: () -> Void = {}

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    WebStateBackup.install(on: config.userContentController, handler: context.coordinator.backup)
    config.userContentController.add(context.coordinator.address, name: IslandAddress.handlerName)
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    let view = WKWebView(frame: .zero, configuration: config)
    view.uiDelegate = context.coordinator
    view.navigationDelegate = context.coordinator
    view.isInspectable = true
    view.scrollView.contentInsetAdjustmentBehavior = .never
    view.isOpaque = false
    view.backgroundColor = .systemBackground
    context.coordinator.view = view
    // Test hook for the Keychain restore: collieisland://debug-wipe empties the page's storage
    // the way a pre-unlock launch did, then reloads so the restore script has to put it back.
    NotificationCenter.default.addObserver(forName: WebStateBackup.wipeNotification, object: nil, queue: .main) {
      [weak view] _ in
      WKWebsiteDataStore.default().removeData(
        ofTypes: [WKWebsiteDataTypeLocalStorage], modifiedSince: .distantPast
      ) { view?.reload() }
    }
    return view
  }

  func updateUIView(_ view: WKWebView, context: Context) {
    context.coordinator.address.onOpen = onOpenAddress
    context.coordinator.onLoadFailed = onLoadFailed
    context.coordinator.onLoaded = onLoaded
    guard context.coordinator.loaded != navigation else { return }
    context.coordinator.loaded = navigation
    view.load(URLRequest(url: navigation.url))
  }

  @MainActor
  final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate, UIDocumentPickerDelegate {
    private var downloads: [ObjectIdentifier: URL] = [:]
    private var exportFile: URL?
    var loaded: Navigation?
    let backup = WebStateBackupHandler()
    let address = IslandAddressHandler()
    var onLoadFailed: (String) -> Void = { _ in }
    var onLoaded: () -> Void = {}
    weak var view: WKWebView?

    // 網頁已帶配對憑證取回 bytes。只接自己的主頁 Blob，不讓預覽 iframe 或外站借原生 app 下載。
    private func isLocalDownload(_ action: WKNavigationAction) -> Bool {
      let origin = action.sourceFrame.securityOrigin
      return action.shouldPerformDownload && action.sourceFrame.isMainFrame
        && action.request.url?.scheme == "blob"
        && Config.isCollie(scheme: origin.protocol, host: origin.host, port: origin.port)
    }

    // A link Collie opens in a new tab: a target=_blank anchor, or the window.open that follows the
    // localhost probe (ADR 9007). Without this method WebKit drops the request and the tap does
    // nothing. Collie is handed a throwaway view, so its window.open sees a tab and shows no
    // "Open in browser" fallback, and that view's first load goes to the phone's default browser
    // instead (see `decidePolicyFor`). The page is someone else's and never runs beside the
    // pairing token.
    private var popups: [WKWebView] = []

    func webView(
      _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
      for action: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
      let popup = WKWebView(frame: .zero, configuration: configuration)
      popup.navigationDelegate = self
      popups.append(popup)
      return popup
    }

    private func handOff(_ popup: WKWebView, _ action: WKNavigationAction) {
      popups.removeAll { $0 === popup }
      guard let url = action.request.url, let scheme = url.scheme?.lowercased(),
        scheme == "http" || scheme == "https"
      else { return }
      UIApplication.shared.open(url)
    }

    func webView(
      _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
      decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
      if webView !== view {
        decisionHandler(.cancel)
        handOff(webView, action)
        return
      }
      guard action.shouldPerformDownload else { decisionHandler(.allow); return }
      guard isLocalDownload(action) else { decisionHandler(.cancel); return }
      guard downloads.isEmpty, exportFile == nil else {
        decisionHandler(.cancel)
        downloadFailed(String(localized: "Finish saving the current file first."))
        return
      }
      decisionHandler(.download)
    }

    func webView(_ webView: WKWebView, navigationAction action: WKNavigationAction, didBecome download: WKDownload) {
      guard isLocalDownload(action) else { download.cancel { _ in }; return }
      download.delegate = self
    }

    func download(
      _ download: WKDownload, decideDestinationUsing response: URLResponse,
      suggestedFilename: String, completionHandler: @escaping (URL?) -> Void
    ) {
      let name = (suggestedFilename as NSString).lastPathComponent
      guard !name.isEmpty, name != ".", name != "..", name != "/" else {
        completionHandler(nil)
        downloadFailed(String(localized: "The file name isn't valid."))
        return
      }
      let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("collie-download-\(UUID().uuidString)", isDirectory: true)
      do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        let destination = directory.appendingPathComponent(name)
        downloads[ObjectIdentifier(download)] = destination
        completionHandler(destination)
      } catch {
        completionHandler(nil)
        downloadFailed(error.localizedDescription)
      }
    }

    func downloadDidFinish(_ download: WKDownload) {
      guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
      guard let presenter = presenter else {
        removeDownload(file)
        DiagLog.write("download failed: no export presenter")
        return
      }
      exportFile = file
      let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
      picker.delegate = self
      presenter.present(picker, animated: true)
      DiagLog.write("download ready for export")
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
      if let file = downloads.removeValue(forKey: ObjectIdentifier(download)) { removeDownload(file) }
      downloadFailed(error.localizedDescription)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
      finishExport()
      DiagLog.write("download exported")
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
      finishExport()
    }

    private func finishExport() {
      if let file = exportFile { removeDownload(file) }
      exportFile = nil
    }

    private func removeDownload(_ file: URL) {
      try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
    }

    private var presenter: UIViewController? {
      var controller = view?.window?.rootViewController
      while let presented = controller?.presentedViewController { controller = presented }
      return controller
    }

    private func downloadFailed(_ reason: String) {
      DiagLog.write("download failed: \(reason)")
      let alert = UIAlertController(title: String(localized: "Download failed"), message: reason, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: String(localized: "OK"), style: .default))
      presenter?.present(alert, animated: true)
    }

    // A handed-off popup reports its cancelled load here too; only Collie's own view may raise the
    // load-failed screen.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
      if webView === view { failed(error) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
      if webView === view { failed(error) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      if webView === view { onLoaded() }
    }

    // A load cut short by the next one (a pane link tapped mid-load) is not Collie being down.
    private func failed(_ error: Error) {
      if (error as NSError).code == NSURLErrorCancelled { return }
      MainActor.assumeIsolated { DiagLog.write("page load failed: \(error.localizedDescription)") }
      onLoadFailed(error.localizedDescription)
    }

    // Collie's composer records voice through getUserMedia; without this WebKit asks on every
    // single recording. The only page this view ever loads is the operator's own Collie.
    func webView(
      _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
      initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
      decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
      decisionHandler(Config.isCollie(scheme: origin.protocol, host: origin.host, port: origin.port) ? .grant : .prompt)
    }
  }
}
