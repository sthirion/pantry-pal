# WireMock stubs for the frontend

Run WireMock with this folder as its root (default port 8080), then `npm run dev` in the
frontend; Vite proxies `/api` to it (`API_PROXY_TARGET` overrides the target).

```powershell
docker run --rm -p 8080:8080 -v "${PWD}/wiremock:/home/wiremock" wiremock/wiremock
```

The `session` scenario keeps state: it starts signed out (`/api/me` -> 401), a successful
sign-in makes `/api/me` return 200, and sign-out resets it. Reset with `POST /__admin/scenarios/reset`.

| Scenario                  | How to trigger                                         |
| ------------------------- | ------------------------------------------------------ |
| Signed out -> sign-in     | Open any page after a fresh start or sign-out          |
| Sign-in success           | Any credentials                                        |
| Wrong credentials (401)   | Password `wrong-password`                              |
| Rate limited (429)        | Email `limited@example.com`                            |
| Unexpected status (500)   | Email `broken@example.com`                             |
| Session check fails (500) | Rename `auth-stubs.me-error.json.bak` to `.json`       |
| Sign-out fails (500)      | Rename `auth-stubs.sign-out-error.json.bak` to `.json` |
