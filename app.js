"use strict";
const $ = (id) => document.getElementById(id);
let generatedPassword = "";
let generatedVisible = false;
let vaultUnlocked = false;
let vaultCryptoKey = null;
let securityKeyMemory = "";
let securityKeyRevealTimer = 0;
let securityKeyRevealVisible = false;
let googleUser = null;
let googleScriptPromise = null;
let lastGeneratedMeta = null;
const STORAGE_KEY = "goblinpass_mobile_entries_v1";
const PIN_KEY = "goblinpass_mobile_pin_v1";
const VAULT_ENCRYPTION_VERSION = "vault-aes-gcm-v1";
const VAULT_KDF_ITERATIONS = 250000;
const THEME_KEY = "goblinpass_brand_theme_v1";
const MODE_KEY = "goblinpass_interface_mode_v1";
const SETTINGS_KEY = "goblinpass_mobile_settings_v1";
const TRUSTED_DEVICE_KEY = "goblinpass_trusted_device_key_v1";
const GOOGLE_CLIENT_ID = "908605927082-sne248f74g829ek1kh1mh11gumjj411m.apps.googleusercontent.com";
const CHARSET_KEYS = ["lower", "upper", "nums", "symbols"];
const SECURITY_INPUT_METHODS = ["normal", "desktop-shuffled", "mobile-combo"];
const PASSWORD_STYLES = ["maximum", "memorable"];
const MEMORABLE_STRENGTHS = ["easy", "standard", "strong"];
const DEFAULT_THEME = {
  siteName: "MyPass",
  tagline: "Private passwords, your way.",
  primary: "#77f05a",
  secondary: "#101914",
  text: "#effff2",
  muted: "#9fc7aa"
};

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function maskText(value) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 4) return s[0] + "***";
  if (s.includes("@")) {
    const [name, domain] = s.split("@");
    return (name.length <= 4 ? name[0] + "***" : name.slice(0, 4) + "***" + name.slice(-2)) + "@" + domain;
  }
  return s.slice(0, 4) + "***" + s.slice(-2);
}
function selectedKeys() {
  const keys = CHARSET_KEYS.filter(key => $(key).checked);
  return keys.length ? keys : CHARSET_KEYS;
}
function loadSettings() {
  try {
    return {
      securityKeyEnabled: false,
      securityKeyInputMethod: "",
      trustedDeviceEnabled: false,
      trustedDeviceBackedUp: false,
      copyPasswordOnly: false,
      defaultPasswordStyle: "maximum",
      saveWebsiteIds: true,
      googleSecurityFactorEnabled: false,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
    };
  }
  catch {
    return {
      securityKeyEnabled: false,
      securityKeyInputMethod: "",
      trustedDeviceEnabled: false,
      trustedDeviceBackedUp: false,
      copyPasswordOnly: false,
      defaultPasswordStyle: "maximum",
      saveWebsiteIds: true,
      googleSecurityFactorEnabled: false
    };
  }
}
function saveSettings(settings) {
  const next = { ...loadSettings(), ...settings };
  const method = SECURITY_INPUT_METHODS.includes(next.securityKeyInputMethod) ? next.securityKeyInputMethod : "";
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    securityKeyEnabled: !!next.securityKeyEnabled,
    securityKeyInputMethod: method,
    trustedDeviceEnabled: !!next.trustedDeviceEnabled,
    trustedDeviceBackedUp: !!next.trustedDeviceBackedUp,
    copyPasswordOnly: !!next.copyPasswordOnly,
    defaultPasswordStyle: PASSWORD_STYLES.includes(next.defaultPasswordStyle) ? next.defaultPasswordStyle : "maximum",
    saveWebsiteIds: next.saveWebsiteIds !== false,
    googleSecurityFactorEnabled: !!next.googleSecurityFactorEnabled
  }));
}
function isSecurityKeyEnabled() { return !!loadSettings().securityKeyEnabled; }
function getDefaultPasswordStyle() {
  const style = loadSettings().defaultPasswordStyle;
  return PASSWORD_STYLES.includes(style) ? style : "maximum";
}
function getQuickPasswordStyle() {
  return PASSWORD_STYLES.includes($("passwordStyle")?.value) ? $("passwordStyle").value : getDefaultPasswordStyle();
}
function getMemorableStrength() {
  return MEMORABLE_STRENGTHS.includes($("memorableStrength")?.value) ? $("memorableStrength").value : "standard";
}
function clearGeneratedResult() {
  generatedPassword = "";
  generatedVisible = false;
  lastGeneratedMeta = null;
  if ($("result")) $("result").classList.add("hidden");
}
function updatePasswordStyleUi() {
  const style = getQuickPasswordStyle();
  if ($("memorableOptions")) $("memorableOptions").classList.toggle("hidden", style !== "memorable");
}
function isMobileDevice() { return window.matchMedia("(pointer: coarse), (max-width: 640px)").matches; }
function getDefaultSecurityInputMethod() { return isMobileDevice() ? "mobile-combo" : "desktop-shuffled"; }
function getSecurityInputMethod() {
  const settings = loadSettings();
  return SECURITY_INPUT_METHODS.includes(settings.securityKeyInputMethod) ? settings.securityKeyInputMethod : getDefaultSecurityInputMethod();
}
function getSecurityKeyInputValue() {
  if (!$("securityKey")) return "";
  if (getSecurityInputMethod() === "normal") return $("securityKey").value;
  return securityKeyMemory.length === 6 && !securityKeyMemory.includes(" ") ? securityKeyMemory : "";
}
function maskSecurityKeyDisplay() {
  const value = getSecurityInputMethod() === "normal" ? $("securityKey").value : securityKeyMemory;
  return value ? "\u2022".repeat([...value].filter(char => char && char !== " ").length) : "";
}
function getSecurityProgressText() {
  return `${securityKeyMemory.split("").filter(char => char && char !== " ").length} of 6 characters selected`;
}
function updateSecurityKeyDisplay() {
  if (!$("securityKey")) return;
  if (getSecurityInputMethod() === "normal") return;
  $("securityKey").value = securityKeyRevealVisible ? securityKeyMemory : maskSecurityKeyDisplay();
  const progress = document.querySelector("[data-security-progress]");
  if (progress) progress.textContent = getSecurityProgressText();
  document.querySelectorAll("[data-combo-slot]").forEach((button, index) => {
    const char = securityKeyMemory[index];
    if (securityKeyRevealVisible && char && char !== " ") button.textContent = char;
    else if (char && char !== " ") button.textContent = "*";
    else button.textContent = index < 2 ? "L" : "#";
  });
}
function setSecurityKeyMemory(value) {
  const limit = getSecurityInputMethod() === "normal" ? 64 : 6;
  securityKeyMemory = String(value || "").toUpperCase().slice(0, limit);
  updateSecurityKeyDisplay();
}
function applySecurityKeySetting() {
  const settings = loadSettings();
  let method = settings.securityKeyInputMethod;
  if (settings.securityKeyEnabled && !SECURITY_INPUT_METHODS.includes(method)) {
    method = getDefaultSecurityInputMethod();
    saveSettings({ ...settings, securityKeyInputMethod: method });
  }
  const enabled = !!settings.securityKeyEnabled;
  $("enableSecurityKey").checked = enabled;
  $("securityKeyInputMethod").value = SECURITY_INPUT_METHODS.includes(method) ? method : getDefaultSecurityInputMethod();
  $("securityKeyBox").classList.toggle("hidden", !enabled);
  if ($("securityKeyMethodGroup")) $("securityKeyMethodGroup").classList.toggle("hidden", !enabled);
  if ($("securityKeyWarning")) $("securityKeyWarning").classList.toggle("hidden", !enabled);
  $("securityKeyInputMethod").disabled = !enabled;
  $("securityKey").readOnly = enabled && getSecurityInputMethod() !== "normal";
  $("securityKey").placeholder = getSecurityInputMethod() === "mobile-combo" ? "[L] [L] [#] [#] [#] [#]" : "Example: GP4837";
  if (!enabled) clearSecurityKey();
  else if (getSecurityInputMethod() !== "normal") $("securityKey").value = maskSecurityKeyDisplay();
  else securityKeyMemory = "";
}
function showPage(pageId) {
  document.querySelectorAll("[data-page-target]").forEach(item => item.classList.toggle("active", item.dataset.pageTarget === pageId));
  document.querySelectorAll(".page-section").forEach(section => section.classList.toggle("hidden", section.id !== pageId));
}
function clearSecurityKey() {
  securityKeyMemory = "";
  securityKeyRevealVisible = false;
  clearTimeout(securityKeyRevealTimer);
  if ($("securityKey")) $("securityKey").value = "";
  closeSecurityInputPanel();
}
function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlToBytes(value) {
  const padded = String(value || "").replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(value || "").length + 3) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}
