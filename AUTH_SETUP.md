# RHM Studios Google sign-in setup

The application code is prepared for Supabase Auth with Google OAuth and secure cookie sessions. Complete these owner-only dashboard steps before the first login.

## 1. Add your administrator email locally

Open the private `.env` file and add the Google email address you will use:

```env
RHM_ADMIN_EMAILS=your-google-email@example.com
APP_URL=http://localhost:4173
PORT=4173
```

For multiple administrators, separate addresses with commas. Never put this list in browser code.

## 2. Create the Google OAuth client

1. Open Google Auth Platform in Google Cloud Console.
2. Create or select a Google Cloud project.
3. Configure the OAuth consent screen/branding as **RHM Studios**.
4. Add the `openid`, email, and profile scopes.
5. Create an OAuth client with application type **Web application**.
6. Add `http://localhost:4173` as an authorized JavaScript origin.
7. Copy the Supabase callback URL shown on the Supabase Google provider page into Google’s authorized redirect URIs.
8. Save the Google Client ID and Client Secret.

## 3. Enable Google in Supabase

1. Open the RHM Supabase project.
2. Go to Authentication → Providers → Google.
3. Enable Google.
4. Paste the Google Client ID and Client Secret.
5. Save.
6. Under Authentication → URL Configuration, set the Site URL to `http://localhost:4173`.
7. Add `http://localhost:4173/auth/callback` to the redirect allow list.

## 4. Apply database migrations

Apply migrations `202607190001` through `202607190004` in order. The fourth migration adds the `admin`, `creator`, and `reviewer` roles and administrator access policies.

## 5. Install and run

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:4173/signin` and choose **Continue with Google**.

## Security behavior

- Google credentials never pass through RHM Studios.
- The server exchanges the OAuth code and stores the Supabase session in cookies.
- The server matches the verified Google email against `RHM_ADMIN_EMAILS`.
- An administrator can access all RHM data; other users remain limited by row-level security.
- Removing an email from the allowlist affects its assigned role on the next successful login. For immediate removal, also update the profile role in Supabase and revoke the user session.
