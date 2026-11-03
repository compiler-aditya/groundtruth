/* Accounts in the browser: the sign-in and sign-up dialog, and the account button. Used by the site and the studio.
   The session lives in an HttpOnly cookie set by the server; this file only knows who is signed in. */
"use strict";
window.GTAuth = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const A = { user: null, on: false, subs: new Set(), mounts: new Set(), mode: "signin" };
  const ready = fetch("/api/auth/me").then((r) => (r.ok ? r.json() : {})).then((me) => { A.user = me.user || null; A.on = !!me.accounts; })
    .catch(() => {}).then(() => paintAll());

  async function post(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `The server answered ${res.status}.`);
    return data;
  }
  function set(user) {
    A.user = user;
    paintAll();
    A.subs.forEach((fn) => fn(user));
  }

  /* ---------------- the dialog ---------------- */
  const COPY = {
    signin: ["Welcome back", "Sign in", "current-password", "New here?", "Create an account"],
    signup: ["Create your account", "Create account", "new-password", "Have an account?", "Sign in"],
  };
  function dialog() {
    let d = document.getElementById("auth-dlg");
    if (d) return d;
    d = document.createElement("dialog");
    d.id = "auth-dlg";
    d.className = "auth-dlg";
    d.innerHTML = `<form class="auth-card" novalidate>
      <button type="button" class="auth-x" data-auth="close" aria-label="Close">×</button>
      <img class="auth-mark" src="/logo.svg" alt="" width="40" height="40"><h2 id="auth-title"></h2><p class="auth-note" id="auth-note"></p>
      <label class="auth-f" data-only="signup"><span>Name</span><input name="name" autocomplete="name" maxlength="60" placeholder="Your name"></label>
      <label class="auth-f"><span>Email</span><input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
      <label class="auth-f"><span>Password</span><span class="auth-pw"><input name="password" type="password" required minlength="8" placeholder="At least 8 characters">
        <button type="button" data-auth="eye" aria-label="Show password">Show</button></span></label>
      <p class="auth-err" role="alert"></p>
      <button class="btn primary big auth-go" type="submit"></button>
      <p class="auth-switch"><span></span> <button type="button" class="link" data-auth="switch"></button></p></form>`;
    document.body.appendChild(d);
    const form = d.querySelector("form");
    d.addEventListener("click", (e) => {
      const act = e.target.closest("[data-auth]")?.dataset.auth;
      if (e.target === d || act === "close") d.close();
      else if (act === "switch") mode(A.mode === "signin" ? "signup" : "signin");
      else if (act === "eye") {
        const input = form.password, show = input.type === "password";
        input.type = show ? "text" : "password";
        e.target.textContent = show ? "Hide" : "Show";
      }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const go = form.querySelector(".auth-go"), err = form.querySelector(".auth-err");
      const body = { email: form.email.value, password: form.password.value, name: form.name.value };
      if (!form.email.value.includes("@")) return (err.textContent = "Enter your email address.");
      if (form.password.value.length < 8) return (err.textContent = "Passwords have at least 8 characters.");
      go.disabled = true;
      err.textContent = "";
      try {
        const { user } = await post(A.mode === "signin" ? "/api/auth/login" : "/api/auth/signup", body);
        form.password.value = "";
        d.close();
        set(user);
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        go.disabled = false;
      }
    });
    return d;
  }
  function mode(m) {
    const d = dialog(), [title, go, auto, ask, other] = COPY[m];
    A.mode = m;
    d.querySelector("#auth-title").textContent = title;
    d.querySelector(".auth-go").textContent = go;
    d.querySelector(".auth-switch span").textContent = ask;
    d.querySelector("[data-auth=switch]").textContent = other;
    d.querySelector("input[name=password]").autocomplete = auto;
    d.querySelectorAll("[data-only]").forEach((el) => (el.hidden = el.dataset.only !== m));
    d.querySelector(".auth-err").textContent = "";
  }
  function open(m = "signin", note = "Save your designs to your account and open them anywhere.") {
    const d = dialog();
    mode(m);
    d.querySelector("#auth-note").textContent = note;
    if (!d.open) d.showModal();
    d.querySelector(m === "signup" ? "input[name=name]" : "input[name=email]").focus();
  }
  async function signOut() {
    await post("/api/auth/logout").catch(() => {});
    set(null);
  }

  /* ---------------- the account button ---------------- */
  function paint(el) {
    if (!el.isConnected) return A.mounts.delete(el);
    if (!A.on) return (el.innerHTML = "");
    const u = A.user;
    el.innerHTML = u ? `<details class="acct"><summary class="acct-av" title="${esc(u.email)}">${esc((u.name || u.email)[0].toUpperCase())}</summary>
        <div class="acct-list"><div class="acct-who"><b>${esc(u.name)}</b><span>${esc(u.email)}</span></div>
        <a href="/studio#/">Your designs</a><button type="button" data-acct="out">Sign out</button></div></details>`
      : `<button type="button" class="btn small acct-in" data-acct="in">Sign in</button>`;
  }
  function paintAll() { A.mounts.forEach(paint); }
  function mount(el) {
    if (!el) return;
    A.mounts.add(el);
    paint(el);
  }
  document.addEventListener("click", (e) => {
    const act = e.target.closest("[data-acct]")?.dataset.acct;
    if (act === "in") open("signin");
    else if (act === "up") open("signup");
    else if (act === "out") { e.target.closest("details")?.removeAttribute("open"); signOut(); }
    else if (!e.target.closest(".acct")) document.querySelectorAll("details.acct[open]").forEach((d) => d.removeAttribute("open"));
  });

  return { ready, open, signOut, mount, onChange: (fn) => A.subs.add(fn), get user() { return A.user; }, get on() { return A.on; } };
})();
