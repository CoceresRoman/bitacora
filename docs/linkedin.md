# LinkedIn setup

Bitacora publishes drafts to LinkedIn on your behalf, but every post is gated
by human approval before it goes out. Before that can work, you need a
LinkedIn developer app and a one-time OAuth connection from the running
service. This is a manual, first-time setup — there is no unattended way to
do it, because LinkedIn's consent screen requires a logged-in browser.

## 1. Create the LinkedIn app

1. Go to <https://www.linkedin.com/developers/apps> and create a new app.
2. You'll need to associate it with a LinkedIn Company Page you administer
   (LinkedIn requires this even for apps that only post as a personal
   profile).
3. Under the app's **Products** tab, request access to:
   - **Sign In with LinkedIn using OpenID Connect** — grants `openid` and
     `profile`, used to resolve the member URN after the token exchange.
   - **Share on LinkedIn** — grants `w_member_social`, used to publish posts.

   Both are self-service and are typically approved instantly, but LinkedIn
   can take a few minutes to propagate the grant to the app's scopes.

4. Under **Auth**, note the **Client ID** and **Client Secret** — these map
   to `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` in `.env`.

## 2. Configure the redirect URL

In the app's **Auth** tab, add an **Authorized redirect URL for your app**:

```
http://localhost:3000/auth/linkedin/callback
```

Adjust the host/port if the service runs somewhere other than
`localhost:3000`. This exact value must also be set as
`LINKEDIN_REDIRECT_URI` in `.env` — LinkedIn rejects the callback if the two
don't match byte-for-byte.

## 3. Set the remaining environment variables

```
LINKEDIN_CLIENT_ID=<from the Auth tab>
LINKEDIN_CLIENT_SECRET=<from the Auth tab>
LINKEDIN_REDIRECT_URI=http://localhost:3000/auth/linkedin/callback
LINKEDIN_API_VERSION=<a 6-digit LinkedIn API version, e.g. 202408>
ENCRYPTION_KEY=<64 hex chars, e.g. `openssl rand -hex 32`>
```

`ENCRYPTION_KEY` is the AES-256-GCM key used to encrypt the access token at
rest (see `src/publisher/crypto.ts`). Generate it once and keep it stable —
rotating it invalidates any stored token and forces reconnection.

## 4. Connect the account

1. Start the service (`npm run start:dev` or equivalent).
2. Open `http://localhost:3000/auth/linkedin` in a browser where you're
   logged into the LinkedIn account that should own the posts.
3. Approve the consent screen. LinkedIn redirects back to
   `/auth/linkedin/callback`, which exchanges the authorization code for an
   access token, resolves the member's URN via `/v2/userinfo`, and stores
   the token encrypted in the `LinkedInToken` table.
4. On success the browser shows `LinkedIn connected. You can close this
   tab.`

To confirm the row landed and that the token is not stored in plaintext:

```bash
sqlite3 data/bitacora.db 'select memberUrn, expiresAt from LinkedInToken;'
```

`encryptedAccessToken` should be unreadable ciphertext
(`<ivHex>:<tagHex>:<cipherHex>`), never the raw token.

## 5. Token expiry and re-connection

LinkedIn access tokens obtained through this flow are short-lived (LinkedIn's
default is 60 days). `TokenStore.needsReauth(now)` returns `true` once the
stored token is within `REAUTH_WARNING_DAYS` (5) of expiring, or if no token
exists at all. The publishing cycle is expected to check this and warn via
Telegram before the token actually expires, so re-connecting is a deliberate
action rather than a surprise outage.

To re-connect, just repeat step 4 — `TokenStore.save()` upserts the singleton
row, so there is never more than one stored token.

### Open item: does the token response include a `refresh_token`?

**Unconfirmed — verify on the first real connection.** LinkedIn's OpenID
Connect token endpoint does not document a refresh token for the 3-legged
member auth flow used here, and the `Sign In with LinkedIn using OpenID
Connect` product historically does not return one. If it turns out the
`/oauth/v2/accessToken` response *does* include `refresh_token` for this app
configuration, that opens the door to automating renewal before the 60-day
expiry (silently exchanging the refresh token instead of asking a human to
click through the consent screen again).

If it does not — which is the expected case — the `REAUTH_WARNING_DAYS`
Telegram warning at day 55 is the permanent, intended answer: a human
re-authorizes by visiting `/auth/linkedin` again. Update this section with
the confirmed answer the first time someone completes step 4 against a real
LinkedIn app, and log whether `refresh_token` was present in the raw token
response (without logging the token value itself).
