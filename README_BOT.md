# 🤖 Nello KPI – Bot Telegram

Bot Telegram con le stesse funzioni dell'app web (`index.html`).
Usa lo **stesso database Firebase** (`nellokpi`): i dati che modifichi dal bot
si vedono anche sul sito, e viceversa.

## Come si usa: TUTTO A PULSANTI 🎛️
Scrivi **una sola volta** `/start`: da lì in poi usi solo i pulsanti.
L'unico testo da digitare è **email + password** al primo accesso (e la
password admin, se vuoi diventare admin).

Pulsanti disponibili dopo il login:
- **📊 Stato KPI** – KPI del mese per Telefono e Chat (+ quanti "sì" mancano al target)
- **📅 Anno** – statistiche dell'anno: media KPI e dettaglio mese per mese
- **➕ Telefono / ➕ Chat** – aggiungi conteggi con i tasti rapidi (➕1 ➕5 ➕10 ➕20 …, ➖ per togliere)
- **🎯 Target tel. / chat** – scegli il target da una lista (80% … 95%)
- **🔔 / 🔕 Avvisi** – attiva/disattiva il promemoria del venerdì
- **🛡️ Diventa admin** / **👥 Utenti** – funzioni admin (vedi sotto)
- **🚪 Esci** – logout

Formula KPI: `(sì − rec) / (sì + no)`, confrontata col target (default 86%).

> Le **regole di sicurezza** del database sono in `firestore.rules`:
> applicale da Firebase Console → Firestore → Regole → incolla → Pubblica.

### Funzioni admin (anche queste a pulsanti)
- **🛡️ Diventa admin** – ti chiede la password (cancellata subito dalla chat).
  La password sta nella variabile d'ambiente `ADMIN_PASSWORD`, mai nel codice.
- **👥 Utenti** – appare al posto del pulsante admin una volta autenticato:
  mostra tutti gli utenti collegati col loro KPI del mese.

La password admin si imposta:
- in **locale**: nel file `.env` (già escluso da Git)
- su **Render**: variabile d'ambiente `ADMIN_PASSWORD` nel pannello

---

## 1) Prima cosa: il service account Firebase
Il bot, essendo un programma server, ha bisogno di una "chiave di servizio".

1. Vai su [console.firebase.google.com](https://console.firebase.google.com) → progetto **nellokpi**
2. ⚙️ (rotellina) → **Impostazioni progetto** → scheda **Account di servizio**
3. Pulsante **Genera nuova chiave privata** → scarica il file JSON
4. Rinominalo `serviceAccount.json` e mettilo in questa cartella (per il test in locale)

> ⚠️ Questo file è un SEGRETO totale. È già escluso dal `.gitignore`: non finirà su GitHub.

---

## 2) Provarlo sul tuo PC (Windows)

```powershell
# installa le librerie
pip install -r requirements.txt

# imposta il token del bot (RIGENERATO da @BotFather!)
$env:TELEGRAM_TOKEN = "il_tuo_token_nuovo"
$env:GOOGLE_APPLICATION_CREDENTIALS = "serviceAccount.json"

# avvia
python bot.py
```

Poi su Telegram cerca il tuo bot e scrivi `/start`.

---

## 3) Metterlo su Render (sempre attivo)

1. Carica il progetto su GitHub (senza `serviceAccount.json` e senza `.env`!)
2. Su Render: **New** → **Background Worker** → collega il repo
3. Build command: `pip install -r requirements.txt`
4. Start command: `python bot.py`
5. In **Environment** aggiungi:
   - `TELEGRAM_TOKEN` = token nuovo del bot
   - `FIREBASE_SERVICE_ACCOUNT` = **tutto il contenuto** del file `serviceAccount.json`
     (aprilo con un editor, copia tutto, incolla come valore)
   - `FIREBASE_API_KEY` = `AIzaSyCfhxHKn73vdmhX7PwGrb8U8A4_BxMWtzs`
6. Deploy. Il bot parte da solo.

> In alternativa c'è già `render.yaml`: Render può usarlo come "Blueprint".

---

## ⚠️ Sicurezza – leggi
Hai condiviso in chat il token del bot, una API key di Render e un token GitHub.
**Rigenerali tutti** prima di usarli:
- Telegram: `@BotFather` → `/revoke`
- Render: Account Settings → API Keys → revoca
- GitHub: Settings → Developer settings → Personal access tokens → revoca

I segreti vanno SOLO nelle variabili d'ambiente, mai nel codice o su GitHub.
