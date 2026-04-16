/**
 * Fase 3.1: Holy-IOT hardware constants.
 *
 * These constants describe the physical Holy-IOT beacon units we use for
 * end-to-end BLE testing. They are intentionally hard-coded in ONE place
 * so that a firmware/app refactor can update them without hunting through
 * seed scripts, UI strings, and docs.
 *
 * DEFAULT_HOLYIOT_PASSWORD is the factory configuration-access password
 * baked into this model of Holy-IOT beacon. Anyone holding the device can
 * use it together with the official Holy-IOT Android app ("Beacon Setting"
 * or similar) to change the iBeacon UUID / major / minor / TX power /
 * advertising interval over a local BLE GATT connection.
 *
 * This is NOT a secret — it's a factory default printed on the product
 * documentation and identical across every unit of this model. It is
 * stored here only so that the admin-web and sales-agent apps can show it
 * in the reconfigure modal as a helper (so the tenant admin / sales rep
 * doesn't have to remember it when they walk up to a beacon in the field).
 *
 * If a future generation of Holy-IOT hardware arrives with a different
 * default, update this constant and every consumer will pick it up.
 */
export const DEFAULT_HOLYIOT_PASSWORD = 'aa14061112.'

/**
 * Human-readable label shown next to the password in UIs.
 */
export const DEFAULT_HOLYIOT_PASSWORD_LABEL = 'Password di fabbrica Holy-IOT'
