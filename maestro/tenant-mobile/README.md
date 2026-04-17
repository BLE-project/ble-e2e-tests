# tenant-mobile Maestro flows

## Active flows (3)

- **`login.yaml`** — email+password login + BUG-003 navigation verification.
- **`navigation.yaml`** — full bottom tab navigation (Home / Territories / Beacons / Theme / Settings / Report).
- **`beacons.yaml`** — beacon list screen + create modal.

## Disabled flow (S56)

- **`logout.yaml.disabled`** — KI-S56-01 app-level bug. After tapping
  "Sign out", tenant-mobile throws a React Native runtime error
  (`addViewAt: failed to insert view into parent`) because the auth
  provider unmounts Settings while a Fabric mount batch is still
  pending. Dismissing the red-screen (via the DISMISS button) leaves
  the app on an empty dark surface without the login form rendering.
  Deferred to an app-side fix (not a Maestro-side workaround).
  Re-enable by renaming back to `logout.yaml` once the unmount race
  is resolved in `terrio-tenant-mobile/app/_layout.tsx`.