function randomSalt() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function deriveVaultKey(pin, salt) {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(`GOBLINPASS-VAULT-v1|${salt}`),
      iterations: VAULT_KDF_ITERATIONS,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptVaultEntries(entries) {
  if (!vaultCryptoKey) throw new Error("Vault is locked.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(entries || []));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, vaultCryptoKey, plaintext);
  return {
    version: VAULT_ENCRYPTION_VERSION,
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: VAULT_KDF_ITERATIONS,
    iv: bytesToBase64Url(iv),
    data: bytesToBase64Url(new Uint8Array(ciphertext)),
    updated: new Date().toISOString()
  };
}
async function decryptVaultEntries(record) {
  if (!vaultCryptoKey) throw new Error("Vault is locked.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(record.iv || "") },
    vaultCryptoKey,
    base64UrlToBytes(record.data || "")
  );
  const entries = JSON.parse(new TextDecoder().decode(plaintext));
  return Array.isArray(entries) ? entries : [];
}
function createTrustedDeviceKey() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}
function getTrustedDeviceKey() {
  return localStorage.getItem(TRUSTED_DEVICE_KEY) || "";
}
function setTrustedDeviceKey(key) {
  localStorage.setItem(TRUSTED_DEVICE_KEY, key);
}
function ensureTrustedDeviceKey() {
  let key = getTrustedDeviceKey();
  if (!key) {
    key = createTrustedDeviceKey();
    setTrustedDeviceKey(key);
    saveSettings({ trustedDeviceBackedUp: false });
  }
  return key;
}
function getTrustedDeviceGenerationKey() {
  return loadSettings().trustedDeviceEnabled ? ensureTrustedDeviceKey() : "";
}
function recoveryKeyFromTrustedKey(key) {
  return `GP-TRUSTED-${key}`;
}
function trustedKeyFromRecoveryKey(value) {
  const clean = String(value || "").trim();
  const key = clean.startsWith("GP-TRUSTED-") ? clean.slice("GP-TRUSTED-".length) : clean;
  return /^[A-Za-z0-9_-]{32,}$/.test(key) ? key : "";
}
function updateTrustedDeviceStatus() {
  const settings = loadSettings();
  if ($("enableTrustedDevice")) $("enableTrustedDevice").checked = !!settings.trustedDeviceEnabled;
  if ($("copyPasswordOnly")) $("copyPasswordOnly").checked = !!settings.copyPasswordOnly;
  if ($("trustedDeviceDetails")) $("trustedDeviceDetails").classList.toggle("hidden", !settings.trustedDeviceEnabled);
  if ($("trustedDeviceWarning")) $("trustedDeviceWarning").classList.toggle("hidden", !settings.trustedDeviceEnabled);
  if (!$("trustedDeviceStatus")) return;
  if (!settings.trustedDeviceEnabled) {
    $("trustedDeviceStatus").textContent = "Trusted Device Protection: Disabled";
    return;
  }
  $("trustedDeviceStatus").textContent = `Trusted Device Protection: Enabled - Recovery Key: ${settings.trustedDeviceBackedUp ? "Backed up" : "Not backed up"}`;
}
async function showRecoveryKey() {
  const settings = loadSettings();
  if (!settings.trustedDeviceEnabled) return alert("Enable Trusted Device Protection first.");
  const ok = confirm("Anyone with this recovery key, your master password, and your Additional Secret can recreate your passwords. Store it safely offline.");
  if (!ok) return;
  const recoveryKey = recoveryKeyFromTrustedKey(ensureTrustedDeviceKey());
  try { await navigator.clipboard.writeText(recoveryKey); } catch {}
  prompt("Recovery Key. Store it safely offline.", recoveryKey);
  saveSettings({ trustedDeviceBackedUp: true });
  updateTrustedDeviceStatus();
}
function restoreTrustedDevice() {
  const value = prompt("Paste your Recovery Key:");
  if (value === null) return;
  const key = trustedKeyFromRecoveryKey(value);
  if (!key) return alert("That Recovery Key does not look valid.");
  setTrustedDeviceKey(key);
  saveSettings({ trustedDeviceEnabled: true, trustedDeviceBackedUp: true });
  updateTrustedDeviceStatus();
  alert("Trusted Device restored. Passwords using this Trusted Device Key can now be recreated here.");
}
function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(atob(base64).split("").map(char => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));
    return JSON.parse(json);
  } catch {
    return null;
  }
}
function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load Google Identity Services."));
    document.head.appendChild(script);
  });
  return googleScriptPromise;
}
function updateGoogleStatus() {
  const settings = loadSettings();
  if ($("googleSecurityFactor")) $("googleSecurityFactor").checked = !!settings.googleSecurityFactorEnabled;
  if ($("googleSecurityWarning")) $("googleSecurityWarning").classList.toggle("hidden", !settings.googleSecurityFactorEnabled);
  if (!$("googleSignInStatus")) return;
  if (googleUser) {
    $("googleSignInStatus").textContent = settings.googleSecurityFactorEnabled
      ? `Google Security Factor: Ready as ${googleUser.email || googleUser.name || "signed in"}`
      : `Google Sign-In: Signed in as ${googleUser.email || googleUser.name || "signed in"}`;
    return;
  }
  $("googleSignInStatus").textContent = settings.googleSecurityFactorEnabled
    ? "Google Security Factor: Sign in required before generating"
    : "Google Sign-In: Not signed in";
}
function isGoogleSecurityFactorEnabled() {
  return !!loadSettings().googleSecurityFactorEnabled;
}
function getGoogleSubjectForGeneration() {
  return isGoogleSecurityFactorEnabled() && googleUser?.sub ? googleUser.sub : "";
}
function handleGoogleCredential(response) {
  const payload = decodeJwtPayload(response.credential || "");
  if (!payload) return alert("Google sign-in response could not be read.");
  googleUser = {
    sub: payload.sub || "",
    email: payload.email || "",
    name: payload.name || ""
  };
  updateGoogleStatus();
}
async function setupGoogleSignIn() {
  updateGoogleStatus();
  try {
    await loadGoogleIdentityScript();
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      auto_select: false
    });
    $("googleSignInButton").innerHTML = "";
    google.accounts.id.renderButton($("googleSignInButton"), {
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular"
    });
  } catch (error) {
    alert(error.message);
  }
}
function googleSignOut() {
  googleUser = null;
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  updateGoogleStatus();
}
function closeSecurityInputPanel() {
  if ($("securityInputPanel")) {
    $("securityInputPanel").classList.add("hidden");
    $("securityInputPanel").innerHTML = "";
  }
}
function shuffleValues(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function openDesktopSecurityKeyboard() {
  const panel = $("securityInputPanel");
  const keys = shuffleValues("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""));
  panel.innerHTML = `
    <p class="security-panel-title">Enter the full Additional Secret</p>
    <p class="security-progress" data-security-progress>${getSecurityProgressText()}</p>
    <div class="security-key-grid">
      ${keys.map(key => `<button type="button" data-security-key="${key}">${key}</button>`).join("")}
    </div>
    <div class="security-actions">
      <button type="button" data-security-backspace>Backspace</button>
      <button type="button" data-security-clear>Clear</button>
      <button type="button" data-security-reveal>Reveal</button>
      <button type="button" data-security-done>Done</button>
    </div>`;
  panel.classList.remove("hidden");
  panel.querySelectorAll("[data-security-key]").forEach(button => {
    button.onclick = () => setSecurityKeyMemory(securityKeyMemory + button.dataset.securityKey);
  });
  panel.querySelector("[data-security-backspace]").onclick = () => setSecurityKeyMemory(securityKeyMemory.slice(0, -1));
  panel.querySelector("[data-security-clear]").onclick = clearSecurityKey;
  panel.querySelector("[data-security-reveal]").onclick = revealSecurityKey;
  panel.querySelector("[data-security-done]").onclick = closeSecurityInputPanel;
  updateSecurityKeyDisplay();
}
function optionList(values) {
  return values.map(value => `<option value="${value}">${value}</option>`).join("");
}
function openMobileCombinationLock() {
  const panel = $("securityInputPanel");
  panel.innerHTML = `
    <p class="security-panel-title">Choose 2 letters and 4 digits</p>
    <p class="security-progress" data-security-progress>${getSecurityProgressText()}</p>
    <div class="combo-slots">
      ${[0, 1, 2, 3, 4, 5].map(index => `<button type="button" data-combo-slot="${index}">${securityKeyMemory[index] && securityKeyMemory[index] !== " " ? "*" : (index < 2 ? "L" : "#")}</button>`).join("")}
    </div>
    <div class="combo-choice-panel hidden" data-combo-choices></div>
    <div class="security-actions combo-actions">
      <button type="button" data-security-clear>Clear</button>
      <button type="button" data-security-reveal>Reveal</button>
      <button type="button" data-security-done>Done</button>
    </div>`;
  panel.querySelectorAll("[data-combo-slot]").forEach(button => {
    button.onclick = () => openComboChoices(parseInt(button.dataset.comboSlot, 10));
  });
  panel.classList.remove("hidden");
  panel.querySelector("[data-security-clear]").onclick = clearSecurityKey;
  panel.querySelector("[data-security-reveal]").onclick = revealSecurityKey;
  panel.querySelector("[data-security-done]").onclick = closeSecurityInputPanel;
  updateSecurityKeyDisplay();
}
function openComboChoices(index) {
  const choices = document.querySelector("[data-combo-choices]");
  const values = (index < 2 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "0123456789").split("");
  choices.innerHTML = `
    <p class="security-panel-title">${index < 2 ? "Choose a letter" : "Choose a digit"}</p>
    <div class="security-key-grid combo-choice-grid">
      ${values.map(value => `<button type="button" data-combo-choice="${value}">${value}</button>`).join("")}
    </div>`;
  choices.classList.remove("hidden");
  choices.querySelectorAll("[data-combo-choice]").forEach(button => {
    button.onclick = () => {
      const chars = securityKeyMemory.padEnd(6, " ").split("");
      chars[index] = button.dataset.comboChoice;
      securityKeyMemory = chars.join("").trimEnd();
      securityKeyRevealVisible = false;
      choices.classList.add("hidden");
      choices.innerHTML = "";
      updateSecurityKeyDisplay();
    };
  });
}
function revealSecurityKey() {
  if (!securityKeyMemory) return;
  securityKeyRevealVisible = true;
  updateSecurityKeyDisplay();
  clearTimeout(securityKeyRevealTimer);
  securityKeyRevealTimer = setTimeout(() => {
    securityKeyRevealVisible = false;
    updateSecurityKeyDisplay();
  }, 3000);
}
function openSecurityInputMethod() {
  if (!isSecurityKeyEnabled()) return;
  const method = getSecurityInputMethod();
  if (method === "normal") return;
  if (method === "mobile-combo") openMobileCombinationLock();
  else openDesktopSecurityKeyboard();
}
function previewPassword(pw) {
  if (!pw) return "";
  if (pw.length <= 8) return pw[0] + "****" + pw.slice(-1);
  return pw.slice(0, 4) + "********" + pw.slice(-4);
}
function showResultMessage(message, allowShow = false) {
  if (!$("result") || !$("resultText")) return;
  $("resultText").textContent = message;
  $("result").classList.remove("hidden");
  if ($("toggleGenerated")) {
    $("toggleGenerated").classList.toggle("hidden", !allowShow);
    if (allowShow) $("toggleGenerated").textContent = generatedVisible ? "Hide" : "Show";
  }
}
async function copyGeneratedPassword() {
  if (!generatedPassword) return alert("Generate a password first.");
  try {
    await navigator.clipboard.writeText(generatedPassword);
    const visibleText = generatedVisible && !loadSettings().copyPasswordOnly ? generatedPassword : previewPassword(generatedPassword);
    $("resultText").textContent = "Copied: " + visibleText;
  } catch {
    alert("Clipboard copy was blocked. Use Show and copy it manually.");
  }
}
function getEntryId(entry) { return entry.siteId || ""; }
function getEntryKey(entry) { return entry.entryKey || entry.siteId || entry.site || entry.maskedLogin || entry.updated || ""; }
function getEntryTitle(entry) { return getEntryId(entry) || entry.site || getEntryLogin(entry) || "Saved entry"; }
function getEntryLogin(entry) { return entry.fullLogin || entry.maskedLogin || ""; }
async function loadEntries() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    if (vaultCryptoKey) await saveEntries(parsed);
    return parsed;
  }
  if (parsed?.version === VAULT_ENCRYPTION_VERSION) return await decryptVaultEntries(parsed);
  if (Array.isArray(parsed?.entries)) {
    if (vaultCryptoKey) await saveEntries(parsed.entries);
    return parsed.entries;
  }
  return [];
}
async function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(await encryptVaultEntries(entries)));
}
function getLogoInitials(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "GP";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
function loadTheme() {
  try { return { ...DEFAULT_THEME, ...JSON.parse(localStorage.getItem(THEME_KEY) || "{}") }; }
  catch { return { ...DEFAULT_THEME }; }
}
function saveTheme(theme) { localStorage.setItem(THEME_KEY, JSON.stringify(theme)); }
function applyTheme(theme) {
  document.documentElement.style.setProperty("--green", theme.primary);
  document.documentElement.style.setProperty("--green2", theme.primary);
  document.documentElement.style.setProperty("--border", theme.primary);
  document.documentElement.style.setProperty("--border2", theme.primary);
  document.documentElement.style.setProperty("--card", theme.secondary);
  document.documentElement.style.setProperty("--card2", theme.secondary);
  document.documentElement.style.setProperty("--text", theme.text);
  document.documentElement.style.setProperty("--muted", theme.muted);
  document.getElementById("brandTitle").textContent = theme.siteName;
  document.getElementById("brandTagline").textContent = theme.tagline;
  const logoMark = document.getElementById("brandLogoMark");
  if (logoMark && logoMark.tagName !== "IMG") logoMark.textContent = getLogoInitials(theme.siteName);
  document.title = theme.siteName;
}
function syncThemeInputs(theme) {
  $("themeSiteName").value = theme.siteName;
  $("themeTagline").value = theme.tagline;
  $("themePrimary").value = theme.primary;
  $("themeSecondary").value = theme.secondary;
  $("themeText").value = theme.text;
  $("themeMuted").value = theme.muted;
}
function currentThemeFromInputs() {
  return {
    siteName: $("themeSiteName").value.trim() || DEFAULT_THEME.siteName,
    tagline: $("themeTagline").value.trim() || DEFAULT_THEME.tagline,
    primary: $("themePrimary").value,
    secondary: $("themeSecondary").value,
    text: $("themeText").value,
    muted: $("themeMuted").value
  };
}
function updateThemeFromInputs() {
  const theme = currentThemeFromInputs();
  saveTheme(theme);
  applyTheme(theme);
}
function applyMode(mode) {
  const simple = mode !== "advanced";
  document.body.classList.toggle("simple-mode", simple);
  $("simpleMode").classList.toggle("active", simple);
  $("advancedMode").classList.toggle("active", !simple);
}
function saveMode(mode) {
  localStorage.setItem(MODE_KEY, mode);
  applyMode(mode);
}
async function hashPin(pin, salt) { return await sha256Hex("GOBLINPASS-PIN-v1|" + pin + "|" + salt); }
async function getPinRecord() {
  const raw = localStorage.getItem(PIN_KEY) || "";
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.salt && parsed?.hash) return parsed;
  } catch {}
  return { legacyHash: raw };
}
async function savePinRecord(record) { localStorage.setItem(PIN_KEY, JSON.stringify(record)); }
async function setPin(pin) {
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  await savePinRecord({ salt, hash, created: new Date().toISOString() });
  vaultCryptoKey = await deriveVaultKey(pin, salt);
}
async function checkPin(pin, record = null) {
  const saved = record || await getPinRecord();
  if (!saved) return false;
  if (saved.legacyHash) {
    const ok = await sha256Hex("GOBLINPASS-PIN-v1|" + pin) === saved.legacyHash;
    if (ok) {
      const salt = randomSalt();
      const hash = await hashPin(pin, salt);
      await savePinRecord({ salt, hash, migrated: new Date().toISOString() });
      vaultCryptoKey = await deriveVaultKey(pin, salt);
    }
    return ok;
  }
  const ok = await hashPin(pin, saved.salt) === saved.hash;
  if (ok) vaultCryptoKey = await deriveVaultKey(pin, saved.salt);
  return ok;
}
async function verifyPin(message) {
  const saved = await getPinRecord();
  if (!saved) {
    alert("Create a vault PIN first.");
    showPage("vaultPage");
    showVault();
    return false;
  }
  const pin = prompt(message || "Enter vault PIN:");
  if (pin === null) return false;
  const ok = await checkPin(pin, saved);
  if (!ok) alert("Wrong PIN.");
  return ok;
}
async function deterministicPassword(style = getQuickPasswordStyle(), strength = getMemorableStrength()) {
  return await window.goblinPassGenerate($("siteId").value, $("master").value, {
    length: $("length").value,
    counter: $("counter").value,
    selectedKeys: selectedKeys(),
    securityKey: isSecurityKeyEnabled() ? getSecurityKeyInputValue() : "",
    trustedDeviceKey: getTrustedDeviceGenerationKey(),
    googleSubjectId: getGoogleSubjectForGeneration(),
    passwordStyle: style,
    memorableStrength: strength
  });
}
async function generate() {
  if (!$("siteId").value.trim() || !$("master").value) return alert("Enter website ID and master password.");
  if (isSecurityKeyEnabled() && !getSecurityKeyInputValue()) return alert("Enter your Additional Secret, or turn it off in Settings.");
  if (isGoogleSecurityFactorEnabled() && !getGoogleSubjectForGeneration()) return alert("Sign in with Google before generating passwords, or turn off Google Security Factor in Settings.");
  const style = getQuickPasswordStyle();
  const strength = getMemorableStrength();
  generatedPassword = await deterministicPassword(style, strength);
  lastGeneratedMeta = { style, strength };
  generatedVisible = false;
  try { await navigator.clipboard.writeText(generatedPassword); } catch {}
  if (loadSettings().copyPasswordOnly) {
    $("resultText").textContent = "Password copied. Hidden by Copy Password Only mode.";
    $("toggleGenerated").classList.add("hidden");
  } else {
    $("resultText").textContent = "Generated and copied: " + previewPassword(generatedPassword);
    $("toggleGenerated").textContent = "Show";
    $("toggleGenerated").classList.remove("hidden");
  }
  $("result").classList.remove("hidden");
}
async function saveCurrent() {
  try {
    if (!vaultUnlocked && !(await verifyPin("Save requires your vault PIN."))) return;
    if (!$("siteId").value.trim()) return alert("Enter website ID before saving.");
    const savedStyle = getQuickPasswordStyle();
    const savedStrength = getMemorableStrength();
    let pw = generatedPassword;
    if (pw && (!lastGeneratedMeta || lastGeneratedMeta.style !== savedStyle || lastGeneratedMeta.strength !== savedStrength)) pw = "";
    if (!pw && isSecurityKeyEnabled() && !getSecurityKeyInputValue()) return alert("Enter your Additional Secret, or turn it off in Settings.");
    if (!pw && isGoogleSecurityFactorEnabled() && !getGoogleSubjectForGeneration()) return alert("Sign in with Google before saving this entry, or turn off Google Security Factor in Settings.");
    if (!pw && $("master").value) pw = await deterministicPassword(savedStyle, savedStrength);
    const login = $("login").value.trim();
    const settings = loadSettings();
    const siteId = $("siteId").value.trim().toLowerCase();
    const entry = {
      entryKey: "entry-" + bytesToBase64Url(crypto.getRandomValues(new Uint8Array(12))),
      siteId: settings.saveWebsiteIds ? siteId : "",
      idSaved: settings.saveWebsiteIds,
      site: $("site").value.trim().toLowerCase(),
      maskedLogin: maskText(login),
      fullLogin: $("storeFullLogin").checked ? login : "",
      fullLoginStored: $("storeFullLogin").checked,
      passwordHint: pw ? pw.slice(0, 5) : "",
      memorableStrength: getMemorableStrength(),
      length: parseInt($("length").value || "16", 10),
      counter: parseInt($("counter").value || "1", 10),
      options: {
        lower: $("lower").checked,
        upper: $("upper").checked,
        nums: $("nums").checked,
        symbols: $("symbols").checked
      },
      updated: new Date().toISOString()
    };
    const entries = await loadEntries();
    const existing = settings.saveWebsiteIds ? entries.findIndex(item => item.siteId === siteId) : -1;
    const updatedExisting = existing >= 0;
    if (updatedExisting) {
      entry.entryKey = entries[existing].entryKey || entry.entryKey;
      entries[existing] = entry;
    }
    else entries.unshift(entry);
    await saveEntries(entries);
    renderEntries();
    showResultMessage(updatedExisting ? "Updated vault entry." : "Saved to vault.", !!generatedPassword && !loadSettings().copyPasswordOnly);
  } catch (error) {
    alert("Could not save to vault: " + (error.message || error));
  }
}
async function setOrUnlockPin() {
  const pin = $("vaultPin").value.trim();
  if (!/^\d{4}$/.test(pin)) return alert("Use a 4 digit PIN.");
  const saved = await getPinRecord();
  if (!saved) {
    const confirmPin = prompt("Confirm new vault PIN:");
    if (confirmPin !== pin) return alert("PINs did not match.");
    await setPin(pin);
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(existing)) await saveEntries(existing);
    vaultUnlocked = true;
    openVault();
    return;
  }
  if (!(await checkPin(pin, saved))) return alert("Wrong PIN.");
  vaultUnlocked = true;
  openVault();
}
function openVault() {
  $("pinBox").classList.add("hidden");
  $("vaultArea").classList.remove("hidden");
  $("vaultBtn").textContent = "Lock vault";
  $("vaultPin").value = "";
  renderEntries();
}
async function showVault() {
  if (vaultUnlocked) {
    vaultUnlocked = false;
    vaultCryptoKey = null;
    $("vaultArea").classList.add("hidden");
    $("pinBox").classList.add("hidden");
    $("vaultBtn").textContent = "Show vault";
    return;
  }
  $("vaultArea").classList.add("hidden");
  $("pinBox").classList.remove("hidden");
  $("vaultBtn").textContent = "Cancel";
  $("setOrUnlockPin").textContent = await getPinRecord() ? "Unlock" : "Set PIN";
}
function applyEntry(entry) {
  $("siteId").value = entry.siteId || "";
  $("site").value = entry.site || "";
  $("login").value = entry.fullLogin || entry.maskedLogin || "";
  $("storeFullLogin").checked = !!entry.fullLoginStored;
  $("passwordStyle").value = getDefaultPasswordStyle();
  $("memorableStrength").value = MEMORABLE_STRENGTHS.includes(entry.memorableStrength) ? entry.memorableStrength : "standard";
  $("length").value = entry.length || 16;
  $("counter").value = entry.counter || 1;
  $("lower").checked = !!entry.options?.lower;
  $("upper").checked = !!entry.options?.upper;
  $("nums").checked = !!entry.options?.nums;
  $("symbols").checked = !!entry.options?.symbols;
  updatePasswordStyleUi();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
async function renderEntries() {
  if (!vaultUnlocked) return;
  const box = $("entries");
  const filter = ($("filter").value || "").toLowerCase();
  const entries = (await loadEntries()).filter(entry => (getEntryTitle(entry) + " " + entry.site + " " + getEntryLogin(entry)).toLowerCase().includes(filter));
  box.innerHTML = entries.length ? "" : '<p class="muted">No matching vault entries.</p>';
  entries.forEach(entry => {
    const div = document.createElement("div");
    div.className = "entry";
    div.innerHTML = `<div class="entry-title">${escapeHtml(getEntryTitle(entry))}</div>
      <div class="entry-line">Website ID: ${getEntryId(entry) ? escapeHtml(getEntryId(entry)) : "not saved"}</div>
      ${entry.site ? `<div class="entry-line">Site: ${escapeHtml(entry.site)}</div>` : ""}
      <div class="entry-line">Login: <span data-login>${escapeHtml(entry.maskedLogin || "not saved")}</span>${entry.fullLoginStored ? '<span class="sensitive-note">full stored</span>' : ""}</div>
      <div class="entry-line">Password hint: <span data-hint>*****</span></div>
      <div class="entry-line">Length: ${entry.length} - Counter: ${entry.counter}</div>
      <div class="entry-actions"><button data-use>Use</button><button data-show>Show hint</button><button data-copy>Copy login</button><button class="danger" data-delete>Delete</button></div>`;
    div.querySelector("[data-use]").onclick = () => applyEntry(entry);
    div.querySelector("[data-show]").onclick = async () => {
      if (await verifyPin("Enter vault PIN to reveal hint.")) div.querySelector("[data-hint]").textContent = entry.passwordHint || "not saved";
    };
    div.querySelector("[data-copy]").onclick = async () => {
      if (await verifyPin("Enter vault PIN to copy login.")) {
        try { await navigator.clipboard.writeText(entry.fullLogin || entry.maskedLogin || ""); } catch {}
      }
    };
    div.querySelector("[data-delete]").onclick = async () => {
      if (!(await verifyPin("Enter vault PIN to delete."))) return;
      await saveEntries((await loadEntries()).filter(item => getEntryKey(item) !== getEntryKey(entry)));
      renderEntries();
    };
    box.appendChild(div);
  });
}
function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}
async function exportVault() {
  if (!vaultUnlocked && !(await verifyPin("Export requires your vault PIN."))) return;
  const blob = new Blob([JSON.stringify({ version: "mobile-2", exported: new Date().toISOString(), entries: await loadEntries() }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "goblinpass-mobile-export.json";
  a.click();
  URL.revokeObjectURL(url);
}
async function importVault(file) {
  if (!vaultUnlocked && !(await verifyPin("Import requires your vault PIN."))) return;
  const data = JSON.parse(await file.text());
  const incoming = Array.isArray(data) ? data : data.entries;
  if (!Array.isArray(incoming)) throw new Error("Invalid export file.");
  await saveEntries([...incoming, ...await loadEntries()]);
  renderEntries();
}
document.addEventListener("DOMContentLoaded", () => {
  const savedTheme = loadTheme();
  applyTheme(savedTheme);
  syncThemeInputs(savedTheme);
  applySecurityKeySetting();
  updateTrustedDeviceStatus();
  updateGoogleStatus();
  $("defaultPasswordStyle").value = getDefaultPasswordStyle();
  $("passwordStyle").value = getDefaultPasswordStyle();
  $("saveWebsiteIds").checked = loadSettings().saveWebsiteIds !== false;
  $("memorableStrength").value = "standard";
  updatePasswordStyleUi();
  applyMode(localStorage.getItem(MODE_KEY) || "simple");
  $("generate").onclick = generate;
  $("save").onclick = saveCurrent;
  $("vaultBtn").onclick = showVault;
  $("setOrUnlockPin").onclick = setOrUnlockPin;
  $("filter").oninput = renderEntries;
  $("exportBtn").onclick = exportVault;
  $("importFile").onchange = async event => {
    try { if (event.target.files[0]) await importVault(event.target.files[0]); }
    catch (error) { alert(error.message); }
  };
  $("toggleGenerated").onclick = () => {
    if (loadSettings().copyPasswordOnly) return;
    generatedVisible = !generatedVisible;
    $("resultText").textContent = generatedVisible ? "Generated and copied: " + generatedPassword : "Generated and copied: " + previewPassword(generatedPassword);
    $("toggleGenerated").textContent = generatedVisible ? "Hide" : "Show";
  };
  if ($("copyGenerated")) $("copyGenerated").onclick = copyGeneratedPassword;
  $("toggleMaster").onclick = () => {
    const visible = $("master").type === "password";
    $("master").type = visible ? "text" : "password";
    $("toggleMaster").textContent = visible ? "Hide" : "Show";
  };
  $("securityKey").onclick = openSecurityInputMethod;
  $("securityKey").oninput = () => {
    if (getSecurityInputMethod() === "normal") securityKeyMemory = "";
  };
  $("passwordStyle").onchange = () => {
    clearGeneratedResult();
    updatePasswordStyleUi();
  };
  $("memorableStrength").onchange = () => {
    clearGeneratedResult();
    updatePasswordStyleUi();
  };
  $("defaultPasswordStyle").onchange = () => {
    saveSettings({ defaultPasswordStyle: $("defaultPasswordStyle").value });
    clearGeneratedResult();
    updatePasswordStyleUi();
  };
  $("saveWebsiteIds").onchange = () => {
    saveSettings({ saveWebsiteIds: $("saveWebsiteIds").checked });
  };
  $("themeEditToggle").onclick = () => $("themeEditor").classList.toggle("hidden");
  document.querySelectorAll("[data-page-target]").forEach(button => {
    button.onclick = () => {
      showPage(button.dataset.pageTarget);
    };
  });
  $("enableSecurityKey").onchange = () => {
    const enabled = $("enableSecurityKey").checked;
    const existingMethod = loadSettings().securityKeyInputMethod;
    saveSettings({
      securityKeyEnabled: enabled,
      securityKeyInputMethod: enabled ? existingMethod || getDefaultSecurityInputMethod() : $("securityKeyInputMethod").value
    });
    applySecurityKeySetting();
  };
  $("securityKeyInputMethod").onchange = () => {
    clearSecurityKey();
    saveSettings({
      securityKeyEnabled: $("enableSecurityKey").checked,
      securityKeyInputMethod: $("securityKeyInputMethod").value
    });
    applySecurityKeySetting();
  };
  $("enableTrustedDevice").onchange = () => {
    const enabled = $("enableTrustedDevice").checked;
    if (enabled) ensureTrustedDeviceKey();
    saveSettings({
      trustedDeviceEnabled: enabled,
      trustedDeviceBackedUp: loadSettings().trustedDeviceBackedUp
    });
    updateTrustedDeviceStatus();
  };
  $("showRecoveryKey").onclick = showRecoveryKey;
  $("restoreTrustedDevice").onclick = restoreTrustedDevice;
  $("copyPasswordOnly").onchange = () => {
    saveSettings({ copyPasswordOnly: $("copyPasswordOnly").checked });
    updateTrustedDeviceStatus();
  };
  $("setupGoogleSignIn").onclick = setupGoogleSignIn;
  $("googleSignOut").onclick = googleSignOut;
  $("googleSecurityFactor").onchange = () => {
    const enabled = $("googleSecurityFactor").checked;
    if (enabled) {
      const ok = confirm("If you lose access to this Google account, you may not be able to regenerate the same passwords.");
      if (!ok) {
        $("googleSecurityFactor").checked = false;
        saveSettings({ googleSecurityFactorEnabled: false });
        updateGoogleStatus();
        return;
      }
    }
    saveSettings({ googleSecurityFactorEnabled: enabled });
    updateGoogleStatus();
  };
  ["themeSiteName", "themeTagline", "themePrimary", "themeSecondary", "themeText", "themeMuted"].forEach(id => {
    $(id).addEventListener("input", updateThemeFromInputs);
  });
  document.querySelectorAll("[data-colour]").forEach(button => {
    button.onclick = () => {
      $("themePrimary").value = button.dataset.colour;
      updateThemeFromInputs();
    };
  });
  document.querySelectorAll("[data-secondary]").forEach(button => {
    button.onclick = () => {
      $("themeSecondary").value = button.dataset.secondary;
      updateThemeFromInputs();
    };
  });
  document.querySelectorAll("[data-text]").forEach(button => {
    button.onclick = () => {
      $("themeText").value = button.dataset.text;
      updateThemeFromInputs();
    };
  });
  document.querySelectorAll("[data-muted]").forEach(button => {
    button.onclick = () => {
      $("themeMuted").value = button.dataset.muted;
      updateThemeFromInputs();
    };
  });
  $("themeReset").onclick = () => {
    localStorage.removeItem(THEME_KEY);
    syncThemeInputs(DEFAULT_THEME);
    applyTheme(DEFAULT_THEME);
  };
  $("simpleMode").onclick = () => saveMode("simple");
  $("advancedMode").onclick = () => saveMode("advanced");
});