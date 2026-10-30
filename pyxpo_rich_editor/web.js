// pyxpo-rich-editor in the browser and the desktop window: the editor page in an <iframe>.
// The page loads this file after app.js (see pyxpoPage in app.js).
(function () {
  "use strict";

  function makeView(el, emit) {
    const frame = document.createElement("iframe");
    frame.style.cssText = "width:100%;height:100%;border:0;display:block;background:transparent";
    frame.setAttribute("allowtransparency", "true");
    el.style.overflow = "hidden";
    el.appendChild(frame);
    let doc = null, ready = false;
    const latest = {};   // the last value of each prop the page reads, sent again to a page that reloads
    let queue = [];      // what waits for the page to say it is ready, in order

    function send(type, data) {
      if (!ready) {
        if (type !== "post") queue = queue.filter((m) => m[0] !== type);
        queue.push([type, data]);
        return;
      }
      if (frame.contentWindow) frame.contentWindow.postMessage({ __pxRichIn: { type: type, data: data } }, "*");
    }

    function onMessage(e) {
      if (e.source !== frame.contentWindow || !e.data || typeof e.data.__pxRich !== "string") return;
      const body = e.data.__pxRich;
      if (body.indexOf('"type":"ready"') >= 0) {
        ready = true;
        const pending = queue;
        queue = [];
        pending.forEach((m) => send(m[0], m[1]));
      }
      emit("message", body);
    }
    window.addEventListener("message", onMessage);

    return {
      update(props) {
        ["config", "value"].forEach((key) => {
          if (typeof props[key] === "string") { latest[key] = props[key]; send(key, props[key]); }
        });
        if (typeof props.document === "string" && props.document !== doc) {
          doc = props.document;
          ready = false;
          queue = Object.keys(latest).sort().map((k) => [k, latest[k]]);
          frame.srcdoc = doc;
        }
      },
      post(data) { send("post", data); },
      dispose() { window.removeEventListener("message", onMessage); frame.remove(); },
    };
  }

  pyxpoPage.defineView("PxRichEditorView", makeView);
  pyxpoPage.defineModule("RichEditor", (method, args, page) => {
    const v = page.view(args[0]);
    if (!v) throw new Error("The RichEditor is not mounted");
    switch (method) {
      case "post": return v.post(typeof args[1] === "string" ? args[1] : "{}");
      default: throw new Error("RichEditor has no method " + method);
    }
  });
})();
