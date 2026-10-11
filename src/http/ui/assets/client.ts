/**
 * The only client script: passkey setup and sign-in (WebAuthn needs JavaScript), and copy
 * buttons. Served as a file, because the Content-Security-Policy allows no inline script.
 * It writes text only (textContent), never HTML.
 */
export const CLIENT_SCRIPT = `"use strict";
(function () {
  var MESSAGES = {
    invalid_code: "This setup link is not valid. Use the newest link, or run npm run setup-link again.",
    invalid_name: "Enter your name (1 to 100 characters).",
    setup_closed: "Setup is closed. Sign in with your passkey.",
    invalid_credential: "This passkey did not work. Try again.",
    rate_limited: "Too many attempts. Wait 15 minutes, then try again.",
    forbidden: "The request came from another site. Reload the page.",
    NotAllowedError: "The passkey request was cancelled or timed out.",
    InvalidStateError: "This device already has a passkey for Checkend.",
    unsupported: "This browser does not support passkeys.",
    network: "Checkend did not answer. Check the connection and try again."
  };

  function toBuffer(text) {
    var base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function toText(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  }

  function credentials(list) {
    return (list || []).map(function (c) {
      return { id: toBuffer(c.id), type: c.type, transports: c.transports };
    });
  }

  function say(el, key, fallback) {
    if (el) el.textContent = MESSAGES[key] || fallback || key;
  }

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw { code: data.error || (response.status === 429 ? "rate_limited" : "network") };
        return data;
      });
    }, function () { throw { code: "network" }; });
  }

  function supported() {
    return !!(window.PublicKeyCredential && navigator.credentials);
  }

  function failure(statusEl, button) {
    return function (error) {
      var code = (error && (error.code || error.name)) || "network";
      say(statusEl, code, "Something went wrong (" + code + ").");
      if (button) button.disabled = false;
    };
  }

  function signIn(button) {
    var statusEl = document.getElementById("auth-status");
    if (!supported()) return say(statusEl, "unsupported");
    button.disabled = true;
    say(statusEl, "", "Waiting for your passkey…");
    post("/login/options", {})
      .then(function (o) {
        return navigator.credentials.get({
          publicKey: {
            challenge: toBuffer(o.challenge),
            rpId: o.rpId,
            timeout: o.timeout,
            userVerification: o.userVerification,
            allowCredentials: credentials(o.allowCredentials)
          }
        });
      })
      .then(function (cred) {
        return post("/login/verify", {
          response: {
            id: cred.id,
            rawId: toText(cred.rawId),
            type: cred.type,
            response: {
              clientDataJSON: toText(cred.response.clientDataJSON),
              authenticatorData: toText(cred.response.authenticatorData),
              signature: toText(cred.response.signature),
              userHandle: cred.response.userHandle ? toText(cred.response.userHandle) : undefined
            },
            clientExtensionResults: cred.getClientExtensionResults(),
            authenticatorAttachment: cred.authenticatorAttachment || undefined
          }
        });
      })
      .then(function (data) { window.location.assign(data.redirect); })
      .catch(failure(statusEl, button));
  }

  // The setup link carries the code in the URL fragment: browsers never send a fragment to a
  // server, so it is not in logs or in a Referer. Read it once, remove it from the address bar,
  // and send it in the request body.
  var setupCode = "";
  var setupForm = document.querySelector("[data-passkey-setup]");

  // Shows the form when a code is present; else, when the page needs one, how to get the link.
  function showSetup() {
    if (!setupForm || !setupForm.hasAttribute("data-needs-code")) return;
    setupForm.hidden = !setupCode;
    document.querySelectorAll("[data-setup-missing]").forEach(function (el) { el.hidden = !!setupCode; });
  }

  function readSetupCode() {
    if (!setupForm || location.hash.length <= 1) return;
    setupCode = location.hash.slice(1);
    history.replaceState(null, "", location.pathname + location.search);
  }
  readSetupCode();
  // A link pasted into the open setup page changes only the fragment: the page does not reload.
  window.addEventListener("hashchange", function () {
    readSetupCode();
    showSetup();
  });

  function setUp(form) {
    var statusEl = document.getElementById("auth-status");
    var button = form.querySelector("button[type=submit]");
    if (!supported()) return say(statusEl, "unsupported");
    var name = form.elements.namedItem("name").value;
    button.disabled = true;
    say(statusEl, "", "Waiting for your passkey…");
    post("/setup/options", { code: setupCode, name: name })
      .then(function (o) {
        return navigator.credentials.create({
          publicKey: {
            rp: o.rp,
            user: { id: toBuffer(o.user.id), name: o.user.name, displayName: o.user.displayName },
            challenge: toBuffer(o.challenge),
            pubKeyCredParams: o.pubKeyCredParams,
            timeout: o.timeout,
            attestation: o.attestation,
            authenticatorSelection: o.authenticatorSelection,
            excludeCredentials: credentials(o.excludeCredentials),
            extensions: o.extensions
          }
        });
      })
      .then(function (cred) {
        return post("/setup/verify", {
          code: setupCode,
          response: {
            id: cred.id,
            rawId: toText(cred.rawId),
            type: cred.type,
            response: {
              clientDataJSON: toText(cred.response.clientDataJSON),
              attestationObject: toText(cred.response.attestationObject),
              transports: cred.response.getTransports ? cred.response.getTransports() : []
            },
            clientExtensionResults: cred.getClientExtensionResults(),
            authenticatorAttachment: cred.authenticatorAttachment || undefined
          }
        });
      })
      .then(function (data) { window.location.assign(data.redirect); })
      .catch(failure(statusEl, button));
  }

  function copy(button) {
    var target = document.getElementById(button.getAttribute("data-copy"));
    if (!target || !navigator.clipboard) return;
    navigator.clipboard.writeText(target.textContent || "").then(function () {
      var label = button.textContent;
      button.textContent = "Copied";
      setTimeout(function () { button.textContent = label; }, 1500);
    });
  }

  function announce(text) {
    var region = document.getElementById("copy-status");
    if (region) region.textContent = text;
  }

  function copyText(text) {
    if (!navigator.clipboard) return Promise.reject(new Error("no clipboard"));
    return navigator.clipboard.writeText(text);
  }

  // An "Ask your agent" prompt: the text is in the button.
  function copyPrompt(button) {
    copyText(button.getAttribute("data-copy-text") || "").then(function () {
      button.setAttribute("data-copied", "");
      announce("Copied. Paste it into your coding agent.");
      setTimeout(function () { button.removeAttribute("data-copied"); }, 2000);
    }, function () {
      announce("The browser did not allow the copy.");
    });
  }

  // "Copy prompt": each click makes a new setup key, so the prompt in the box changes.
  function copySetupPrompt(form) {
    var button = form.querySelector("button[type=submit]");
    var statusEl = document.getElementById("prompt-status");
    var promptEl = document.getElementById("setup-prompt");
    var csrf = form.querySelector("input[name=_csrf]");
    button.disabled = true;
    statusEl.textContent = "Making a new setup key…";
    var request = fetch(form.getAttribute("action"), {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: "_csrf=" + encodeURIComponent(csrf ? csrf.value : "")
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || !data.prompt) throw { code: data.error || "network" };
        return data;
      });
    }, function () { throw { code: "network" }; });
    var text = request.then(function (data) { return data.prompt; });
    // Safari allows a copy only inside the click: a ClipboardItem can wait for the text.
    var copied = window.ClipboardItem && navigator.clipboard && navigator.clipboard.write
      ? navigator.clipboard.write([new window.ClipboardItem({
          "text/plain": text.then(function (t) { return new Blob([t], { type: "text/plain" }); })
        })]).catch(function () { return text.then(copyText); })
      : text.then(copyText);
    copied.catch(function () {}); // Handled below; when the request fails, nothing was copied.
    request.then(function (data) {
      var code = promptEl && promptEl.querySelector("code");
      if (code) code.textContent = data.prompt;
      if (promptEl) promptEl.removeAttribute("data-placeholder");
      var until = new Date(data.expires_at);
      var hhmm = isNaN(until.getTime()) ? "" : " until " + until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return copied.then(function () {
        statusEl.textContent = "Copied. Paste it into your coding agent. The key is valid" + hhmm + ".";
      }, function () {
        statusEl.textContent = "The prompt is ready above: select it and copy it. The key is valid" + hhmm + ".";
      });
    }).catch(function (error) {
      statusEl.textContent = error && error.code === "unavailable"
        ? "This install cannot make setup keys yet. Update Checkend, or add the app by hand."
        : "Checkend did not answer. Try again.";
    }).then(function () { button.disabled = false; });
  }

  // The live checklist: poll every 2 seconds while the tab is visible, and set text only.
  function updateProgress(section, data) {
    var only = section.getAttribute("data-progress-only");
    var apps = (data.apps || []).filter(function (app) { return !only || String(app.id) === only; });
    var list = section.querySelector("[data-progress-apps]");
    var waiting = section.querySelector("[data-progress-waiting]");
    var template = section.querySelector("[data-progress-template]");
    if (waiting) {
      waiting.hidden = apps.length > 0;
      waiting.textContent = data.waiting
        ? "Your agent has a key. Waiting for it to connect the app…"
        : "Waiting for your agent. Copy the prompt, then paste it into your agent.";
    }
    apps.forEach(function (app) {
      var id = String(Number(app.id));
      var row = list.querySelector('[data-app="' + id + '"]');
      if (!row && template) {
        row = template.content.firstElementChild.cloneNode(true);
        row.setAttribute("data-app", id);
        list.appendChild(row);
      }
      if (!row) return;
      var name = row.querySelector("[data-app-name]");
      name.textContent = String(app.name);
      name.setAttribute("href", "/apps/" + id);
      row.querySelector("[data-app-count]").textContent = Number(app.done) + " of 5";
      (app.steps || []).forEach(function (step) {
        if (!/^[a-z_]+$/.test(step.key)) return;
        var item = row.querySelector('[data-step="' + step.key + '"]');
        if (!item) return;
        item.setAttribute("data-done", step.done ? "true" : "false");
        item.querySelector(".step-detail").textContent = String(step.detail);
        item.querySelector("[data-step-state]").textContent = step.done ? " (done)" : " (not yet)";
      });
    });
    var done = section.querySelector("[data-progress-done]");
    if (done) done.hidden = !data.all_complete;
    return only ? apps.length > 0 && apps.every(function (a) { return a.complete; }) : data.all_complete;
  }

  function pollProgress(section) {
    var stopped = false;
    function tick() {
      if (stopped || document.visibilityState !== "visible") return;
      fetch("/apps/progress", { credentials: "same-origin", headers: { accept: "application/json" } })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (data) { if (data && updateProgress(section, data)) stopped = true; })
        .catch(function () {});
    }
    setInterval(tick, 2000);
    document.addEventListener("visibilitychange", tick);
  }

  document.addEventListener("click", function (event) {
    var target = event.target instanceof Element ? event.target.closest("button") : null;
    // A click outside an open menu closes it.
    if (document.querySelectorAll) {
      document.querySelectorAll("details.menu[open]").forEach(function (menu) {
        if (!(event.target instanceof Element) || !menu.contains(event.target)) menu.removeAttribute("open");
      });
    }
    if (!target) return;
    if (target.hasAttribute("data-passkey-signin")) signIn(target);
    if (target.hasAttribute("data-copy")) copy(target);
    if (target.hasAttribute("data-copy-text")) copyPrompt(target);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    document.querySelectorAll("details.menu[open]").forEach(function (menu) {
      menu.removeAttribute("open");
      var summary = menu.querySelector("summary");
      if (summary) summary.focus();
    });
  });

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.hasAttribute("data-passkey-setup")) {
      event.preventDefault();
      setUp(form);
    }
    if (form.hasAttribute("data-setup-prompt")) {
      event.preventDefault();
      copySetupPrompt(form);
    }
  });

  var progressSection = document.querySelector("[data-progress]");
  if (progressSection) pollProgress(progressSection);

  document.querySelectorAll("[data-js-only]").forEach(function (el) { el.hidden = false; });
  document.querySelectorAll("[data-no-js]").forEach(function (el) { el.hidden = true; });

  showSetup();
})();
`;
