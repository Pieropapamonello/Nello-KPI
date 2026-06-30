#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Nello KPI - Bot Telegram (tutto a pulsanti)
===========================================
Stesse funzioni dell'app web (index.html):
 - login con la STESSA email/password del sito (Firebase Auth)
 - calcolo KPI = (yes - rec) / (yes + no), confronto col target
 - canali "telefono" e "chat", per mese
 - dati salvati sullo stesso Firestore (users/{uid}) -> sincronizzati col sito

Si usa SOLO con i pulsanti. L'unico testo da scrivere e':
 - email e password (una volta, al primo accesso)
 - la password admin (se vuoi diventare admin)

Variabili d'ambiente:
 - TELEGRAM_TOKEN            token del bot (da @BotFather)
 - FIREBASE_API_KEY          Web API key del progetto (default: quella di nellokpi)
 - FIREBASE_SERVICE_ACCOUNT  contenuto JSON del service account (su Render)
       oppure GOOGLE_APPLICATION_CREDENTIALS = percorso al file serviceAccount.json (locale)
 - ADMIN_PASSWORD            password per diventare admin
"""

import os
import json
import math
import asyncio
import logging
from io import BytesIO
from pathlib import Path
from datetime import datetime, timedelta

import requests
import firebase_admin
from firebase_admin import credentials, firestore

try:
    from dotenv import load_dotenv
    load_dotenv()  # carica il file .env in locale (su Render non serve)
except ImportError:
    pass

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, InputFile
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    ConversationHandler,
    filters,
)

# ------------------------------------------------------------------ config ---
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("nello-kpi-bot")

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN", "").strip()
FIREBASE_API_KEY = os.environ.get(
    "FIREBASE_API_KEY", "AIzaSyCfhxHKn73vdmhX7PwGrb8U8A4_BxMWtzs"
).strip()
# Password admin: SOLO da variabile d'ambiente (mai nel codice/GitHub)
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "").strip()

MONTHS_IT = {
    "01": "Gennaio", "02": "Febbraio", "03": "Marzo", "04": "Aprile",
    "05": "Maggio", "06": "Giugno", "07": "Luglio", "08": "Agosto",
    "09": "Settembre", "10": "Ottobre", "11": "Novembre", "12": "Dicembre",
}
CHANNELS = {"phone": "Telefono", "chat": "Chat"}
TYPE_NAMES = {"yes": "Sì", "no": "No", "rec": "Recuperati"}

# File dell'app web serviti dallo stesso servizio (whitelist: niente bot.py ecc.)
WEB_DIR = Path(__file__).resolve().parent
WEB_FILES = {
    "index.html", "style.css", "app.js",
    "nello.png", "nello_angry.png", "nello_ok.png",
}

# stati delle conversazioni (input testuali)
LOGIN_EMAIL, LOGIN_PASSWORD, ADMIN_PW = range(3)


# ----------------------------------------------------------------- firebase --
def init_firebase():
    """Inizializza firebase-admin da env var (Render) o da file (locale)."""
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if raw:
        cred = credentials.Certificate(json.loads(raw))
    else:
        path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "serviceAccount.json")
        cred = credentials.Certificate(path)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
    return firestore.client()


db = init_firebase()


def firebase_login(email: str, password: str):
    """Verifica email/password con Firebase Auth REST. Ritorna (uid, errore)."""
    url = (
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
        f"?key={FIREBASE_API_KEY}"
    )
    try:
        r = requests.post(
            url,
            json={"email": email, "password": password, "returnSecureToken": True},
            timeout=15,
        )
        data = r.json()
        if r.status_code == 200 and "localId" in data:
            return data["localId"], None
        msg = data.get("error", {}).get("message", "ERRORE")
        traduzioni = {
            "EMAIL_NOT_FOUND": "Email non trovata.",
            "INVALID_PASSWORD": "Password errata.",
            "INVALID_LOGIN_CREDENTIALS": "Email o password errate.",
            "USER_DISABLED": "Account disabilitato.",
            "INVALID_EMAIL": "Email non valida.",
        }
        return None, traduzioni.get(msg, f"Login fallito ({msg}).")
    except Exception as e:  # noqa: BLE001
        log.exception("Errore login Firebase")
        return None, f"Errore di connessione: {e}"


# --------------------------------------------------------- collegamento TG ---
def link_ref(tg_id: int):
    return db.collection("telegram_links").document(str(tg_id))


def get_link(tg_id: int):
    snap = link_ref(tg_id).get()
    return snap.to_dict() if snap.exists else None


def save_link(tg_id: int, uid: str, email: str):
    link_ref(tg_id).set(
        {"uid": uid, "email": email, "linkedAt": firestore.SERVER_TIMESTAMP},
        merge=True,
    )


def remove_link(tg_id: int):
    link_ref(tg_id).delete()


# ---------------------------------------------------------------- admin ------
def admin_ref(tg_id: int):
    return db.collection("bot_admins").document(str(tg_id))


def is_admin(tg_id: int) -> bool:
    snap = admin_ref(tg_id).get()
    return snap.exists and (snap.to_dict() or {}).get("admin") is True


def set_admin(tg_id: int, on: bool):
    if on:
        admin_ref(tg_id).set(
            {"admin": True, "since": firestore.SERVER_TIMESTAMP}, merge=True
        )
    else:
        admin_ref(tg_id).delete()


# ----------------------------------------------------- struttura dati KPI ----
def now_year():
    return str(datetime.now().year)


def now_month():
    return f"{datetime.now().month:02d}"


def default_channel():
    return {
        "target": 86,
        "overridePercent": None,
        "mode": "monthly",
        "monthly": {"yes": 0, "no": 0, "rec": 0},
        "weeks": [{"yes": 0, "no": 0, "rec": 0} for _ in range(5)],
    }


def default_month():
    return {"channels": {"phone": default_channel(), "chat": default_channel()}}


def default_year():
    return {"months": {}}


def default_data():
    y, m = now_year(), now_month()
    return {"years": {y: {"months": {m: default_month()}}}}


def ensure_path(data, year, month):
    data.setdefault("years", {})
    data["years"].setdefault(year, default_year())
    data["years"][year].setdefault("months", {})
    data["years"][year]["months"].setdefault(month, default_month())
    m = data["years"][year]["months"][month]
    m.setdefault("channels", {"phone": default_channel(), "chat": default_channel()})
    for ch in ("phone", "chat"):
        m["channels"].setdefault(ch, default_channel())
        m["channels"][ch].setdefault("monthly", {"yes": 0, "no": 0, "rec": 0})
        m["channels"][ch].setdefault("target", 86)
    return m


def sum_channel_month(ch):
    if ch.get("mode") == "weekly":
        yes = no = rec = 0
        for w in ch.get("weeks", []):
            yes += int(w.get("yes", 0) or 0)
            no += int(w.get("no", 0) or 0)
            rec += int(w.get("rec", 0) or 0)
        return yes, no, rec
    mm = ch.get("monthly", {})
    return (
        int(mm.get("yes", 0) or 0),
        int(mm.get("no", 0) or 0),
        int(mm.get("rec", 0) or 0),
    )


def ratio(yes, no, rec):
    den = yes + no
    if den <= 0:
        return None
    return (yes - rec) / den


def needed_yes(yes, no, rec, t):
    """Quanti 'si' in piu' servono per raggiungere il target t (0..1)."""
    d0 = yes + no
    n0 = yes - rec
    if d0 <= 0:
        return 0
    if (n0 / d0) >= t:
        return 0
    if t >= 1:
        return None  # impossibile
    rhs = (t * d0) - n0
    return max(0, math.ceil((rhs / (1 - t)) - 1e-12))


