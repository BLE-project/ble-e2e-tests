#!/usr/bin/env python3
"""
BLE beacon discovery script — scans for iBeacons and prints a JSON summary.

Usage:
  python scripts/beacon-discover.py [--duration 10]

Output: JSON list of detected beacons with {mac, uuid, major, minor, rssi, measured_power, distance_m, zone}.

Used by the production-prep verification flow to discover the current state
of physical Holy-IOT beacons without hardcoded UUID/Major/Minor assumptions.
"""
import asyncio
import json
import math
import sys
from bleak import BleakScanner

APPLE_IBEACON_CID = 0x004C


def classify_zone(distance_m: float) -> str:
    if distance_m < 0.5:
        return "IMMEDIATE"
    if distance_m < 3.0:
        return "NEAR"
    return "FAR"


def estimate_distance(rssi: int, measured_power: int) -> float:
    """Log-distance path loss model (n=2)."""
    if rssi == 0 or measured_power == 0:
        return -1.0
    ratio = (measured_power - rssi) / 20.0
    return round(10 ** ratio, 2)


async def scan(duration: float = 10.0):
    results = {}  # dedupe by MAC
    def detection_callback(device, adv):
        md = adv.manufacturer_data or {}
        if APPLE_IBEACON_CID not in md:
            return
        data = md[APPLE_IBEACON_CID]
        if len(data) < 23 or data[0] != 2 or data[1] != 0x15:
            return
        uuid = (
            data[2:6].hex()
            + "-"
            + data[6:8].hex()
            + "-"
            + data[8:10].hex()
            + "-"
            + data[10:12].hex()
            + "-"
            + data[12:18].hex()
        ).upper()
        major = int.from_bytes(data[18:20], "big")
        minor = int.from_bytes(data[20:22], "big")
        mp = data[22] if data[22] < 128 else data[22] - 256
        dist = estimate_distance(adv.rssi, mp)
        results[device.address] = {
            "mac": device.address,
            "uuid": uuid,
            "major": major,
            "minor": minor,
            "rssi": adv.rssi,
            "measured_power": mp,
            "distance_m": dist,
            "zone": classify_zone(dist) if dist > 0 else "UNKNOWN",
        }

    scanner = BleakScanner(detection_callback)
    await scanner.start()
    await asyncio.sleep(duration)
    await scanner.stop()
    return sorted(results.values(), key=lambda b: b["rssi"], reverse=True)


def main():
    duration = 10.0
    if len(sys.argv) > 1 and sys.argv[1] == "--duration":
        duration = float(sys.argv[2])
    beacons = asyncio.run(scan(duration))
    print(json.dumps(beacons, indent=2))
    sys.exit(0 if beacons else 1)


if __name__ == "__main__":
    main()
