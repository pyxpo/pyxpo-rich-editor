package dev.pyxpo.modules.richeditor

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import dev.pyxpo.moduleapi.PxNativeView
import org.json.JSONObject

/**
 * The editor page in a WebView. The page posts its messages to `PxAndroid.post`; each one goes to Python as a
 * `message` event. What Python sends (`value`, `config`, `post`) waits until the page says it is ready.
 */
@SuppressLint("SetJavaScriptEnabled")
class PxRichEditor(context: Context, private val emit: (String, Any?) -> Unit) : PxNativeView {
    private val web = WebView(context)
    private val main = Handler(Looper.getMainLooper())
    private var document: String? = null
    private var ready = false
    /** The last value of each prop the page reads, sent again to a page that reloads. */
    private val latest = sortedMapOf<String, String>()
    /** What waits for the page to say it is ready, in the order it was set. */
    private val queue = mutableListOf<Pair<String, String>>()
    private var disposed = false
    override val view: View get() = web

    init {
        web.setBackgroundColor(Color.TRANSPARENT)
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            mediaPlaybackRequiresUserGesture = true
        }
        // Called on a WebView thread: hop to the main thread, where the view and Python's events live.
        web.addJavascriptInterface(object {
            @JavascriptInterface
            fun post(body: String) { main.post { received(body) } }
        }, "PxAndroid")
    }

    override fun update(props: JSONObject, removed: Set<String>) {
        for (key in listOf("config", "value")) {
            if (props.has(key)) {
                val s = props.optString(key)
                latest[key] = s
                send(key, s)
            }
        }
        if (props.has("document")) {
            val d = props.optString("document")
            if (d != document) {
                document = d
                ready = false
                queue.clear()
                for ((k, v) in latest) queue.add(k to v)
                web.loadDataWithBaseURL("https://editor.pyxpo.invalid/", d, "text/html", "utf-8", null)
            }
        }
    }

    /** Hands `data` (a JSON string) to the page as a `type` message, now or once the page is ready. */
    fun send(type: String, data: String) {
        if (!ready) {
            if (type != "post") queue.removeAll { it.first == type }
            queue.add(type to data)
            return
        }
        val message = JSONObject().put("type", type).put("data", data)
        web.evaluateJavascript("window.px && window.px.receive($message)", null)
    }

    private fun received(body: String) {
        if (disposed) return
        if (body.contains("\"type\":\"ready\"")) {
            ready = true
            val pending = queue.toList()
            queue.clear()
            for ((t, d) in pending) send(t, d)
        }
        emit("message", body)
    }

    override fun dispose() {
        disposed = true
        web.removeJavascriptInterface("PxAndroid")
        web.stopLoading()
        web.destroy()
    }
}