# ------------------------------------------------------- load/save Firestore -
def load_data(uid: str):
    snap = db.collection("users").document(uid).get()
    if snap.exists:
        d = snap.to_dict()
        if d and isinstance(d.get("data"), dict) and d["data"].get("years"):
            return d["data"]
    return default_data()


def save_data(uid: str, data: dict):
    db.collection("users").document(uid).set(
        {"schema": 1, "updatedAt": firestore.SERVER_TIMESTAMP, "data": data},
        merge=True,
    )


# =============================================================================
#  TESTI
# =============================================================================
def fmt_channel(name, ch):
    yes, no, rec = sum_channel_month(ch)
    r = ratio(yes, no, rec)
    target = float(ch.get("target", 86) or 86)
    hint = ""
    if r is None:
        pct_txt = "—"
        flag = ""
    else:
        pct = r * 100
        pct_txt = f"{pct:.2f}%"
        if pct >= target:
            flag = "✅"
        else:
            flag = "⚠️"
            ny = needed_yes(yes, no, rec, target / 100)
            if ny is None:
                hint = "\n  ⛔ target irraggiungibile così"
            elif ny > 0:
                hint = f"\n  👉 ti mancano *{ny}* sì per il target"
    return (
        f"*{name}* {flag}\n"
        f"  KPI: {pct_txt}  (target {target:g}%)\n"
        f"  sì: {yes} · no: {no} · rec: {rec}{hint}"
    )


