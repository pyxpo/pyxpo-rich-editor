package dev.pyxpo.modules.richeditor

import dev.pyxpo.moduleapi.PxModule
import dev.pyxpo.moduleapi.PxModuleContext
import dev.pyxpo.moduleapi.PxNativeView
import dev.pyxpo.moduleapi.PxReply
import org.json.JSONArray

/** pyxpo-rich-editor on Android: a view (`PxRichEditorView`) that shows the bundled editor page in a WebView. */
class RichEditorModule : PxModule() {
    override val name = "RichEditor"
    override val viewTypes = setOf("PxRichEditorView")

    override fun makeView(ctx: PxModuleContext, type: String, emit: (name: String, value: Any?) -> Unit): PxNativeView =
        PxRichEditor(ctx.activity, emit)

    override fun call(ctx: PxModuleContext, method: String, args: JSONArray, reply: PxReply) {
        ctx.activity.runOnUiThread {
            val v = (if (args.length() > 0) ctx.view(args.optInt(0, -1)) else null) as? PxRichEditor
            if (v == null) {
                reply(null, "The RichEditor is not mounted")
                return@runOnUiThread
            }
            when (method) {
                "post" -> { v.send("post", args.optString(1, "{}")); reply(null, null) }
                else -> reply(null, "RichEditor has no method $method")
            }
        }
    }
}
