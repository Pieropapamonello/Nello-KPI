# Nello KPI

Web app installabile e bot Telegram per calcolare e monitorare KPI mensili e settimanali. I dati vengono salvati localmente e, dopo il login, sincronizzati con Firebase.

## Funzioni principali

- Inserimento rapido per Telefono e Messaggistica
- KPI, obiettivo, recuperi necessari e ritmo settimanale consigliato
- Dashboard con filtri, confronto con l'anno precedente e grafico 3/6/12 mesi
- Storico modificabile e previsione del trend
- PWA installabile con supporto offline
- Bot Telegram collegato allo stesso database

## Avvio locale

```powershell
python -m http.server 8765
```

Aprire `http://localhost:8765`.

## Controlli qualità

```powershell
node tests/kpi-core.test.js
node tests/security-check.js
node --check app.js
node --check sw.js
python -m py_compile bot.py
```

Gli stessi controlli vengono eseguiti automaticamente da GitHub Actions.

## Sicurezza

Non committare mai `.env`, `serviceAccount.json`, token Telegram, token GitHub o chiavi private. I file sensibili sono esclusi da `.gitignore` e la pipeline controlla i file tracciati alla ricerca dei principali formati di segreto.

Per configurazione e deploy del bot vedere [README_BOT.md](README_BOT.md).