def build_stato_text(uid: str):
    data = load_data(uid)
    y, m = now_year(), now_month()
    mobj = ensure_path(data, y, m)
    title = f"📊 *KPI {MONTHS_IT[m]} {y}*\n\n"
    body = "\n\n".join(
        fmt_channel(CHANNELS[ch], mobj["channels"][ch]) for ch in ("phone", "chat")
    )
    return title + body


def build_anno_text(uid: str):
    """Statistiche dell'anno corrente: KPI medio per canale + dettaglio mesi."""
    data = load_data(uid)
    y = now_year()
    months = (data.get("years", {}).get(y, {}) or {}).get("months", {}) or {}
    out = [f"📅 *Statistiche {y}*"]
    for ch in ("phone", "chat"):
        out.append(f"\n*{CHANNELS[ch]}*")
        ratios = []
        righe = []
        for m in sorted(months.keys()):
            chobj = (months[m].get("channels", {}) or {}).get(ch)
            if not chobj:
                continue
            yes, no, rec = sum_channel_month(chobj)
            r = ratio(yes, no, rec)
            if r is None:
                continue
            ratios.append(r)
            righe.append(f"  {MONTHS_IT[m]}: {r*100:.2f}%")
        if ratios:
            media = sum(ratios) / len(ratios) * 100
            out.append(f"  Media anno: *{media:.2f}%* ({len(ratios)} mesi)")
            out.extend(righe)
        else:
            out.append("  _nessun dato_")
    return "\n".join(out)


def build_quickadd_text(uid: str, ch: str, typ: str):
    data = load_data(uid)
    mobj = ensure_path(data, now_year(), now_month())
    chobj = mobj["channels"][ch]
    yes, no, rec = sum_channel_month(chobj)
    cur = {"yes": yes, "no": no, "rec": rec}[typ]
    r = ratio(yes, no, rec)
    pct = f"{r*100:.2f}%" if r is not None else "—"
    return (
        f"➕ *{CHANNELS[ch]} · {TYPE_NAMES[typ]}*\n\n"
        f"Valore attuale: *{cur}*\n"
        f"KPI del mese: {pct}\n\n"
        f"Tocca i pulsanti per aggiungere o togliere:"
    )


def build_utenti_text():
    try:
        links = list(db.collection("telegram_links").stream())
    except Exception:  # noqa: BLE001
        return "Errore nel leggere gli utenti."
    if not links:
        return "Nessun utente collegato al bot."
    y, m = now_year(), now_month()
    righe = [f"👥 *Utenti collegati* – KPI {MONTHS_IT[m]} {y}\n"]
    for snap in links:
        d = snap.to_dict() or {}
        uid = d.get("uid")
        email = d.get("email", "?")
        if not uid:
            continue
        data = load_data(uid)
        mobj = ensure_path(data, y, m)
        parti = []
        for ch in ("phone", "chat"):
            yes, no, rec = sum_channel_month(mobj["channels"][ch])
            r = ratio(yes, no, rec)
            parti.append(
                f"{CHANNELS[ch]}: {r*100:.1f}%" if r is not None else f"{CHANNELS[ch]}: —"
            )
        righe.append(f"• `{email}`\n   " + " · ".join(parti))
    return "\n".join(righe)


# =============================================================================
#  TASTIERE (tutti i pulsanti)
# =============================================================================
def welcome_markup():
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("🔐 Accedi", callback_data="login")]]
    )


