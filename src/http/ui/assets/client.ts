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
  if (document.querySelector("[data-passkey-setup]") && location.hash.length > 1) {
    setupCode = location.hash.slice(1);
    history.replaceState(null, "", location.pathname + location.search);
  }

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

  document.addEventListener("click", function (event) {
    var target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return;
    if (target.hasAttribute("data-passkey-signin")) signIn(target);
    if (target.hasAttribute("data-copy")) copy(target);
  });

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (form instanceof HTMLFormElement && form.hasAttribute("data-passkey-setup")) {
      event.preventDefault();
      setUp(form);
    }
  });

  document.querySelectorAll("[data-js-only]").forEach(function (el) { el.hidden = false; });
  document.querySelectorAll("[data-no-js]").forEach(function (el) { el.hidden = true; });

  // A setup page that needs a code, opened without the link: show how to get the link.
  var setupForm = document.querySelector("[data-passkey-setup][data-needs-code]");
  if (setupForm && !setupCode) {
    setupForm.hidden = true;
    document.querySelectorAll("[data-setup-missing]").forEach(function (el) { el.hidden = false; });
  }
})();
`;
