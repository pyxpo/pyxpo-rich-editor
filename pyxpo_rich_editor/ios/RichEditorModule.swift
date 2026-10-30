import UIKit
import WebKit

/// pyxpo-rich-editor on iOS and the Mac (Catalyst): `PxRichEditorView` shows the bundled editor page in a
/// WKWebView. The page talks back through the `px` message handler; the view forwards every message to Python
/// as a `message` event.
final class RichEditorModule: PxViewModule {
    static let moduleName = "RichEditor"
    static let viewTypes = ["PxRichEditorView"]

    required init() {}

    func makeView(_ ctx: PxModuleContext, _ type: String, _ emit: @escaping (String, Any?) -> Void) -> PxNativeView {
        PxRichEditorView(emit)
    }

    func call(_ ctx: PxModuleContext, _ method: String, _ args: [Any], _ reply: @escaping PxReply) {
        DispatchQueue.main.async {
            guard let tag = (args.first as? NSNumber)?.intValue, let v = ctx.view(tag) as? PxRichEditorView else {
                reply(nil, "The RichEditor is not mounted")
                return
            }
            switch method {
            case "post": v.send("post", args.count > 1 ? args[1] as? String ?? "{}" : "{}")
            default:
                reply(nil, "RichEditor has no method \(method)")
                return
            }
            reply(nil, nil)
        }
    }
}

/// The message handler holds the view weakly: WKUserContentController keeps its handlers alive, and a strong
/// reference back to the view would keep the web view alive with it.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: PxRichEditorView?

    init(_ target: PxRichEditorView) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if let body = message.body as? String { target?.received(body) }
    }
}

final class PxRichEditorView: NSObject, PxNativeView {
    let web: WKWebView
    var view: UIView { web }

    private let emit: (String, Any?) -> Void
    private var document: String?
    private var ready = false
    /// The last value of each prop the page reads (`value`, `config`), sent again to a page that reloads.
    private var latest: [String: String] = [:]
    /// What waits for the page to say it is ready, in the order it was set.
    private var queue: [(String, String)] = []

    init(_ emit: @escaping (String, Any?) -> Void) {
        self.emit = emit
        let config = WKWebViewConfiguration()
        config.dataDetectorTypes = []
        config.allowsInlineMediaPlayback = true
        web = WKWebView(frame: .zero, configuration: config)
        super.init()
        config.userContentController.add(WeakHandler(self), name: "px")
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        // The page scrolls its own column under a fixed toolbar; the web view itself never moves.
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { web.isInspectable = true }
    }

    func update(_ props: [String: Any], _ removed: [String]) {
        for key in ["config", "value"] {
            if let s = props[key] as? String { latest[key] = s; send(key, s) }
        }
        if let d = props["document"] as? String, d != document {
            document = d
            ready = false
            queue = latest.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
            web.loadHTMLString(d, baseURL: URL(string: "https://editor.pyxpo.invalid/"))
        }
    }

    /// Hands `data` (a JSON string) to the page as a `type` message, now or once the page is ready.
    func send(_ type: String, _ data: String) {
        guard ready else {
            if type != "post" { queue.removeAll { $0.0 == type } }
            queue.append((type, data))
            return
        }
        let message = ["type": type, "data": data]
        guard let json = try? JSONSerialization.data(withJSONObject: message),
              let text = String(data: json, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.px && window.px.receive(\(text))", completionHandler: nil)
    }

    fileprivate func received(_ body: String) {
        if body.contains("\"type\":\"ready\"") {
            ready = true
            let pending = queue
            queue = []
            for (type, data) in pending { send(type, data) }
        }
        emit("message", body)
    }

    func dispose() {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "px")
        web.stopLoading()
    }
}