def main_menu(tg_id: int):
    link = get_link(tg_id) or {}
    notify_on = link.get("notify", True)
    kb = [
        [
            InlineKeyboardButton("📊 Stato KPI", callback_data="stato"),
            InlineKeyboardButton("📅 Anno", callback_data="anno"),
        ],
        [
            InlineKeyboardButton("➕ Telefono", callback_data="addmenu:phone"),
            InlineKeyboardButton("➕ Chat", callback_data="addmenu:chat"),
        ],
        [
            InlineKeyboardButton("🎯 Target tel.", callback_data="tgtmenu:phone"),
            InlineKeyboardButton("🎯 Target chat", callback_data="tgtmenu:chat"),
        ],
        [
            InlineKeyboardButton(
                "🔕 Disattiva avvisi" if notify_on else "🔔 Attiva avvisi",
                callback_data="notif:" + ("off" if notify_on else "on"),
            ),
            InlineKeyboardButton("📥 Esporta dati", callback_data="export"),
        ],
    ]
    if is_admin(tg_id):
        kb.append([InlineKeyboardButton("👥 Utenti (admin)", callback_data="utenti")])
    else:
        kb.append([InlineKeyboardButton("🛡️ Diventa admin", callback_data="admin")])
    kb.append([InlineKeyboardButton("🚪 Esci", callback_data="logout")])
    return InlineKeyboardMarkup(kb)


def back_menu_row():
    return [InlineKeyboardButton("🏠 Menu", callback_data="menu")]


def addtype_markup(ch: str):
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("✅ Sì", callback_data=f"addt:{ch}:yes"),
                InlineKeyboardButton("❌ No", callback_data=f"addt:{ch}:no"),
                InlineKeyboardButton("♻️ Rec", callback_data=f"addt:{ch}:rec"),
            ],
            back_menu_row(),
        ]
    )


def quickadd_markup(ch: str, typ: str):
    def inc(n, label):
        return InlineKeyboardButton(label, callback_data=f"inc:{ch}:{typ}:{n}")

    return InlineKeyboardMarkup(
        [
            [inc(1, "➕1"), inc(5, "➕5"), inc(10, "➕10")],
            [inc(20, "➕20"), inc(50, "➕50"), inc(100, "➕100")],
            [inc(-1, "➖1"), inc(-5, "➖5"), inc(-10, "➖10")],
            [
                InlineKeyboardButton("⬅️ Indietro", callback_data=f"addmenu:{ch}"),
                InlineKeyboardButton("🏠 Menu", callback_data="menu"),
            ],
        ]
    )


def target_markup(ch: str):
    vals = [80, 82, 85, 86, 88, 90, 92, 95]
    rows, row = [], []
    for v in vals:
        row.append(InlineKeyboardButton(f"{v}%", callback_data=f"tgtset:{ch}:{v}"))
        if len(row) == 3:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append(back_menu_row())
    return InlineKeyboardMarkup(rows)


def start_screen(tg_id: int):
    link = get_link(tg_id)
    if link:
        text = (
            "🏠 *Nello KPI*\n"
            f"Account: `{link['email']}`\n\n"
            "Usa i pulsanti qui sotto 👇"
        )
        return text, main_menu(tg_id)
    text = (
        "👋 *Nello KPI – Bot*\n\n"
        "Calcola e aggiorna i tuoi KPI, in sincronia con l'app web.\n\n"
        "Premi *Accedi* per iniziare."
    )
    return text, welcome_markup()


# =============================================================================
#  COMANDI BASE (solo /start, per avviare)
# =============================================================================
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text, markup = start_screen(update.effective_user.id)
    await update.message.reply_text(text, reply_markup=markup, parse_mode="Markdown")


async def cmd_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text, markup = start_screen(update.effective_user.id)
    await update.message.reply_text(text, reply_markup=markup, parse_mode="Markdown")


