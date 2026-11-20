/*
 * Method365 CRM panel for Outlook.
 * Reading an email: who the other person is in the CRM, log the email, create a lead / contact / account /
 * opportunity / case / follow-up task from it.
 * Writing an email: insert a product table, attach a quote's PDF, insert the CRM signature.
 * Signs in once through a pop-up (the CRM's sign-in page); after that it uses a token kept in this browser.
 */
(function () {
  "use strict";

  var TOKEN_KEY = "m365crm.token";
  var app = document.getElementById("app");
  var who = document.getElementById("who");
  var me = null;

  /* ---------- tiny DOM helper (no HTML strings from the CRM or the email are ever parsed) ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  function show() { app.textContent = ""; add(app, Array.prototype.slice.call(arguments)); }
  function card(title) { return h("section", { class: "card" }, title ? h("h2", { text: title }) : null, Array.prototype.slice.call(arguments, 1)); }
  function note(kind, text, url) {
    return h("div", { class: "note " + kind, role: kind === "err" ? "alert" : "status" }, text, url ? [" ", openLink(url, "Open in CRM")] : null);
  }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  /* ---------- token + CRM calls ---------- */
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* storage blocked */ } }

  function api(method, path, body) {
    return fetch("/api/addin/" + path, {
      method: method, cache: "no-store",
      headers: Object.assign({ Authorization: "Bearer " + token() }, body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401) { setToken(""); signedOut(); throw new Error("signed-out"); }
        if (!r.ok && !("ok" in data)) throw new Error(data.error || "The CRM didn't answer (" + r.status + ").");
        return data;
      });
    });
  }

  function openUrl(path) {
    var url = new URL(path, location.origin).href;
    try {
      if (Office.context.requirements.isSetSupported("OpenBrowserWindowApi", "1.1")) { Office.context.ui.openBrowserWindow(url); return; }
    } catch (e) { /* fall through */ }
    window.open(url, "_blank", "noopener");
  }
  function openLink(path, label) {
    return h("button", { class: "link", type: "button", onclick: function () { openUrl(path); } }, label || "Open");
  }

  /* ---------- sign-in ---------- */
  function signedOut(msg) {
    me = null; who.textContent = "";
    show(h("div", { class: "card hero" },
      h("img", { src: "icon-128.png", alt: "" }),
      h("h1", { text: "Connect to your CRM" }),
      h("p", { class: "muted", text: "Sign in once with your CRM email and password. The panel then shows your CRM records next to your emails." }),
      msg ? note("err", msg) : null,
      h("button", { class: "btn primary full", type: "button", onclick: connect }, "Sign in to the CRM")));
  }

  function connect() {
    var url = location.origin + "/api/addin/start";
    Office.context.ui.displayDialogAsync(url, { height: 70, width: 35, promptBeforeOpen: false }, function (res) {
      if (res.status !== Office.AsyncResultStatus.Succeeded) {
        signedOut("Couldn't open the sign-in window" + (res.error && res.error.message ? " (" + res.error.message + ")" : "") + ". Allow pop-ups for Outlook and try again.");
        return;
      }
      var dialog = res.value;
      dialog.addEventHandler(Office.EventType.DialogMessageReceived, function (arg) {
        var data = null;
        try { data = JSON.parse(arg.message); } catch (e) { /* ignore */ }
        if (data && data.type === "m365-token" && data.token) {
          setToken(data.token);
          dialog.close();
          start();
        }
      });
      dialog.addEventHandler(Office.EventType.DialogEventReceived, function () { /* closed by the user */ });
    });
  }

  function signOut() {
    api("POST", "signout").catch(function () {}).then(function () { setToken(""); signedOut(); });
  }

  /* ---------- reading the open email ---------- */
  function item() { return Office.context.mailbox.item; }
  function isRead() { var it = item(); return it && typeof it.subject === "string"; }
  function addrList(a) { return (a || []).map(function (r) { return r.displayName && r.displayName !== r.emailAddress ? r.displayName + " <" + r.emailAddress + ">" : r.emailAddress; }); }
  function mailbox() { try { return (Office.context.mailbox.userProfile.emailAddress || "").toLowerCase(); } catch (e) { return ""; } }

  /** The other person on an email: the sender, or for one this mailbox sent, its first recipient. */
  function otherParty(it) {
    var from = it.from || it.sender || {};
    if ((from.emailAddress || "").toLowerCase() === mailbox() && it.to && it.to.length) return it.to[0];
    return from;
  }

  function readMail() {
    var it = item();
    return new Promise(function (resolve) {
      it.body.getAsync(Office.CoercionType.Html, function (hr) {
        it.body.getAsync(Office.CoercionType.Text, function (tr) {
          var from = it.from || it.sender || {};
          var party = otherParty(it);
          resolve({
            subject: it.subject || "", from: from.emailAddress || "", fromName: from.displayName || "",
            party: party.emailAddress || "", partyName: party.displayName || "",
            to: addrList(it.to), cc: addrList(it.cc),
            date: (it.dateTimeCreated || new Date()).toISOString(),
            html: hr.status === Office.AsyncResultStatus.Succeeded ? hr.value : "",
            text: tr.status === Office.AsyncResultStatus.Succeeded ? tr.value : "",
            attachments: (it.attachments || []).filter(function (a) { return !a.isInline; }).map(function (a) { return a.name; }),
          });
        });
      });
    });
  }

  /* ---------- what the CRM knows (read and compose) ---------- */
  function matchCard(person, data) {
    var rows = [];
    if (data.contact) rows.push(h("div", { class: "row" }, h("span", { class: "tag", text: "Contact" }), h("span", { class: "grow t", text: data.contact.name }), openLink("/contacts/" + data.contact.id)));
    if (data.lead) rows.push(h("div", { class: "row" }, h("span", { class: "tag", text: "Lead" }), h("span", { class: "grow t", text: data.lead.name }), openLink("/leads/" + data.lead.id)));
    if (data.account) rows.push(h("div", { class: "row" }, h("span", { class: "tag", text: "Account" }), h("span", { class: "grow t", text: data.account.name }), openLink("/accounts/" + data.account.id)));
    var opps = (data.opportunities || []).map(function (o) {
      return h("div", { class: "row" }, h("div", { class: "grow" }, h("div", { class: "t", text: o.name }), h("div", { class: "muted small", text: [o.number, o.stage].filter(Boolean).join(" · ") })), openLink("/opportunities/" + o.id));
    });
    var qs = (data.quotes || []).map(function (q) {
      return h("div", { class: "row" }, h("div", { class: "grow" }, h("div", { class: "t", text: q.number || "Quote" }), h("div", { class: "muted small", text: [q.status, q.total].filter(Boolean).join(" · ") })), openLink("/quotes/" + q.id));
    });
    return [
      card(null,
        h("div", { class: "person", text: person.displayName || person.emailAddress || "Unknown" }),
        h("div", { class: "email", text: person.emailAddress || "" }),
        h("div", { style: "margin-top:6px" }, rows.length ? rows : h("p", { class: "muted", style: "margin:4px 0 0", text: "Not in the CRM yet." }))),
      opps.length ? card("Opportunities", opps) : null,
      qs.length ? card("Quotes", qs) : null,
    ];
  }

  /* ---------- read mode ---------- */
  function renderRead() {
    var it = item();
    var person = otherParty(it);
    show(h("p", { class: "muted pad", text: "Looking up " + (person.emailAddress || "the sender") + "…" }));
    var mailPromise = readMail();
    api("POST", "lookup", { email: person.emailAddress || "" }).then(function (data) {
      var status = h("div");
      var say = function (kind, text, url) { status.textContent = ""; add(status, note(kind, text, url)); };
      var run = function (btn, path, extra) {
        btn.disabled = true;
        return mailPromise.then(function (mail) { return api("POST", path, Object.assign({ mail: mail }, extra)); })
          .then(function (r) { if (r.ok) say("ok", r.message, r.url); else say("err", r.error); return r; })
          .catch(function (e) { if (e.message !== "signed-out") say("err", e.message); })
          .then(function (r) { btn.disabled = false; return r; });
      };

      var parts = [matchCard(person, data)];
      if (data.writable) {
        // Log on a record: the person's own records first, then everything this user can see.
        var sel = h("select", { "aria-label": "Record to log this email on" }, h("option", { value: "", text: "Choose a record…" }));
        if (data.targets.suggested.length) sel.appendChild(h("optgroup", { label: "This person in the CRM" }, data.targets.suggested.map(function (t) { return h("option", { value: t.v, text: t.l }); })));
        data.targets.groups.forEach(function (g) { sel.appendChild(h("optgroup", { label: g.label }, g.options.map(function (t) { return h("option", { value: t.v, text: t.l }); }))); });
        if (data.targets.suggested.length) sel.value = data.targets.suggested[0].v;
        var logBtn = h("button", { class: "btn primary", type: "button" }, "Log email");
        logBtn.addEventListener("click", function () {
          if (!sel.value) { say("err", "Choose the record to log this email on."); return; }
          run(logBtn, "log", { target: sel.value });
        });
        parts.push(card("Log this email", h("div", { class: "stack" }, sel, logBtn, h("p", { class: "muted small", style: "margin:0", text: "Saved on the record's timeline, formatted as in Outlook." }))));

        var make = function (kind, label) {
          var b = h("button", { class: "btn", type: "button" }, label);
          b.addEventListener("click", function () { run(b, "create", { kind: kind }).then(function (r) { if (r && r.ok && kind !== "opportunity" && kind !== "case") renderRead(); }); });
          return b;
        };
        var due = h("input", { type: "date", "aria-label": "Follow-up date", value: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) });
        var taskBtn = h("button", { class: "btn", type: "button" }, "Add task");
        taskBtn.addEventListener("click", function () { run(taskBtn, "create", { kind: "task", due: due.value }); });
        parts.push(card("Create from this email",
          h("div", { class: "grid2" },
            make("opportunity", "Opportunity"),
            data.lead || data.contact ? null : make("lead", "Lead"),
            data.contact ? null : make("contact", "Contact"),
            data.account ? null : make("account", "Account"),
            make("case", "Case")),
          h("p", { class: "muted small", style: "margin:8px 0 4px", text: "Follow-up task" }),
          h("div", { class: "inline" }, due, taskBtn)));
      } else {
        parts.push(card(null, h("p", { class: "muted", style: "margin:0", text: "Your CRM role can view records but not change them." })));
      }
      show(status, parts);
    }).catch(function (e) { if (e.message !== "signed-out") show(note("err", e.message)); });
  }

  /* ---------- compose mode ---------- */
  function insertHtml(html, text, done) {
    var it = item();
    it.body.getTypeAsync(function (t) {
      var asHtml = t.status === Office.AsyncResultStatus.Succeeded && t.value === Office.CoercionType.Html;
      it.body.setSelectedDataAsync(asHtml ? html : text, { coercionType: asHtml ? Office.CoercionType.Html : Office.CoercionType.Text }, function (r) {
        done(r.status === Office.AsyncResultStatus.Succeeded ? null : (r.error && r.error.message) || "Outlook didn't accept it.");
      });
    });
  }

  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }

  function productsCard() {
    var chosen = {}; // id -> cells, kept while searching
    var headers = [];
    var list = h("div", { class: "list" }, h("p", { class: "muted pad", text: "Loading products…" }));
    var status = h("div");
    var btn = h("button", { class: "btn primary", type: "button", disabled: true }, "Insert table");
    var count = function () { var n = Object.keys(chosen).length; btn.disabled = !n; btn.textContent = n ? "Insert table (" + n + ")" : "Insert table"; };
    var load = function (q) {
      api("GET", "products?q=" + encodeURIComponent(q || "")).then(function (r) {
        headers = r.headers;
        list.textContent = "";
        if (!r.rows.length) { add(list, h("p", { class: "muted pad", text: q ? "No products match." : "No products in the Product Master." })); return; }
        r.rows.forEach(function (row) {
          var cb = h("input", { type: "checkbox" });
          cb.checked = !!chosen[row.id];
          cb.addEventListener("change", function () { if (cb.checked) chosen[row.id] = row.cells; else delete chosen[row.id]; count(); });
          var sub = row.cells.filter(function (c) { return c && c !== row.name && c !== "TBD"; }).slice(0, 3).join(" · ");
          add(list, h("label", null, cb, h("span", null, h("div", { text: row.name || row.cells[0] || "Product" }), h("div", { class: "muted small", text: sub }))));
        });
      }).catch(function (e) { if (e.message !== "signed-out") { list.textContent = ""; add(list, note("err", e.message)); } });
    };
    var search = h("input", { type: "search", placeholder: "Search products", "aria-label": "Search products" });
    search.addEventListener("input", debounce(function () { load(search.value); }, 300));
    btn.addEventListener("click", function () {
      var rows = Object.keys(chosen).map(function (id) { return chosen[id]; });
      var cell = "border:1px solid #999;padding:4px 8px;font-family:Calibri,Arial,sans-serif;font-size:11pt;vertical-align:top";
      var all = ["Sl No."].concat(headers);
      var html = '<table style="border-collapse:collapse"><tr>' + all.map(function (x) { return '<th style="' + cell + ';background:#f2f2f2;text-align:left">' + esc(x) + "</th>"; }).join("") + "</tr>"
        + rows.map(function (r, i) { return "<tr>" + [String(i + 1)].concat(r).map(function (c) { return '<td style="' + cell + '">' + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table><br>";
      var text = [all].concat(rows.map(function (r, i) { return [String(i + 1)].concat(r); })).map(function (r) { return r.join("\t"); }).join("\n") + "\n";
      btn.disabled = true;
      insertHtml(html, text, function (err) {
        status.textContent = "";
        add(status, err ? note("err", err) : note("ok", "Table with " + rows.length + " product" + (rows.length === 1 ? "" : "s") + " added where the cursor is."));
        if (!err) { chosen = {}; load(search.value); }
        count();
      });
    });
    load("");
    return card("Insert products", h("div", { class: "stack" }, search, list, btn, status));
  }

  function quoteCard() {
    var canAttach = Office.context.requirements.isSetSupported("Mailbox", "1.8");
    var sel = h("select", { "aria-label": "Quote" }, h("option", { value: "", text: "Loading quotes…" }));
    var status = h("div");
    var btn = h("button", { class: "btn primary", type: "button" }, "Attach quote PDF");
    var load = function (q) {
      api("GET", "quotes?q=" + encodeURIComponent(q || "")).then(function (r) {
        sel.textContent = "";
        add(sel, h("option", { value: "", text: r.quotes.length ? "Choose a quote…" : "No quotes found" }));
        r.quotes.forEach(function (q) { add(sel, h("option", { value: q.id, text: [q.number, q.account, q.total, q.status].filter(Boolean).join(" · ") })); });
      }).catch(function () {});
    };
    var search = h("input", { type: "search", placeholder: "Search quotes (number, account)", "aria-label": "Search quotes" });
    search.addEventListener("input", debounce(function () { load(search.value); }, 300));
    btn.addEventListener("click", function () {
      if (!sel.value) { status.textContent = ""; add(status, note("err", "Choose a quote.")); return; }
      btn.disabled = true; btn.textContent = "Making the PDF…";
      status.textContent = "";
      var finish = function (kind, msg) { btn.disabled = false; btn.textContent = "Attach quote PDF"; status.textContent = ""; add(status, note(kind, msg)); };
      api("POST", "ticket", { quoteId: sel.value }).then(function (r) {
        // The quote's print page makes the copy-proof PDF (a picture of the quote) and hands it back here.
        var frame = h("iframe", { src: r.url, title: "Quote PDF", style: "position:fixed;left:0;top:0;width:820px;height:1100px;border:0;opacity:0;pointer-events:none;z-index:-1" });
        var timer = setTimeout(function () { cleanup(); finish("err", "Making the PDF took too long. Try again."); }, 90000);
        var onMsg = function (ev) {
          if (ev.origin !== location.origin || !ev.data || ev.data.type !== "quote-pdf") return;
          cleanup();
          if (ev.data.error || !ev.data.data) { finish("err", "Couldn't make the PDF: " + (ev.data.error || "unknown error")); return; }
          item().addFileAttachmentFromBase64Async(ev.data.data, ev.data.fileName || "Quote.pdf", { isInline: false }, function (a) {
            if (a.status === Office.AsyncResultStatus.Succeeded) finish("ok", (ev.data.fileName || "Quote PDF") + " attached.");
            else finish("err", "Outlook couldn't attach it: " + ((a.error && a.error.message) || "unknown error"));
          });
        };
        function cleanup() { clearTimeout(timer); window.removeEventListener("message", onMsg); if (frame.parentNode) frame.parentNode.removeChild(frame); }
        window.addEventListener("message", onMsg);
        document.body.appendChild(frame);
      }).catch(function (e) { if (e.message !== "signed-out") finish("err", e.message); });
    });
    load("");
    return card("Attach a quote",
      canAttach ? h("div", { class: "stack" }, search, sel, btn, h("p", { class: "muted small", style: "margin:0", text: "The PDF is a picture of the quote, so its text can't be copied." }), status)
        : h("p", { class: "muted", style: "margin:0", text: "This version of Outlook can't add attachments from add-ins. Use the quote's \"Email to customer\" button in the CRM instead." }));
  }

  function signatureCard() {
    var status = h("div");
    var btn = h("button", { class: "btn", type: "button" }, "Insert my CRM signature");
    btn.addEventListener("click", function () {
      btn.disabled = true;
      api("GET", "signature").then(function (r) {
        if (!r.html) { btn.disabled = false; status.textContent = ""; add(status, note("err", "You haven't set a signature in the CRM yet (Profile → Email signature).")); return; }
        // Plain-text version for emails written in plain text (parsed inertly: nothing in it runs or loads).
        var plain = new DOMParser().parseFromString(r.html, "text/html").body.textContent || "";
        insertHtml(r.html, plain, function (err) {
          btn.disabled = false; status.textContent = "";
          add(status, err ? note("err", err) : note("ok", "Signature added where the cursor is."));
        });
      }).catch(function (e) { btn.disabled = false; if (e.message !== "signed-out") { status.textContent = ""; add(status, note("err", e.message)); } });
    });
    return card("Signature", h("div", { class: "stack" }, btn, status));
  }

  function renderCompose() {
    var recipient = h("div");
    show(recipient, productsCard(), quoteCard(), signatureCard());
    // Who the email is going to, as the CRM knows them.
    item().to.getAsync(function (r) {
      var first = r.status === Office.AsyncResultStatus.Succeeded && r.value && r.value[0];
      if (!first) return;
      api("POST", "lookup", { email: first.emailAddress }).then(function (data) { recipient.textContent = ""; add(recipient, matchCard(first, data)); }).catch(function () {});
    });
  }

  /* ---------- start ---------- */
  function render() {
    if (!item()) { show(card(null, h("p", { class: "muted", style: "margin:0", text: "Open an email to see it in the CRM." }))); return; }
    if (isRead()) renderRead(); else renderCompose();
  }

  function start() {
    if (!token()) { signedOut(); return; }
    api("GET", "me").then(function (u) {
      me = u;
      who.textContent = "";
      add(who, [h("div", { text: u.name }), h("a", { onclick: signOut, role: "button", tabindex: "0" }, "Sign out")]);
      render();
    }).catch(function (e) { if (e.message !== "signed-out") show(note("err", e.message)); });
  }

  Office.onReady(function () {
    // A pinned panel stays open while the user moves between emails.
    try { Office.context.mailbox.addHandlerAsync(Office.EventType.ItemChanged, function () { if (me) render(); }); } catch (e) { /* not supported */ }
    start();
  });
})();
