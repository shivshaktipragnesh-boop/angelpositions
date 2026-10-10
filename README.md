# Angel One positions & orders for Meta Ray-Ban Display

Read-only viewer. A Vercel serverless function (`api/data.js`) logs in to Angel One SmartAPI
(auto-generates the TOTP), and a black, large-text page (`public/index.html`) shows:

1. Total P&L summary
2. Positions (4 per page)
3. Orders (4 per page, coloured by status)

Navigate by swipe, tap left/right half, or arrow keys. Auto-refreshes every 30 s.
There is no code that places, modifies or cancels orders.

## Setup

1. Create a SmartAPI app at https://smartapi.angelone.in and note the **API key**.
2. Enable TOTP at https://smartapi.angelone.in/enable-totp and copy the **base32 secret** shown beside the QR code.
3. Deploy:
   ```
   npm i -g vercel
   cd angel-glasses
   vercel
   ```
4. In Vercel → Project → Settings → Environment Variables add the values from `.env.example`
   (`ANGEL_API_KEY`, `ANGEL_CLIENT_CODE`, `ANGEL_PIN`, `ANGEL_TOTP_SECRET`, `APP_KEY`), then `vercel --prod`.
5. On the glasses (or phone first to test), open `https://<your-app>.vercel.app/?key=<APP_KEY>` once.
   The key is saved on the device and stripped from the URL.

## Notes

- Anyone with the URL **and** `APP_KEY` can see your positions. Use a long random `APP_KEY`; rotate it in Vercel if it leaks.
- Your PIN and TOTP secret sit in Vercel env vars, so use a dedicated SmartAPI app and don't commit `.env`.
- Angel One may require registered static IPs for some API calls. If you get an IP-related error,
  you'll need a fixed outbound IP (e.g. a small VPS proxy) registered in your SmartAPI app.
- To test locally: `vercel dev`, then open `http://localhost:3000/?key=<APP_KEY>`.