# =============================================================================
#  LOGIN (testo: email + password)
# =============================================================================
async def login_email(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["login_email"] = update.message.text.strip()
    await update.message.reply_text(
        "🔑 Ora scrivi la tua *password*.\n"
        "_(la cancellerò subito dalla chat per sicurezza)_",
        parse_mode="Markdown",
    )
    return LOGIN_PASSWORD


async def login_password(update: Update, context: ContextTypes.DEFAULT_TYPE):
    email = context.user_data.get("login_email", "")
    password = update.message.text.strip()
    tg_id = update.effective_user.id
    chat_id = update.effective_chat.id
    try:
        await update.message.delete()  # togli la password dalla chat
    except Exception:  # noqa: BLE001
        pass

    uid, err = firebase_login(email, password)
    if err:
        await context.bot.send_message(
            chat_id, f"❌ {err}", reply_markup=welcome_markup()
        )
        return ConversationHandler.END

    save_link(tg_id, uid, email)
    context.user_data.pop("login_email", None)
    await context.bot.send_message(
        chat_id,
        f"✅ Accesso eseguito come `{email}`!",
        reply_markup=main_menu(tg_id),
        parse_mode="Markdown",
    )
    return ConversationHandler.END


# =============================================================================
#  ADMIN (testo: password)
# =============================================================================
async def admin_password(update: Update, context: ContextTypes.DEFAULT_TYPE):
    pw = update.message.text.strip()
    tg_id = update.effective_user.id
    chat_id = update.effective_chat.id
    try:
        await update.message.delete()
    except Exception:  # noqa: BLE001
        pass

    if pw == ADMIN_PASSWORD:
        set_admin(tg_id, True)
        await context.bot.send_message(
            chat_id, "🛡️ Sei ora *admin*!", reply_markup=main_menu(tg_id),
            parse_mode="Markdown",
        )
    else:
        await context.bot.send_message(
            chat_id, "❌ Password errata.", reply_markup=main_menu(tg_id)
        )
    return ConversationHandler.END


# =============================================================================
#  ROUTER DEI PULSANTI
# =============================================================================
async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    tg_id = q.from_user.id
    data = q.data

    # --- azioni che NON richiedono login ---
    if data == "login":
        if get_link(tg_id):
            await q.edit_message_text(
                "Sei già connesso.", reply_markup=main_menu(tg_id)
            )
            return ConversationHandler.END
        await q.edit_message_text("📧 Scrivi la tua *email*:", parse_mode="Markdown")
        return LOGIN_EMAIL

    if data == "menu" or data == "home":
        text, markup = start_screen(tg_id)
        await q.edit_message_text(text, reply_markup=markup, parse_mode="Markdown")
        return ConversationHandler.END

    # --- da qui serve essere loggati ---
    link = get_link(tg_id)
    if not link:
        text, markup = start_screen(tg_id)
        await q.edit_message_text(text, reply_markup=markup, parse_mode="Markdown")
        return ConversationHandler.END
    uid = link["uid"]

    if data == "stato":
        await q.edit_message_text(
            build_stato_text(uid), parse_mode="Markdown", reply_markup=main_menu(tg_id)
        )
        return ConversationHandler.END

    if data == "anno":
        await q.edit_message_text(
            build_anno_text(uid), parse_mode="Markdown", reply_markup=main_menu(tg_id)
        )
        return ConversationHandler.END

    if data == "logout":
        remove_link(tg_id)
        await q.edit_message_text(
            "👋 Disconnesso.", reply_markup=welcome_markup()
        )
        return ConversationHandler.END

    if data == "export":
        full = load_data(uid)
        blob = json.dumps(full, ensure_ascii=False, indent=2).encode("utf-8")
        fname = f"nello_kpi_{link.get('email', 'backup').split('@')[0]}_{now_year()}-{now_month()}.json"
        bio = BytesIO(blob)
        bio.name = fname
        await context.bot.send_document(
            tg_id,
            document=InputFile(bio, filename=fname),
            caption="📥 Backup completo dei tuoi dati KPI (JSON).",
        )
        await q.answer("Backup inviato!")
        return ConversationHandler.END

    if data.startswith("notif:"):
        on = data.endswith("on")
        link_ref(tg_id).set({"notify": on}, merge=True)
        nota = "🔔 Avvisi settimanali attivati." if on else "🔕 Avvisi disattivati."
        await q.edit_message_text(
            nota + "\n\n" + start_screen(tg_id)[0],
            reply_markup=main_menu(tg_id),
            parse_mode="Markdown",
        )
        return ConversationHandler.END

    if data == "admin":
        if not ADMIN_PASSWORD:
            await q.answer("Admin non configurato sul server.", show_alert=True)
            return ConversationHandler.END
        await q.edit_message_text(
            "🛡️ Scrivi la *password admin*:\n_(verrà cancellata subito)_",
            parse_mode="Markdown",
        )
        return ADMIN_PW

    if data == "utenti":
        if not is_admin(tg_id):
            await q.answer("Solo admin.", show_alert=True)
            return ConversationHandler.END
        testo = build_utenti_text()
        await q.edit_message_text(
            testo[:3900], parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([back_menu_row()]),
        )
        return ConversationHandler.END

    if data.startswith("addmenu:"):
        ch = data.split(":", 1)[1]
        await q.edit_message_text(
            f"➕ *{CHANNELS[ch]}* – cosa vuoi conteggiare?",
            parse_mode="Markdown", reply_markup=addtype_markup(ch),
        )
        return ConversationHandler.END

    if data.startswith("addt:"):
        _, ch, typ = data.split(":")
        await q.edit_message_text(
            build_quickadd_text(uid, ch, typ),
            parse_mode="Markdown", reply_markup=quickadd_markup(ch, typ),
        )
        return ConversationHandler.END

    if data.startswith("inc:"):
        _, ch, typ, delta = data.split(":")
        data_obj = load_data(uid)
        mobj = ensure_path(data_obj, now_year(), now_month())
        chobj = mobj["channels"][ch]
        chobj.setdefault("monthly", {"yes": 0, "no": 0, "rec": 0})
        chobj["monthly"][typ] = max(0, int(chobj["monthly"].get(typ, 0)) + int(delta))
        save_data(uid, data_obj)
        await q.edit_message_text(
            build_quickadd_text(uid, ch, typ),
            parse_mode="Markdown", reply_markup=quickadd_markup(ch, typ),
        )
        return ConversationHandler.END

    if data.startswith("tgtmenu:"):
        ch = data.split(":", 1)[1]
        cur = ensure_path(load_data(uid), now_year(), now_month())["channels"][ch].get("target", 86)
        await q.edit_message_text(
            f"🎯 *Target {CHANNELS[ch]}*\nAttuale: {float(cur):g}%\n\nScegli il nuovo target:",
            parse_mode="Markdown", reply_markup=target_markup(ch),
        )
        return ConversationHandler.END

    if data.startswith("tgtset:"):
        _, ch, val = data.split(":")
        data_obj = load_data(uid)
        mobj = ensure_path(data_obj, now_year(), now_month())
        mobj["channels"][ch]["target"] = float(val)
        save_data(uid, data_obj)
        await q.edit_message_text(
            f"🎯 Target {CHANNELS[ch]} = {val}%\n\n" + build_stato_text(uid),
            parse_mode="Markdown", reply_markup=main_menu(tg_id),
        )
        return ConversationHandler.END

    return ConversationHandler.END


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text, markup = start_screen(update.effective_user.id)
    await update.message.reply_text(text, reply_markup=markup, parse_mode="Markdown")
    return ConversationHandler.END


# =============================================================================
#  NOTIFICA SETTIMANALE
# =============================================================================
async def weekly_notify(context: ContextTypes.DEFAULT_TYPE):
    """Job settimanale: manda a ogni utente collegato il KPI del mese."""
    try:
        links = db.collection("telegram_links").stream()
    except Exception:  # noqa: BLE001
        log.exception("weekly_notify: lettura links fallita")
        return
    for snap in links:
        d = snap.to_dict() or {}
        if d.get("notify", True) is False:
            continue
        uid = d.get("uid")
        if not uid:
            continue
        try:
            testo = "🔔 *Promemoria settimanale*\n\n" + build_stato_text(uid)
            await context.bot.send_message(int(snap.id), testo, parse_mode="Markdown")
        except Exception:  # noqa: BLE001
            log.warning("Notifica non inviata a %s", snap.id)


def next_friday_18():
    """Prossimo venerdì alle 18:00 (server time)."""
    now = datetime.now()
    days_ahead = (4 - now.weekday()) % 7  # weekday(): lun=0 ... ven=4
    target = now.replace(hour=18, minute=0, second=0, microsecond=0) + timedelta(
        days=days_ahead
    )
    if target <= now:
        target += timedelta(days=7)
    return target


# ------------------------------------------------------------------- main ----
async def post_init(app: Application):
    # mostra solo il pulsante "menu" di Telegram con /start
    await app.bot.set_my_commands([("start", "Avvia il bot / apri il menu")])


def main():
    if not TELEGRAM_TOKEN:
        raise SystemExit("Manca la variabile d'ambiente TELEGRAM_TOKEN")

    app = Application.builder().token(TELEGRAM_TOKEN).post_init(post_init).build()

    # tutta l'interazione passa da qui: pulsanti + i pochi input testuali
    nav = CallbackQueryHandler(on_callback)
    conv = ConversationHandler(
        entry_points=[CommandHandler("start", cmd_start), nav],
        states={
            LOGIN_EMAIL: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, login_email),
                nav,
            ],
            LOGIN_PASSWORD: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, login_password),
                nav,
            ],
            ADMIN_PW: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, admin_password),
                nav,
            ],
        },
        fallbacks=[CommandHandler("start", cmd_start), CommandHandler("menu", cmd_menu)],
        allow_reentry=True,
        per_message=False,
    )

    app.add_handler(conv)
    app.add_handler(CommandHandler("menu", cmd_menu))

    # notifica settimanale: ogni venerdì alle 18:00 (ora del server)
    if app.job_queue:
        app.job_queue.run_repeating(
            weekly_notify, interval=timedelta(weeks=1), first=next_friday_18()
        )

    # Su Render (web service) c'è RENDER_EXTERNAL_URL -> modalità webhook.
    # In locale non c'è -> modalità polling.
    base_url = (
        os.environ.get("RENDER_EXTERNAL_URL")
        or os.environ.get("WEBHOOK_URL", "")
    ).strip()

    if base_url:
        port = int(os.environ.get("PORT", "10000"))
        path = os.environ.get("WEBHOOK_PATH", "tg")
        secret = os.environ.get("WEBHOOK_SECRET", "").strip() or None
        webhook_url = f"{base_url.rstrip('/')}/{path}"
        log.info("Bot avviato in WEBHOOK (+ app web) su %s.", webhook_url)
        asyncio.run(run_combined(app, port, path, secret, webhook_url))
    else:
        log.info("Bot avviato in POLLING (locale).")
        app.run_polling(allowed_updates=Update.ALL_TYPES)


def build_web_app(application, path, secret):
    """Costruisce il server HTTP: webhook del bot + file dell'app web."""
    from aiohttp import web

    async def tg_handler(request):
        if secret and request.headers.get("X-Telegram-Bot-Api-Secret-Token") != secret:
            return web.Response(status=403)
        try:
            data = await request.json()
        except Exception:  # noqa: BLE001
            return web.Response(status=400)
        await application.update_queue.put(Update.de_json(data, application.bot))
        return web.Response()

    async def serve_index(request):
        return web.FileResponse(WEB_DIR / "index.html")

    async def serve_file(request):
        name = request.match_info.get("name", "")
        if name in WEB_FILES and (WEB_DIR / name).exists():
            return web.FileResponse(WEB_DIR / name)
        return web.Response(status=404, text="Not found")

    web_app = web.Application()
    web_app.router.add_post("/" + path, tg_handler)          # webhook del bot
    web_app.router.add_get("/", serve_index)                 # app web
    web_app.router.add_get("/healthz", lambda r: web.Response(text="ok"))
    web_app.router.add_get("/{name}", serve_file)            # css/js/immagini
    return web_app


async def run_combined(app, port, path, secret, webhook_url):
    """Un solo Web Service: serve l'app web E gestisce il webhook del bot."""
    from aiohttp import web

    await app.initialize()
    await app.start()
    try:
        await app.bot.set_webhook(
            url=webhook_url,
            secret_token=secret,
            allowed_updates=Update.ALL_TYPES,
            drop_pending_updates=True,
        )
        log.info("Webhook impostato su %s", webhook_url)
    except Exception:  # noqa: BLE001
        log.exception("set_webhook fallito")

    runner = web.AppRunner(build_web_app(app, path, secret))
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    log.info("App web + bot attivi sulla porta %s", port)
    await asyncio.Event().wait()


if __name__ == "__main__":
    main()
